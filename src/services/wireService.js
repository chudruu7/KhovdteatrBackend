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
  /unknown|unrecognized|invalid|not allowed|unexpected|unsupported/i.test(JSON.stringify(err?.details || err?.message || ''))
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

export const getPaymentReference = (bookingId) => (
  `KDT-${String(bookingId || '').replace(/[^a-zA-Z0-9]/g, '').slice(-8).toUpperCase()}`
);

const getPaymentReferenceFields = (bookingId, suffix = '') => {
  const transactionReference = getPaymentReference(bookingId) + suffix;
  return {
    description: transactionReference,
    note: transactionReference,
    memo: transactionReference,
    purpose: transactionReference,
    comment: transactionReference,
    reference: transactionReference,
    payment_reference: transactionReference,
    payment_description: transactionReference,
    transaction_reference: transactionReference,
    transaction_description: transactionReference,
    statement_descriptor: transactionReference,
    metadata: {
      booking_id: String(bookingId),
      reference: transactionReference,
      payment_reference: transactionReference,
      transaction_reference: transactionReference,
      description: transactionReference,
    },
  };
};

const referenceQueryKeys = [
  'description', 'desc', 'note', 'memo', 'purpose', 'comment', 'remarks',
  'remark', 'message', 'reference', 'ref', 'payment_reference', 'paymentReference',
  'payment_description', 'paymentDescription', 'transaction_reference',
  'transactionReference', 'transaction_description', 'transactionDescription',
  'statement_descriptor', 'value', 'utga',
];

const isMissingReferenceValue = (value) => (
  value === null || value === undefined || value === '' ||
  /^null$/i.test(String(value)) || /^undefined$/i.test(String(value))
);

const withReferenceQueryParams = (url, transactionReference) => {
  if (!transactionReference || !isActionUrl(url) || isAssetUrl(url)) return url;

  try {
    const parsed = new URL(url);
    referenceQueryKeys.forEach((key) => {
      if (!parsed.searchParams.has(key) || isMissingReferenceValue(parsed.searchParams.get(key))) {
        parsed.searchParams.set(key, transactionReference);
      }
    });
    return parsed.toString();
  } catch {
    return url;
  }
};

export const enrichPaymentActionReferences = (value, bookingId) => {
  const transactionReference = String(bookingId || '').startsWith('KDT-')
    ? String(bookingId)
    : getPaymentReference(bookingId);
  if (!value || !transactionReference) return value;

  if (typeof value === 'string') {
    return withReferenceQueryParams(value, transactionReference);
  }

  if (Array.isArray(value)) {
    return value.map((item) => enrichPaymentActionReferences(item, bookingId));
  }

  if (typeof value === 'object') {
    const next = {};
    Object.entries(value).forEach(([key, item]) => {
      const lowerKey = key.toLowerCase();
      if (
        typeof item === 'string' &&
        (/url|link|deeplink|checkout|redirect|web/.test(lowerKey))
      ) {
        next[key] = withReferenceQueryParams(item, transactionReference);
        return;
      }

      if (
        /description|desc|note|memo|purpose|comment|remark|message|reference|descriptor|utga/.test(lowerKey) &&
        isMissingReferenceValue(item)
      ) {
        next[key] = transactionReference;
        return;
      }

      next[key] = enrichPaymentActionReferences(item, bookingId);
    });

    return {
      ...next,
      description: next.description || transactionReference,
      reference: next.reference || transactionReference,
      payment_reference: next.payment_reference || transactionReference,
      transaction_reference: next.transaction_reference || transactionReference,
      transaction_description: next.transaction_description || transactionReference,
    };
  }

  return value;
};

export const getWireActionPageUrl = (paymentIntentId) => (
  `${getPublicApiUrl()}/api/wire/checkout/action/${encodeURIComponent(paymentIntentId)}`
);

const createLocalSandboxPaymentIntent = ({ bookingId, wireAmount, allowedOperators }) => {
  const id = `pi_test_${bookingId}`;
  const intent = {
    id,
    object: 'payment_intent',
    amount: wireAmount,
    currency: 'MNT',
    status: 'new',
    client_secret: `pi_test_secret_${bookingId}`,
    automatic_operator: true,
    allowed_operators: allowedOperators?.length ? allowedOperators : ['sandbox'],
    selected_operator: 'sandbox',
    next_action: null,
    ...getPaymentReferenceFields(bookingId),
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
    automatic_operator: shouldUseAutomaticOperator(finalOperators),
    allowed_operators: finalOperators.length ? finalOperators : undefined,
    ...referenceFields,
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
    console.warn('[Wire] Reference autofill fields were rejected on create; retrying with basic description/metadata.', err.message);
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

const isActionUrl = (value) => /^[a-z][a-z0-9+.-]*:\/\//i.test(value || '');
const isAssetUrl = (value) => (
  /\.(avif|bmp|gif|ico|jpeg|jpg|png|svg|webp)(\?|#|$)/i.test(value || '') ||
  /\/(launcher-icon|logo|icon|image|thumbnail|avatar)[^/]*$/i.test(value || '')
);

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

  return wireRequest(`/payment_intents/${paymentIntentId}/confirm`, {
    payload: fullPayload,
    idempotencyKey: `wire-confirm-${bookingId}-${paymentIntentId}`,
  });
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