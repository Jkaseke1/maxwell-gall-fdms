const crypto = require('crypto');

/**
 * Generate QR code per spec section 11
 * 
 * QR code = qrUrl + "/" + 
 *           deviceID(10 digits padded) + 
 *           receiptDate(ddMMyyyy - 8 digits) +
 *           receiptGlobalNo(10 digits padded) +
 *           receiptQrData(16 chars)
 */

/**
 * Generate receiptQrData from device signature
 * 1. Take deviceSignature (base64)
 * 2. Decode signature bytes
 * 3. MD5 hash of those bytes, rendered as hexadecimal
 * 4. Take first 16 characters UPPERCASE
 */
function generateReceiptQrData(deviceSignatureBase64) {
  // Hash the decoded bytes, not their textual hex representation.
  // Verified against Maxwell Glass sandbox receipt 11593634.
  const buffer = Buffer.from(deviceSignatureBase64, 'base64');
  
  // MD5 hash of signature bytes
  const md5Hash = crypto.createHash('md5');
  md5Hash.update(buffer);
  const md5Hex = md5Hash.digest('hex');
  
  // Take first 16 characters UPPERCASE
  return md5Hex.substring(0, 16).toUpperCase();
}

/**
 * Format date for QR code
 * Input: YYYY-MM-DDTHH:mm:ss or Date object
 * Output: ddMMyyyy (8 digits)
 * Example: 2023-04-03 → 03042023
 */
function formatDateForQR(receiptDate) {
  let date;
  
  if (typeof receiptDate === 'string') {
    // Parse ISO date string
    date = new Date(receiptDate);
  } else {
    date = receiptDate;
  }
  
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = String(date.getFullYear());
  
  return `${day}${month}${year}`;
}

/**
 * Generate complete QR URL
 * @param {string} qrUrl - Base QR URL from getConfig
 * @param {number} deviceID - Device ID
 * @param {string|Date} receiptDate - Receipt date
 * @param {number} receiptGlobalNo - Receipt global number
 * @param {string} deviceSignatureBase64 - Device signature in base64
 * @returns {string} Complete QR URL
 */
function generateQRData(qrUrl, deviceID, receiptDate, receiptGlobalNo, deviceSignatureBase64) {
  // Pad device ID to 10 digits
  const deviceIDPadded = String(deviceID).padStart(10, '0');
  
  // Format date as ddMMyyyy
  const datePart = formatDateForQR(receiptDate);
  
  // Pad receipt global number to 10 digits
  const receiptGlobalNoPadded = String(receiptGlobalNo).padStart(10, '0');
  
  // Generate QR data from signature
  const receiptQrData = generateReceiptQrData(deviceSignatureBase64);
  
  // Concatenate all parts
  const qrCode = `${qrUrl}/${deviceIDPadded}${datePart}${receiptGlobalNoPadded}${receiptQrData}`;
  
  return qrCode;
}

module.exports = {
  generateQRData,
  generateReceiptQrData,
  formatDateForQR
};
