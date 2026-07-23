// wireService.js - Бүрэн шинэчлэгдсэн хувилбар

const WIRE_BASE_URL = process.env.WIRE_API_BASE_URL || 'https://api.wire.mn/v1';
const WIRE_API_TIMEOUT_MS = Number(process.env.WIRE_API_TIMEOUT_MS || 10000);
const sandboxIntents = new Map();

const getApiKey = () => process.env.WIRE_API_KEY;
const isTruthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
const isFalsey = (value) => ['0', 'false', 'no', 'off'].includes(String(value || '').toLowerCase());

export const isWireTestMode = () => {
  const explicitMode = String(process.env.WIRE_OPERATION_MODE || '').toLowerCase();
  if (explicitMode === 'live') return false;
  if (explicitMode === 'test' || explicitMode === 'sandbox') return true;
  if (process.env.WIRE_TEST_MODE !== undefined) return isTruthy(process.env.WIRE_TEST_MODE);
  return String(getApiKey() || '').startsWith('sk_test_');
};

export const isLocalWireSandbox = () => (
  isWireTestMode() &&
  (!getApiKey() || getApiKey() === 'sk_test_sandbox' || String(getApiKey()).startsWith('sk_test_local'))
);

const assertSafeWireMode = (apiKey) => {
  if (isLocalWireSandbox()) return;

  if (isWireTestMode()) {
    if (apiKey?.startsWith('sk_test_')) return;
    const err = new Error('Wire test mode requires a sk_test_ API key.');
    err.statusCode = 500;
    throw err;
  }

  if (!apiKey?.startsWith('sk_live_')) {
    const err = new Error('Wire live mode requires WIRE_API_KEY to start with sk_live_.');
    err.statusCode = 500;
    throw err;
  }

  if (!/^sk_live_[A-Za-z0-9_-]{12,}$/.test(apiKey)) {
    const err = new Error('WIRE_API_KEY is not a real live key. Replace the placeholder with the full sk_live_... key from Wire dashboard.');
    err.statusCode = 500;
    throw err;
  }
};

const getWireErrorMessage = (data, fallbackStatus) => (
  data?.error?.message ||
  data?.message ||
  data?.error ||
  `Wire API error: ${fallbackStatus}`
);

const isPayloadFieldError = (err) => (
  [400, 422].includes(Number(err?.statusCode)) &&
  /unknown|unrecognized|additional properties|invalid|not allowed|unexpected|unsupported/i.test(JSON.stringify(err?.details || err?.message || ''))
);

const wireRequest = async (path, { method = 'POST', payload, idempotencyKey, query } = {}) => {
  const apiKey = getApiKey();
  if (!apiKey && !isLocalWireSandbox()) {
    const err = new Error('WIRE_API_KEY is not configured.');
    err.statusCode = 500;
    throw err;
  }
  assertSafeWireMode(apiKey);

  const url = new URL(`${WIRE_BASE_URL}${path}`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  let response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WIRE_API_TIMEOUT_MS);
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: controller.signal,
    });
  } catch (cause) {
    const err = new Error(cause?.name === 'AbortError'
      ? `Wire API request timed out after ${WIRE_API_TIMEOUT_MS}ms: ${path}`
      : `Wire API host is not reachable: ${url.origin}`);
    err.statusCode = 502;
    err.details = { error: { message: cause?.message || String(cause) } };
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }

  if (!response.ok) {
    console.error('[Wire API ERROR]', {
      path,
      status: response.status,
      response: data,
      idempotencyKey,
    });
    const err = new Error(getWireErrorMessage(data, response.status));
    err.statusCode = response.status;
    err.details = data;
    throw err;
  }

  return data;
};

