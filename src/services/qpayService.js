// src/services/qpayService.js
// ── Debug хувилбар — 404 шалтгааныг олоход ашиглана ──────────────────────────

import axios from 'axios';

const BASE_URL     = process.env.QPAY_BASE_URL     || 'https://merchant-sandbox.qpay.mn';
const USERNAME     = process.env.QPAY_USERNAME      || 'TEST_MERCHANT';
const PASSWORD     = process.env.QPAY_PASSWORD      || '123456';
const INVOICE_CODE = process.env.QPAY_INVOICE_CODE  || 'TEST_INVOICE';
const CALLBACK_URL = process.env.QPAY_CALLBACK_URL  || 'http://localhost:5000/api/qpay/callback';

// ── Сервер эхлэхэд тохиргоог хэвлэнэ ────────────────────────────────────────
console.log('[QPay CONFIG]', { BASE_URL, USERNAME, INVOICE_CODE });

let _tokenCache = {
  accessToken:  null,
  refreshToken: null,
  expiresAt:    0,
};

async function getAccessToken() {
  const now = Date.now();

  if (_tokenCache.accessToken && now < _tokenCache.expiresAt - 30_000) {
    return _tokenCache.accessToken;
  }

  if (_tokenCache.refreshToken) {
    try {
      console.log('[QPay] Token refresh...');
      const resp = await axios.post(
        `${BASE_URL}/v2/auth/refresh`,
        {},
        { headers: { Authorization: `Bearer ${_tokenCache.refreshToken}` } }
      );
      _saveToken(resp.data);
      return _tokenCache.accessToken;
    } catch (err) {
      console.warn('[QPay] Refresh амжилтгүй:', err?.response?.status);
    }
  }

  const tokenUrl    = `${BASE_URL}/v2/auth/token`;
  const credentials = Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');

  console.log('[QPay] Token URL:', tokenUrl);

  const resp = await axios.post(
    tokenUrl,
    {},
    { headers: { Authorization: `Basic ${credentials}` } }
  );
  _saveToken(resp.data);
  return _tokenCache.accessToken;
}

function _saveToken(data) {
  _tokenCache.accessToken  = data.access_token;
  _tokenCache.refreshToken = data.refresh_token;
  _tokenCache.expiresAt    = Date.now() + (data.expires_in || 3600) * 1000;
  console.log(`[QPay] Token OK. Дуусах: ${new Date(_tokenCache.expiresAt).toLocaleTimeString()}`);
}

async function qpayRequest(method, path, data = null) {
  const token   = await getAccessToken();
  const fullUrl = `${BASE_URL}${path}`;

  console.log(`[QPay] ${method.toUpperCase()} ${fullUrl}`);
  if (data) console.log('[QPay] Body:', JSON.stringify(data));

  const config = {
    method,
    url: fullUrl,
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${token}`,
    },
  };
  if (data) config.data = data;

  try {
    const resp = await axios(config);
    console.log(`[QPay] ${resp.status} OK`);
    return resp.data;
  } catch (err) {
    const status  = err?.response?.status;
    const errData = err?.response?.data;
    console.error(`[QPay ERROR] ${status} — ${fullUrl}`);
    console.error('[QPay ERROR] Body:', typeof errData === 'string'
      ? errData.slice(0, 400)
      : JSON.stringify(errData));
    throw errData || err;
  }
}

// ── Exported functions ────────────────────────────────────────────────────────

export async function createCinemaInvoice({ bookingId, amount, seats, movieTitle }) {
  const body = {
    invoice_code:          INVOICE_CODE,
    sender_invoice_no:     String(bookingId),
    invoice_receiver_code: 'terminal',
    invoice_description:   movieTitle
      ? `${movieTitle} — ${seats?.length || 1} суудал`
      : `Захиалга #${bookingId}`,
    amount:                Number(amount),
    callback_url:          `${CALLBACK_URL}?booking_id=${bookingId}`,
    enable_expiry:         'false',
    allow_partial:         false,
    minimum_amount:        null,
    allow_exceed:          false,
    maximum_amount:        null,
    sender_branch_code:    process.env.QPAY_BRANCH_CODE || 'BRANCH1',
  };

  const result = await qpayRequest('POST', '/v2/invoice', body);
  return {
    invoiceId: result.invoice_id,
    qrCode:    result.qr_image,
    qrText:    result.qr_text,
    urls:      result.urls || [],
  };
}

export async function checkPaymentStatus(invoiceId) {
  const body = {
    object_type: 'INVOICE',
    object_id:   invoiceId,
    offset: { page_number: 1, page_limit: 100 },
  };
  const result   = await qpayRequest('POST', '/v2/payment/check', body);
  const payments = result.rows || result.payments || [];
  const paid     = payments.some(p =>
    p.payment_status === 'PAID' || p.payment_status === 'APPROVED'
  );
  return { paid, status: paid ? 'PAID' : 'PENDING', payments };
}

export async function cancelInvoice(invoiceId) {
  await qpayRequest('DELETE', `/v2/invoice/${invoiceId}`);
  return { success: true };
}

export async function createEbarimt({ paymentId, receiverType = 'CITIZEN', receiverPhone = null }) {
  const body = { payment_id: String(paymentId), ebarimt_receiver_type: receiverType };
  if (receiverPhone) body.ebarimt_receiver = String(receiverPhone);
  return await qpayRequest('POST', '/v2/ebarimt/create', body);
}

export async function cancelPayment({ paymentId, note = 'буцаалт' }) {
  await qpayRequest('DELETE', `/v2/payment/cancel/${paymentId}`, {
    callback_url: `${CALLBACK_URL}?payment_id=${paymentId}`,
    note,
  });
  return { success: true };
}