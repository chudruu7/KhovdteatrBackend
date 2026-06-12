const WIRE_BASE_URL = process.env.WIRE_API_BASE_URL || 'https://api.wire.mn/v1';
const sandboxIntents = new Map();
const actionPages = new Map();

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
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: payload ? JSON.stringify(payload) : undefined,
    });
  } catch (cause) {
    const err = new Error(`Wire API host is not reachable: ${url.origin}`);
    err.statusCode = 502;
    err.details = { error: { message: cause?.message || String(cause) } };
    throw err;
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
  const configured = (process.env.WIRE_ALLOWED_OPERATORS || '')
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

export const getWireActionPageUrl = (paymentIntentId) => (
  `${getPublicApiUrl()}/api/wire/checkout/action/${encodeURIComponent(paymentIntentId)}`
);

export const storeWireActionPage = ({ paymentIntentId, bookingId, amount, nextAction }) => {
  actionPages.set(String(paymentIntentId), {
    bookingId,
    amount,
    nextAction,
    expiresAt: Date.now() + 15 * 60 * 1000,
  });
};

export const getWireActionPage = (paymentIntentId) => {
  const page = actionPages.get(String(paymentIntentId));
  if (!page) return null;
  if (Date.now() > page.expiresAt) {
    actionPages.delete(String(paymentIntentId));
    return null;
  }
  return page;
};

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
    metadata: { booking_id: bookingId },
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    expires_at: Math.floor(Date.now() / 1000) + 600,
  };

  sandboxIntents.set(id, intent);
  return intent;
};

export const createPaymentIntent = ({ bookingId, wireAmount, allowedOperators }) => {
  if (isLocalWireSandbox()) {
    return createLocalSandboxPaymentIntent({ bookingId, wireAmount, allowedOperators });
  }

  assertSafeWireMode(getApiKey());
  assertLiveOperators(allowedOperators);

  const payload = {
    amount: wireAmount,
    currency: 'MNT',
    automatic_operator: shouldUseAutomaticOperator(allowedOperators),
    allowed_operators: allowedOperators,
    metadata: { booking_id: bookingId },
  };

  return wireRequest('/payment_intents', {
    payload,
    idempotencyKey: `wire-pi-${bookingId}-${wireAmount}`,
  });
};

const isActionUrl = (value) => /^[a-z][a-z0-9+.-]*:\/\//i.test(value || '');
const isAssetUrl = (value) => (
  /\.(avif|bmp|gif|ico|jpeg|jpg|png|svg|webp)(\?|#|$)/i.test(value || '') ||
  /\/(launcher-icon|logo|icon|image|thumbnail|avatar)[^/]*$/i.test(value || '')
);

const scoreActionUrl = (url, keyPath) => {
  const path = keyPath.join('.').toLowerCase();
  if (!isActionUrl(url) || isAssetUrl(url)) return -1;
  if (/(logo|icon|image|thumbnail|avatar|qr_image)/i.test(path)) return -1;

  let score = 1;
  if (/^https?:\/\//i.test(url)) score += 1000;
  if (/(checkout_url|payment_url|redirect_url|web_url|payment_link)$/.test(path)) score += 200;
  if (/(checkout|payment|redirect|web)/.test(path)) score += 80;
  if (/(link)$/.test(path)) score += 40;
  if (/deeplink/.test(path)) score -= 100;
  if (/^(qpay|khanbank|tdbm|xacbank|golomt|statebank|mbank|most):\/\//i.test(url)) score -= 200;
  if (/s3\.qpay\.mn\/p\//i.test(url)) score -= 50;
  return score;
};

const collectActionUrls = (value, keyPath = [], candidates = []) => {
  if (!value) return candidates;

  if (typeof value === 'string') {
    const score = scoreActionUrl(value, keyPath);
    if (score >= 0) candidates.push({ url: value, score });
    return candidates;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => collectActionUrls(item, [...keyPath, String(index)], candidates));
    return candidates;
  }

  if (typeof value === 'object') {
    Object.entries(value).forEach(([key, item]) => collectActionUrls(item, [...keyPath, key], candidates));
  }

  return candidates;
};

export const extractActionUrl = (value) => (
  collectActionUrls(value)
    .sort((left, right) => right.score - left.score)[0]?.url || null
);

export const confirmPaymentIntent = ({ bookingId, paymentIntentId, allowedOperators, returnUrl }) => {
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
  return wireRequest(`/payment_intents/${paymentIntentId}/confirm`, {
    payload: {
      return_url: returnUrl,
      ...(operator ? { operator } : {}),
    },
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