export const getDefaultAllowedOperators = () => {
  let rawEnv = process.env.WIRE_ALLOWED_OPERATORS || '';
  rawEnv = rawEnv.replace(/[\[\]\s"']/g, '');

  const configured = rawEnv
    .split(',')
    .map((operator) => operator.trim())
    .filter(Boolean);

  if (configured.length) return configured;
  if (isWireTestMode() || getApiKey()?.startsWith('sk_test_')) return ['sandbox'];
  return [];
};

const assertLiveOperators = (allowedOperators = []) => {
  if (isWireTestMode()) return;
  if (allowedOperators.includes('sandbox')) {
    const err = new Error('WIRE_ALLOWED_OPERATORS cannot contain sandbox in Wire live mode.');
    err.statusCode = 500;
    throw err;
  }
};

export const shouldUseAutomaticOperator = (allowedOperators = []) => {
  if (process.env.WIRE_AUTOMATIC_OPERATOR !== undefined) {
    return !isFalsey(process.env.WIRE_AUTOMATIC_OPERATOR);
  }
  return allowedOperators.length === 0;
};

export const getSelectedOperator = (allowedOperators = []) => (
  process.env.WIRE_OPERATOR ||
  process.env.WIRE_SELECTED_OPERATOR ||
  allowedOperators[0] ||
  null
);

const getPublicApiUrl = () => (
    process.env.PUBLIC_API_URL ||
    process.env.BACKEND_PUBLIC_URL ||
    'https://khovdteatrbackend.onrender.com'
).replace(/\/$/, '');

const getSandboxCheckoutUrl = (paymentIntentId) => (
  `${getPublicApiUrl()}/api/wire/sandbox/checkout/${paymentIntentId}`
);

export const getPaymentReference = (_bookingId) => 'Тасалбар худалдан авалт';

// ГҮЙЛГЭЭНИЙ УТГЫН БҮХ БОЛОМЖИТ ТАЛБАРУУД
const REFERENCE_FIELD_NAMES = [
  'description', 'desc', 'note', 'memo', 'purpose', 'comment', 'remarks',
  'remark', 'message', 'reference', 'ref', 'payment_reference', 'paymentReference',
  'payment_description', 'paymentDescription', 'transaction_reference',
  'transactionReference', 'transaction_description', 'transactionDescription',
  'statement_descriptor', 'value', 'utga', 'transactionDescription',
  'txnDesc', 'txnDescription', 'transactionRemarks', 'transactionRemark',
  'paymentPurpose', 'payment_purpose', 'additionalInfo', 'additional_info',
  'billNumber', 'bill_number', 'invoiceNo', 'invoice_no', 'qr', 'qrcode',
  'qrCode', 'qr_code', 'qrText', 'qr_text', 'qrtext', 'data', 'payload',
  'guitgel', 'gүйлгээ', 'utga', 'tailbar', 'tailbariin_utga'
];

// МОНГОЛ ГҮЙЛГЭЭНИЙ УТГЫН НЭМЭЛТ ТАЛБАРУУД
const MN_REFERENCE_FIELDS = [
  'гуйлгээний_утга', 'гүйлгээний_утга', 'гуйлгээ', 'гүйлгээ',
  'утга', 'тайлбар', 'тайлбарын_утга', 'төлбөрийн_утга',
  'төлбөр_утга', 'захиалгын_дугаар', 'захиалга_дугаар'
];

const QR_PAYLOAD_FIELD_NAMES = ['qr', 'qrcode', 'qrCode', 'qr_code', 'qrText', 'qr_text', 'qrtext', 'data', 'payload'];
const isQrPayloadField = (key) => QR_PAYLOAD_FIELD_NAMES.some((field) => String(key).toLowerCase().includes(field.toLowerCase()));

const getPaymentReferenceFields = (bookingId, suffix = '') => {
  const transactionReference = (getPaymentReference(bookingId) + suffix).slice(0, 500);

  return {
    description: transactionReference,
    metadata: {
      booking_id: String(bookingId),
      reference: transactionReference,
      payment_reference: transactionReference,
      transaction_reference: transactionReference,
      description: transactionReference,
    },
  };
};

// EMV QR кодны CRC тооцоолол
const getUtf8Bytes = (value) => Buffer.from(String(value), 'utf8');

const crc16CcittFalse = (value) => {
  let crc = 0xFFFF;
  for (const byte of getUtf8Bytes(value)) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
};

const parseEmvTags = (payload) => {
  const tags = [];
  let index = 0;
  while (index + 4 <= payload.length) {
    const id = payload.slice(index, index + 2);
    const lengthText = payload.slice(index + 2, index + 4);
    const length = Number(lengthText);
    if (!/^\d{2}$/.test(id) || !/^\d{2}$/.test(lengthText) || index + 4 + length > payload.length) {
      return null;
    }
    tags.push({ id, value: payload.slice(index + 4, index + 4 + length) });
    index += 4 + length;
  }
  return index === payload.length ? tags : null;
};

const serializeEmvTags = (tags) => {
  const parts = [];
  for (const { id, value } of tags) {
    const byteLength = getUtf8Bytes(value).length;
    if (byteLength > 99) return null;
    parts.push(`${id}${String(byteLength).padStart(2, '0')}${value}`);
  }
  return parts.join('');
};

// EMV QR кодонд гүйлгээний утга оруулах
const injectReferenceIntoEmvQr = (payload, transactionReference) => {
  const raw = String(payload || '');
  if (!transactionReference || !/^000201/.test(raw) || !/6304[0-9A-F]{4}$/i.test(raw)) return payload;

  const withoutCrc = raw.slice(0, -8);
  const existingCrc = raw.slice(-4).toUpperCase();
  const expectedCrc = crc16CcittFalse(`${withoutCrc}6304`);
  if (existingCrc !== expectedCrc) return payload;

  const rootTags = parseEmvTags(withoutCrc);
  if (!rootTags) return payload;

  const additionalData = rootTags.find((tag) => tag.id === '62');
  const additionalTags = additionalData ? parseEmvTags(additionalData.value) : [];
  if (!additionalTags) return payload;

  // Гүйлгээний утга оруулах таг ID-ууд
  const referenceTagIds = ['01', '02', '03', '05', '08', '09', '10', '11', '12', '13', '14', '15'];

  let foundExisting = false;
  for (const id of referenceTagIds) {
    const existing = additionalTags.find((tag) => tag.id === id);
    if (existing) {
      existing.value = transactionReference;
      foundExisting = true;
    }
  }

  if (!foundExisting) {
    // Бүх таг дүүрсэн бол эхний тагийг солих
    additionalTags.push({ id: '05', value: transactionReference });
  }

  const nextAdditionalValue = serializeEmvTags(additionalTags);
  if (!nextAdditionalValue) return payload;
  if (additionalData) additionalData.value = nextAdditionalValue;
  else rootTags.push({ id: '62', value: nextAdditionalValue });

  const withoutNextCrc = serializeEmvTags(rootTags);
  if (!withoutNextCrc) return payload;
  return `${withoutNextCrc}6304${crc16CcittFalse(`${withoutNextCrc}6304`)}`;
};

const withReferenceInPaymentString = (value, transactionReference) => {
  if (typeof value !== 'string') return value;
  return injectReferenceIntoEmvQr(value, transactionReference);
};

const isActionUrl = (value) => /^[a-z][a-z0-9+.-]*:\/\//i.test(value || '');
const isAssetUrl = (value) => (
  /\.(avif|bmp|gif|ico|jpeg|jpg|png|svg|webp)(\?|#|$)/i.test(value || '') ||
  /\/(launcher-icon|logo|icon|image|thumbnail|avatar)[^/]*$/i.test(value || '')
);

// URL-ын query параметрүүдэд гүйлгээний утга оруулах
const withReferenceQueryParams = (url, transactionReference) => {
  if (!transactionReference || !isActionUrl(url) || isAssetUrl(url)) return url;

  try {
    const parsed = new URL(url);

    // Бүх боломжит талбаруудад гүйлгээний утга оруулах
    const qrPayloadKeySet = new Set(QR_PAYLOAD_FIELD_NAMES.map((key) => key.toLowerCase()));
    const allFields = [...REFERENCE_FIELD_NAMES, ...MN_REFERENCE_FIELDS]
      .filter((key) => !qrPayloadKeySet.has(String(key).toLowerCase()));
    const targetFields = allFields.filter((key) => parsed.searchParams.has(key));

    (targetFields.length ? targetFields : ['description']).forEach((key) => {
      parsed.searchParams.set(key, transactionReference);
        // EMV QR код бол гүйлгээний утга оруулах
    });

    // QR payload-д зориулсан тусгай боловсруулалт
    QR_PAYLOAD_FIELD_NAMES.forEach((key) => {
      const rawValue = parsed.searchParams.get(key);
      if (rawValue) parsed.searchParams.set(key, rawValue);
    });

    return parsed.toString();
  } catch {
    return url;
  }
};

export const enrichPaymentActionReferences = (value, bookingId) => {
  const transactionReference = getPaymentReference(bookingId);

  if (!value || !transactionReference) return value;

  // URL бол
  if (typeof value === 'string' && isActionUrl(value)) {
    return withReferenceQueryParams(value, transactionReference);
  }

  // Текст бол (QR текст гэх мэт)
  if (typeof value === 'string') {
    return value;
  }

  // Массив бол
  if (Array.isArray(value)) {
    return value.map((item) => enrichPaymentActionReferences(item, bookingId));
  }

  // Объект бол
  if (typeof value === 'object') {
    const next = {};
    Object.entries(value).forEach(([key, item]) => {
      const lowerKey = key.toLowerCase();

      // URL талбарууд
      if (typeof item === 'string' && (/url|link|deeplink|checkout|redirect|web/.test(lowerKey))) {
        next[key] = withReferenceQueryParams(item, transactionReference);
        return;
      }

      if (typeof item === 'string' && isQrPayloadField(lowerKey)) {
        next[key] = item;
        return;
      }

      // Гүйлгээний утгын талбарууд
      if (typeof item === 'string' && (
        REFERENCE_FIELD_NAMES.some(field => lowerKey.includes(field)) ||
        MN_REFERENCE_FIELDS.some(field => lowerKey.includes(field))
      )) {
        next[key] = transactionReference;
        return;
      }

      next[key] = enrichPaymentActionReferences(item, bookingId);
    });

    // Бүх үндсэн талбаруудыг заавал оруулах
    return {
      ...next,
      description: next.description || transactionReference,
      desc: next.desc || transactionReference,
      note: next.note || transactionReference,
      memo: next.memo || transactionReference,
      purpose: next.purpose || transactionReference,
      comment: next.comment || transactionReference,
      remarks: next.remarks || transactionReference,
      remark: next.remark || transactionReference,
      reference: next.reference || transactionReference,
      payment_reference: next.payment_reference || transactionReference,
      transaction_reference: next.transaction_reference || transactionReference,
      transaction_description: next.transaction_description || transactionReference,
      гүйлгээний_утга: next.гүйлгээний_утга || transactionReference,
      гуйлгээний_утга: next.гуйлгээний_утга || transactionReference,
      утга: next.утга || transactionReference,
      тайлбар: next.тайлбар || transactionReference,
    };
  }

  return value;
};

export const getWireActionPageUrl = (paymentIntentId) => (
  `${getPublicApiUrl()}/api/wire/checkout/action/${encodeURIComponent(paymentIntentId)}`
);

const createLocalSandboxPaymentIntent = ({ bookingId, wireAmount, allowedOperators }) => {
  const id = `pi_test_${bookingId}`;
  const referenceFields = getPaymentReferenceFields(bookingId);
  const intent = {
    id,
    object: 'payment_intent',
    amount: wireAmount,
    currency: 'MNT',
    description: referenceFields.description,
    status: 'new',
    client_secret: `pi_test_secret_${bookingId}`,
    automatic_operator: true,
    allowed_operators: allowedOperators?.length ? allowedOperators : ['sandbox'],
    selected_operator: 'sandbox',
    next_action: null,
    ...referenceFields,
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    expires_at: Math.floor(Date.now() / 1000) + 600,
  };

  sandboxIntents.set(id, intent);
  return intent;
};

export const createPaymentIntent = async ({ bookingId, wireAmount, allowedOperators }) => {
  if (isLocalWireSandbox()) {
    return createLocalSandboxPaymentIntent({ bookingId, wireAmount, allowedOperators });
  }

  assertSafeWireMode(getApiKey());

  const finalOperators = allowedOperators && allowedOperators.length
    ? allowedOperators
    : getDefaultAllowedOperators();

  assertLiveOperators(finalOperators);

  const referenceFields = getPaymentReferenceFields(bookingId);

  const payload = {
    amount: wireAmount,
    currency: 'MNT',
    description: referenceFields.description,
    automatic_operator: shouldUseAutomaticOperator(finalOperators),
    allowed_operators: finalOperators.length ? finalOperators : undefined,
    metadata: referenceFields.metadata,
  };

  try {
    return await wireRequest('/payment_intents', {
      payload,
      idempotencyKey: `wire-pi-${bookingId}-${wireAmount}`,
    });
  } catch (err) {
    const isDuplicate = /duplicate|давхар|double|already|exists|гүйлгээ/i.test(err.message || '') || /duplicate|давхар|double|already|exists|гүйлгээ/i.test(JSON.stringify(err.details || {}));
    if (isDuplicate) {
      console.warn(`[Wire] Duplicate error on create, retrying with stable fallback...`);
      const suffix = `-${Math.floor(1000 + Math.random() * 9000)}`;
      return await wireRequest('/payment_intents', {
        payload,
        idempotencyKey: `wire-pi-${bookingId}-${wireAmount}${suffix}`,
      });
    }

    if (!isPayloadFieldError(err)) throw err;
    console.warn('[Wire] Reference autofill fields were rejected on create; retrying with basic fields.', err.message);
    // Fallback - зөвхөн үндсэн талбарууд
    return wireRequest('/payment_intents', {
      payload: {
        amount: wireAmount,
        currency: 'MNT',
        automatic_operator: shouldUseAutomaticOperator(finalOperators),
        allowed_operators: finalOperators.length ? finalOperators : undefined,
        description: referenceFields.description,
        metadata: referenceFields.metadata,
      },
      idempotencyKey: `wire-pi-basic-${bookingId}-${wireAmount}`,
    });
  }
};

export const confirmPaymentIntent = async ({ bookingId, paymentIntentId, allowedOperators, returnUrl }) => {
  if (isLocalWireSandbox()) {
    return {
      id: paymentIntentId,
      object: 'payment_intent',
      status: 'requires_action',
      next_action: { url: getSandboxCheckoutUrl(paymentIntentId) },
      livemode: false,
    };
  }

  const operator = getSelectedOperator(allowedOperators);

  const fullPayload = {
    return_url: returnUrl,
    ...(operator ? { operator } : {}),
  };

  try {
    return await wireRequest(`/payment_intents/${paymentIntentId}/confirm`, {
      payload: fullPayload,
      idempotencyKey: `wire-confirm-${bookingId}-${paymentIntentId}`,
    });
  } catch (err) {
    if (!isPayloadFieldError(err)) throw err;
    console.warn('[Wire] Reference fields were rejected on confirm; retrying with minimal fields.', err.message);
    return wireRequest(`/payment_intents/${paymentIntentId}/confirm`, {
      payload: {
        return_url: returnUrl,
        ...(operator ? { operator } : {}),
      },
      idempotencyKey: `wire-confirm-basic-${bookingId}-${paymentIntentId}`,
    });
  }
};

export const retrievePaymentIntent = async (paymentIntentId, fallback = {}) => {
  const apiKey = getApiKey();
  if (isLocalWireSandbox()) {
    let intent = sandboxIntents.get(paymentIntentId);
    if (!intent && String(paymentIntentId).startsWith('pi_test_')) {
      const bookingId = String(paymentIntentId).replace(/^pi_test_/, '');
      intent = createLocalSandboxPaymentIntent({
        bookingId,
        wireAmount: fallback.wireAmount || 0,
        allowedOperators: ['sandbox'],
      });
    }
    if (!intent) {
      const err = new Error('Sandbox PaymentIntent was not found.');
      err.statusCode = 404;
      throw err;
    }

    return {
      ...intent,
      status: 'succeeded',
      next_action: { sandbox: 'auto_succeeded' },
    };
  }

  if (!apiKey) {
    const err = new Error('WIRE_API_KEY is not configured.');
    err.statusCode = 500;
    throw err;
  }
  assertSafeWireMode(apiKey);

  return wireRequest(`/payment_intents/${paymentIntentId}`, { method: 'GET' });
};

export const extractActionUrl = (intent) => {
  if (!intent) return null;
  if (intent.next_action?.url) return intent.next_action.url;
  if (intent.url) return intent.url;
  return null;
};
