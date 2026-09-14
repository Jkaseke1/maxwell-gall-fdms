const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Receipt hash and signature per spec section 13.2
 * CRITICAL: This must match ZIMRA's exact algorithm
 */

/**
 * Format tax percent to always have 2 decimal places
 * Per spec: 15 → "15.00", 14.5 → "14.50", 0 → "0.00"
 * null/undefined → "" (empty string for exempt)
 */
function formatTaxPercent(percent) {
  if (percent === null || percent === undefined) {
    return '';
  }
  return Number(percent).toFixed(2);
}

/**
 * Convert amount to cents
 * Per spec: 500.00 → 50000, -9450.00 → -945000
 */
function toCents(amount) {
  return Math.round(Number(amount) * 100);
}

/**
 * Build tax string per spec section 13.2.1
 * Sort taxes by taxID ASC then taxCode ALPHA
 * Empty taxCode sorts before 'A'
 * Each tax: taxCode + taxPercent + taxAmountCents + salesAmountCents
 */
function buildTaxString(receiptTaxes) {
  if (!receiptTaxes || receiptTaxes.length === 0) {
    return '';
  }

  // Sort taxes: by taxID ASC, then taxCode ALPHA (empty before 'A')
  const sortedTaxes = [...receiptTaxes].sort((a, b) => {
    if (a.taxID !== b.taxID) {
      return a.taxID - b.taxID;
    }
    const codeA = a.taxCode || '';
    const codeB = b.taxCode || '';
    return codeA.localeCompare(codeB);
  });

  const taxStrings = sortedTaxes.map(tax => {
    const taxCode = tax.taxCode || '';
    const taxPercent = formatTaxPercent(tax.taxPercent);
    const taxAmountCents = toCents(tax.taxAmount || 0);
    // salesAmountCents = salesAmountWithTax in cents
    // ZIMRA spec: this is the total sales amount for this tax category,
    // including tax (matches the receipt field name salesAmountWithTax)
    const salesAmountCents = toCents(tax.salesAmountWithTax || 0);

    return `${taxCode}${taxPercent}${taxAmountCents}${salesAmountCents}`;
  });

  return taxStrings.join('');
}

/**
 * Build receipt hash input string per spec section 13.2.1
 * Fields concatenated in STRICT order (no separator):
 * deviceID | receiptType | receiptCurrency | receiptGlobalNo |
 * receiptDate | receiptTotal | taxString | previousReceiptHash
 */
function buildReceiptHashInput(receipt, previousReceiptHash) {
  const parts = [];

  // 1. deviceID (integer, no formatting)
  parts.push(String(receipt.deviceID));

  // 2. receiptType (uppercase)
  parts.push(receipt.receiptType.toUpperCase());

  // 3. receiptCurrency (uppercase)
  parts.push(receipt.receiptCurrency.toUpperCase());

  // 4. receiptGlobalNo (integer)
  parts.push(String(receipt.receiptGlobalNo));

  // 5. receiptDate (YYYY-MM-DDTHH:mm:ss - no timezone)
  let receiptDate = receipt.receiptDate;
  // Remove timezone if present
  receiptDate = receiptDate.replace('Z', '').replace(/[+-]\d{2}:\d{2}$/, '');
  // Remove milliseconds if present
  if (receiptDate.includes('.')) {
    receiptDate = receiptDate.split('.')[0];
  }
  parts.push(receiptDate);

  // 6. receiptTotal in cents
  parts.push(String(toCents(receipt.receiptTotal)));

  // 7. taxString
  parts.push(buildTaxString(receipt.receiptTaxes));

  // 8. previousReceiptHash (omit if first receipt of day)
  if (previousReceiptHash) {
    parts.push(previousReceiptHash);
  }

  const hashInputStr = parts.join('');
  console.log('=== SIGNATURE HASH INPUT ===');
  console.log('Parts:', JSON.stringify(parts, null, 2));
  console.log('Full string:', hashInputStr);
  console.log('=== END HASH INPUT ===');
  return hashInputStr;
}

/**
 * Generate SHA256 hash of receipt
 * Returns base64 encoded hash
 */
function generateReceiptHash(hashInput) {
  const hash = crypto.createHash('sha256');
  hash.update(hashInput, 'utf8');
  return hash.digest('base64');
}

/**
 * Sign the hash input string with private key
 * Per spec: sign the concatenated string (not the hash) using SHA256
 */
function signReceiptHash(hashInput) {
  const keyPath = path.resolve(process.env.FDMS_KEY_PATH);
  
  if (!fs.existsSync(keyPath)) {
    throw new Error(`Private key not found at ${keyPath}`);
  }

  const privateKey = fs.readFileSync(keyPath, 'utf8');
  
  const sign = crypto.createSign('SHA256');
  sign.update(hashInput, 'utf8');
  sign.end();
  
  const signature = sign.sign(privateKey, 'base64');
  return signature;
}

/**
 * Generate complete receipt signature
 * Returns { hash, signature }
 */
function generateReceiptSignature(receipt, previousReceiptHash = null) {
  const hashInput = buildReceiptHashInput(receipt, previousReceiptHash);
  const hash = generateReceiptHash(hashInput);
  const signature = signReceiptHash(hashInput);

  return {
    hash,
    signature,
    hashInput // for debugging
  };
}

module.exports = {
  generateReceiptSignature,
  buildReceiptHashInput,
  generateReceiptHash,
  buildTaxString,
  formatTaxPercent,
  toCents
};
