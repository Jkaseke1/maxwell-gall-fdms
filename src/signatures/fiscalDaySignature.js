const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { formatTaxPercent, toCents } = require('./receiptSignature');

/**
 * Fiscal day hash and signature per spec section 13.3.1
 */

// ZIMRA fiscal day counters must be ordered by counter TYPE using this exact
// priority (NOT alphabetically) before building the hash string, then by
// currency, then by taxID/moneyType. Sorting alphabetically produces a
// different string than ZIMRA's canonical reconstruction, which fails the
// server-side signature check with error code BadCertificateSignature.
const FISCAL_COUNTER_TYPE_ORDER = {
  SaleByTax: 1,
  SaleTaxByTax: 2,
  CreditNoteByTax: 3,
  CreditNoteTaxByTax: 4,
  DebitNoteByTax: 5,
  DebitNoteTaxByTax: 6,
  BalanceByMoneyType: 7
};

/**
 * Build fiscal counter string per spec
 * Sort counters by:
 *   1. fiscalCounterType ASC
 *   2. fiscalCounterCurrency ASC (alphabetical)
 *   3. fiscalCounterTaxID ASC or fiscalCounterMoneyType ASC
 * All text values UPPERCASE
 * Amounts in CENTS
 * Only NON-ZERO counters included
 */
function buildCounterString(counters) {
  if (!counters || counters.length === 0) {
    return '';
  }

  // Filter out zero value counters
  const nonZeroCounters = counters.filter(c => c.fiscalCounterValue !== 0);

  // Sort counters
  const sortedCounters = [...nonZeroCounters].sort((a, b) => {
    // 1. By type (ZIMRA priority order, NOT alphabetical)
    const aOrder = FISCAL_COUNTER_TYPE_ORDER[a.fiscalCounterType] || 99;
    const bOrder = FISCAL_COUNTER_TYPE_ORDER[b.fiscalCounterType] || 99;
    if (aOrder !== bOrder) {
      return aOrder - bOrder;
    }
    
    // 2. By currency
    if (a.fiscalCounterCurrency !== b.fiscalCounterCurrency) {
      return a.fiscalCounterCurrency.localeCompare(b.fiscalCounterCurrency);
    }
    
    // 3. By taxID or moneyType
    if (a.fiscalCounterTaxID !== undefined && b.fiscalCounterTaxID !== undefined) {
      return a.fiscalCounterTaxID - b.fiscalCounterTaxID;
    }
    
    if (a.fiscalCounterMoneyType && b.fiscalCounterMoneyType) {
      const order = ['Cash','Card','MobileWallet','Coupon','Credit','BankTransfer','Other'];
      return order.indexOf(a.fiscalCounterMoneyType) - order.indexOf(b.fiscalCounterMoneyType);
    }
    
    return 0;
  });

  const counterStrings = sortedCounters.map(counter => {
    const type = counter.fiscalCounterType.toUpperCase();
    const currency = counter.fiscalCounterCurrency.toUpperCase();
    const valueCents = toCents(counter.fiscalCounterValue);
    
    let identifier = '';
    
    // For tax-based counters: use taxPercent
    if (counter.fiscalCounterTaxID !== undefined) {
      identifier = formatTaxPercent(counter.fiscalCounterTaxPercent);
    }
    
    // For BalanceByMoneyType: use moneyType
    if (counter.fiscalCounterMoneyType) {
      identifier = counter.fiscalCounterMoneyType.toUpperCase();
    }
    
    return `${type}${currency}${identifier}${valueCents}`;
  });

  return counterStrings.join('');
}

/**
 * Build fiscal day hash input string per spec section 13.3.1
 * Fields concatenated in STRICT order:
 * deviceID | fiscalDayNo | fiscalDayDate (YYYY-MM-DD) | fiscalCountersString
 */
function buildFiscalDayHashInput(fiscalDay, counters) {
  const parts = [];

  // 1. deviceID
  parts.push(String(fiscalDay.deviceID));

  // 2. fiscalDayNo
  parts.push(String(fiscalDay.fiscalDayNo));

  // 3. fiscalDayDate (YYYY-MM-DD only, no time)
  let fiscalDayDate = fiscalDay.fiscalDayDate;
  if (fiscalDayDate.includes('T')) {
    fiscalDayDate = fiscalDayDate.split('T')[0];
  }
  parts.push(fiscalDayDate);

  // 4. fiscalCountersString
  parts.push(buildCounterString(counters));

  return parts.join('');
}

/**
 * Generate SHA256 hash of fiscal day
 * Returns base64 encoded hash
 */
function generateFiscalDayHash(hashInput) {
  const hash = crypto.createHash('sha256');
  hash.update(hashInput, 'utf8');
  return hash.digest('base64');
}

/**
 * Sign the hash input string with private key
 */
function signFiscalDayHash(hashInput) {
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
 * Generate complete fiscal day signature
 * Returns { hash, signature }
 */
function generateFiscalDaySignature(fiscalDay, counters) {
  const hashInput = buildFiscalDayHashInput(fiscalDay, counters);
  const hash = generateFiscalDayHash(hashInput);
  const signature = signFiscalDayHash(hashInput);

  return {
    hash,
    signature,
    hashInput // for debugging
  };
}

module.exports = {
  generateFiscalDaySignature,
  buildFiscalDayHashInput,
  buildCounterString
};
