// ============================================
// src/config/qpay.config.js
// ============================================

const QPAY_CONFIG = {
  BASE_URL: "https://merchant.qpay.mn/v2",
  USERNAME: "TEST_MERCHANT",
  PASSWORD: "123456",
  INVOICE_CODE: "TEST_INVOICE",


  // BASE_URL: process.env.QPAY_BASE_URL,
  // USERNAME: process.env.QPAY_USERNAME,
  // PASSWORD: process.env.QPAY_PASSWORD,
  // INVOICE_CODE: process.env.QPAY_INVOICE_CODE,
};

module.exports = QPAY_CONFIG;