import crypto from 'crypto';
import Booking from '../models/Booking.js';
import {
  confirmPaymentIntent,
  createPaymentIntent,
  extractActionUrl,
  getDefaultAllowedOperators,
  getWireActionPage,
  getWireActionPageUrl,
  isLocalWireSandbox,
  isWireTestMode,
  retrievePaymentIntent,
  storeWireActionPage,
} from '../services/wireService.js';
import { markBookingPaidAndNotify } from '../services/bookingFulfillmentService.js';

const getFrontendUrl = () => (
  process.env.FRONTEND_URL ||
  process.env.CLIENT_URL ||
  'https://khovdteatr-web-pied.vercel.app'
).replace(/\/$/, '');

const getWireReturnUrl = (bookingId, providedUrl) => {
  if (providedUrl && /^https?:\/\//i.test(providedUrl)) return providedUrl;
  return `${getFrontendUrl()}/ticket-verify/${bookingId}`;
};

const toWireMntAmount = (amount) => Math.round(Number(amount || 0));
const fromWireMntAmount = (amount) => Number(amount || 0);

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const isUrl = (value) => /^[a-z][a-z0-9+.-]*:\/\//i.test(value || '');
const isImageUrl = (value) => (
  /^data:image\//i.test(value || '') ||
  /\.(avif|bmp|gif|ico|jpeg|jpg|png|svg|webp)(\?|#|$)/i.test(value || '')
);

const collectPaymentActionView = (value, label = 'Төлөх') => {
  const links = [];
  const qrImages = [];
  const qrTexts = [];
  const visit = (item, currentLabel, keyPath = []) => {
    if (!item) return;
    if (typeof item === 'string') {
      const key = keyPath.join('.').toLowerCase();
      if ((/qr_text|qrtext/.test(key) || (!isUrl(item) && item.length > 20)) && !isImageUrl(item)) {
        qrTexts.push(item);
        return;
      }
      if ((/qr_image|qrimage/.test(key) || isImageUrl(item)) && !/(logo|icon|avatar|thumbnail)/.test(key)) {
        qrImages.push(item);
        return;
      }
      if (isUrl(item) && !isImageUrl(item) && !/(logo|icon|avatar|thumbnail|image)/.test(key)) {
        links.push({ label: currentLabel || 'Төлөх', url: item });
      }
      return;
    }
    if (Array.isArray(item)) {
      item.forEach((child, index) => visit(child, currentLabel, [...keyPath, String(index)]));
      return;
    }
    if (typeof item === 'object') {
      const nextLabel = item.name || item.title || item.operator || item.bank || currentLabel;
      Object.entries(item).forEach(([key, child]) => visit(child, nextLabel, [...keyPath, key]));
    }
  };

  visit(value, label);
  const seenLinks = new Set();
  const uniqueLinks = links.filter((link) => {
    if (seenLinks.has(link.url)) return false;
    seenLinks.add(link.url);
    return true;
  });
  return {
    links: uniqueLinks,
    qrImages: [...new Set(qrImages)],
    qrTexts: [...new Set(qrTexts)].slice(0, 1),
  };
};

const canAccessBooking = (booking, user) => {
  if (isLocalWireSandbox()) return true;
  if (!user) return false;
  if (user.role === 'admin') return true;
  return booking.userId && String(booking.userId) === String(user._id);
};

const extractPaymentIntentId = (event) => (
  event?.data?.object?.id ||
  event?.data?.id ||
  event?.payment_intent ||
  event?.payment_intent_id ||
  event?.object?.id
);

const extractBookingId = (event) => (
  event?.data?.object?.metadata?.booking_id ||
  event?.data?.metadata?.booking_id ||
  event?.metadata?.booking_id ||
  event?.booking_id
);

const parseWireSignature = (signatureHeader = '') => (
  String(signatureHeader)
    .split(',')
    .map((part) => part.trim().split('='))
    .reduce((acc, [key, value]) => {
      if (key && value) acc[key] = value;
      return acc;
    }, {})
);

const verifyWireSignature = (rawBody, signatureHeader) => {
  const secret = process.env.WIRE_WEBHOOK_SECRET;
  if (!secret) return isWireTestMode() && process.env.NODE_ENV !== 'production';
  if (!signatureHeader) return false;

  const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ''));
  const { t: timestamp, v1 } = parseWireSignature(signatureHeader);

  if (!timestamp || !v1) return false;

  const timestampSeconds = Number(timestamp);
  const toleranceSeconds = Number(process.env.WIRE_WEBHOOK_TOLERANCE_SECONDS || 300);
  if (!Number.isFinite(timestampSeconds)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > toleranceSeconds) {
    return false;
  }

  const signedPayload = Buffer.concat([Buffer.from(`${timestamp}.`), payload]);
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  const left = Buffer.from(expected, 'hex');
  const right = Buffer.from(v1, 'hex');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
};

const verifyPaidIntentForBooking = async ({ paymentIntentId, booking, intent: providedIntent }) => {
  if (!paymentIntentId) {
    const err = new Error('PaymentIntent ID олдсонгүй.');
    err.statusCode = 400;
    throw err;
  }

  const intent = providedIntent || await retrievePaymentIntent(paymentIntentId);
  if (intent.status !== 'succeeded') {
    const err = new Error('PaymentIntent төлөгдсөн төлөвтэй биш байна.');
    err.statusCode = 400;
    throw err;
  }

  const expectedAmount = toWireMntAmount(booking.totalPrice);
  if (Number(intent.amount) !== expectedAmount || intent.currency !== 'MNT') {
    const err = new Error('PaymentIntent дүн эсвэл валют захиалгатай таарахгүй байна.');
    err.statusCode = 400;
    throw err;
  }

  return intent;
};

const reusableWireStatuses = new Set([
  'new',
  'pending',
  'processing',
  'requires_action',
  'requires_confirmation',
]);

const buildWireCheckoutData = ({
  paymentIntentId,
  intent,
  checkoutUrl,
  amount,
  allowedOperators,
  emailResult = null,
  reused = false,
}) => ({
  paymentIntentId,
  paymentIntentStatus: intent?.status || 'pending',
  checkoutUrl,
  nextAction: intent?.next_action || null,
  amount,
  allowedOperators,
  selectedOperator: intent?.selected_operator,
  livemode: intent?.livemode,
  localSandbox: isLocalWireSandbox(),
  testMode: isWireTestMode(),
  email: emailResult,
  reused,
});

export const createWireCheckout = async (req, res) => {
  try {
    const { bookingId, successUrl } = req.body || {};
    if (!bookingId) return res.status(400).json({ success: false, message: 'bookingId шаардлагатай.' });

    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ success: false, message: 'Захиалга олдсонгүй.' });
    if (!canAccessBooking(booking, req.user)) {
      return res.status(403).json({ success: false, message: 'Энэ захиалгын төлбөр үүсгэх эрхгүй байна.' });
    }
    if (booking.payment?.status === 'paid') {
      return res.status(400).json({ success: false, message: 'Энэ захиалга аль хэдийн төлөгдсөн байна.' });
    }

    const wireAmount = toWireMntAmount(booking.totalPrice);
    if (!wireAmount) return res.status(400).json({ success: false, message: 'Төлбөрийн дүн олдсонгүй.' });

    const allowedOperators = getDefaultAllowedOperators();
    const existingPaymentIntentId = booking.payment?.method === 'wire' && booking.payment?.transactionId;

    if (existingPaymentIntentId && booking.payment?.status === 'pending') {
      try {
        const existingIntent = await retrievePaymentIntent(existingPaymentIntentId, { wireAmount });
        const existingAmountMatches = (
          Number(existingIntent.amount) === wireAmount &&
          existingIntent.currency === 'MNT'
        );

        if (existingIntent.status === 'succeeded') {
          await verifyPaidIntentForBooking({
            paymentIntentId: existingPaymentIntentId,
            booking,
            intent: existingIntent,
          });
          const fulfilled = await markBookingPaidAndNotify({
            bookingId: booking._id,
            paymentMethod: 'wire',
            transactionId: existingPaymentIntentId,
          });
          return res.json({
            success: true,
            data: buildWireCheckoutData({
              paymentIntentId: existingPaymentIntentId,
              intent: existingIntent,
              checkoutUrl: `${getFrontendUrl()}/ticket-verify/${booking._id}`,
              amount: wireAmount,
              allowedOperators,
              emailResult: fulfilled.emailResult,
              reused: true,
            }),
          });
        }

        if (existingAmountMatches && reusableWireStatuses.has(String(existingIntent.status || '').toLowerCase())) {
          const checkoutUrl = extractActionUrl(existingIntent.next_action);
          if (!checkoutUrl) {
            storeWireActionPage({
              paymentIntentId: existingPaymentIntentId,
              bookingId: String(booking._id),
              amount: wireAmount,
              nextAction: existingIntent.next_action || existingIntent,
            });
          }

          return res.json({
            success: true,
            data: buildWireCheckoutData({
              paymentIntentId: existingPaymentIntentId,
              intent: existingIntent,
              checkoutUrl: checkoutUrl || getWireActionPageUrl(existingPaymentIntentId),
              amount: wireAmount,
              allowedOperators,
              reused: true,
            }),
          });
        }
      } catch (err) {
        console.warn('[Wire] Existing payment intent lookup failed, creating a new checkout:', err.message);
      }
    }

    const paymentIntent = await createPaymentIntent({
      bookingId: String(booking._id),
      wireAmount,
      allowedOperators,
    });

    const returnUrl = getWireReturnUrl(booking._id, successUrl);
    const confirmedIntent = await confirmPaymentIntent({
      bookingId: String(booking._id),
      paymentIntentId: paymentIntent.id,
      allowedOperators,
      returnUrl,
    });
    const checkoutUrl = extractActionUrl(confirmedIntent.next_action) || (confirmedIntent.status === 'succeeded' ? returnUrl : null);

    if (!checkoutUrl && confirmedIntent.status !== 'succeeded') {
      storeWireActionPage({
        paymentIntentId: paymentIntent.id,
        bookingId: String(booking._id),
        amount: wireAmount,
        nextAction: confirmedIntent.next_action || confirmedIntent,
      });
    }
    const finalCheckoutUrl = checkoutUrl || getWireActionPageUrl(paymentIntent.id);

    booking.payment.method = 'wire';
    booking.payment.status = confirmedIntent.status === 'succeeded' ? 'paid' : 'pending';
    booking.payment.transactionId = paymentIntent.id;
    await booking.save();

    let emailResult = null;
    if (confirmedIntent.status === 'succeeded') {
      const fulfilled = await markBookingPaidAndNotify({
        bookingId: booking._id,
        paymentMethod: 'wire',
        transactionId: paymentIntent.id,
      });
      emailResult = fulfilled.emailResult;
    }

    return res.status(201).json({
      success: true,
      data: buildWireCheckoutData({
        paymentIntentId: paymentIntent.id,
        intent: {
          ...paymentIntent,
          ...confirmedIntent,
          status: confirmedIntent.status || paymentIntent.status,
          next_action: confirmedIntent.next_action || null,
          selected_operator: confirmedIntent.selected_operator || paymentIntent.selected_operator,
          livemode: confirmedIntent.livemode ?? paymentIntent.livemode,
        },
        checkoutUrl: finalCheckoutUrl,
        amount: wireAmount,
        allowedOperators,
        emailResult,
      }),
    });
  } catch (err) {
    return res.status(err.statusCode || 500).json({
      success: false,
      message: err.message || 'Wire checkout үүсгэхэд алдаа гарлаа.',
      error: err.details || err.message,
    });
  }
};

export const renderWireSandboxCheckout = async (req, res) => {
  if (!isLocalWireSandbox()) {
    return res.status(404).json({ success: false, message: 'Wire sandbox checkout live mode-д идэвхгүй.' });
  }

  res.type('html').send(`<!doctype html>
<html lang="mn">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Wire Sandbox Checkout</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, sans-serif; background: #f3faf7; color: #123026; }
      main { width: min(420px, calc(100vw - 32px)); background: white; border: 1px solid #d8efe5; border-radius: 12px; padding: 28px; box-shadow: 0 16px 40px rgba(18, 48, 38, .12); }
      .badge { display: inline-flex; border-radius: 999px; background: #dcfce7; color: #166534; padding: 6px 10px; font-size: 12px; font-weight: 700; }
      h1 { margin: 18px 0 8px; font-size: 22px; }
      p { margin: 0 0 12px; line-height: 1.5; color: #4b6359; }
      code { display: block; overflow-wrap: anywhere; background: #f8fafc; padding: 10px; border-radius: 8px; color: #0f172a; }
    </style>
  </head>
  <body>
    <main>
      <span class="badge">livemode: false</span>
      <h1>Wire sandbox төлбөр амжилттай</h1>
      <p>Энэ checkout нь зөвхөн local test урсгал. Бодит банк, оператор, мөнгөний хөдөлгөөн ашиглаагүй.</p>
      <code>${req.params.paymentIntentId || ''}</code>
    </main>
  </body>
</html>`);
};

export const renderWireActionCheckout = async (req, res) => {
  const page = getWireActionPage(req.params.paymentIntentId);
  if (!page) {
    return res.status(404).type('html').send('<!doctype html><meta charset="utf-8"><h1>Checkout expired</h1><p>Checkout expired. Please try again from your booking.</p>');
  }

  const view = collectPaymentActionView(page.nextAction);
  const amountText = fromWireMntAmount(page.amount).toLocaleString('mn-MN');
  const linkButtons = view.links.map((link) => `
    <a class="pay-link" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">
      <span>${escapeHtml(link.label)}</span>
    </a>
  `).join('');
  const qrImages = view.qrImages.map((src) => `<img class="qr" src="${escapeHtml(src)}" alt="Payment QR" />`).join('');
  const qrTexts = view.qrTexts.map((text) => `
    <details class="qr-text">
      <summary>QR код харагдахгүй бол энд дарна уу</summary>
      <code>${escapeHtml(text)}</code>
    </details>
  `).join('');
  const statusUrl = `/api/wire/checkout/action/${encodeURIComponent(req.params.paymentIntentId)}/status`;
  const doneUrl = `${getFrontendUrl()}/ticket-verify/${encodeURIComponent(page.bookingId)}`;

  res.type('html').send(`<!doctype html>
<html lang="mn">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Wire checkout</title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; font-family: Arial, sans-serif; background: #f4f7f6; color: #10231d; display: grid; place-items: center; padding: 18px; }
      main { width: min(520px, 100%); background: #fff; border: 1px solid #d9e7e2; border-radius: 14px; padding: 22px; box-shadow: 0 18px 45px rgba(16, 35, 29, .12); }
      .brand { display: flex; align-items: center; gap: 10px; font-weight: 800; color: #047857; }
      .badge { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 9px; background: #059669; color: #fff; }
      h1 { margin: 18px 0 8px; font-size: 24px; }
      .amount { font-size: 32px; font-weight: 800; margin: 8px 0 18px; }
      .hint { color: #5d6f68; line-height: 1.5; margin: 0 0 18px; }
      .qr-wrap { display: grid; place-items: center; gap: 12px; margin: 16px 0; }
      .qr { width: min(280px, 100%); border: 1px solid #e5ece9; border-radius: 12px; padding: 10px; background: #fff; }
      .links { display: grid; gap: 10px; margin-top: 14px; }
      .pay-link { display: block; text-align: center; text-decoration: none; border: 1px solid #047857; background: #059669; color: white; border-radius: 10px; padding: 13px 14px; font-weight: 800; }
      .qr-text { margin-top: 12px; border: 1px solid #e5ece9; border-radius: 10px; padding: 12px; background: #f8fafc; }
      code { display: block; margin-top: 8px; overflow-wrap: anywhere; color: #0f172a; }
      .empty { border: 1px solid #fecaca; background: #fef2f2; color: #991b1b; border-radius: 10px; padding: 12px; line-height: 1.45; }
      .status { margin-top: 16px; border-radius: 10px; padding: 12px; background: #f0fdf4; color: #166534; font-weight: 700; text-align: center; }
      .muted { color: #5d6f68; font-size: 13px; text-align: center; margin-top: 8px; }
    </style>
  </head>
  <body>
    <main>
      <div class="brand"><span class="badge">W</span><span>Wire checkout</span></div>
      <h1>Төлбөрөө үргэлжлүүлнэ үү</h1>
      <div class="amount">${escapeHtml(amountText)} ₮</div>
      <p class="hint">QR-г банкны апп-аараа уншуулж төлнө үү. Төлбөр ормогц энэ хуудас өөрөө шалгаад тасалбар руу шилжинэ.</p>
      <div class="qr-wrap">${qrImages}</div>
      <div class="links">${linkButtons}</div>
      ${qrTexts}
      ${!qrImages && !linkButtons && !qrTexts ? '<div class="empty">Төлбөрийн мэдээлэл ирсэн боловч харуулах QR эсвэл холбоос олдсонгүй. Захиалгаас дахин оролдоно уу.</div>' : ''}
      <div id="status" class="status">Төлбөр шалгаж байна...</div>
      <div class="muted">Энэ цонхыг хаахгүй байвал төлөгдмөгц автоматаар шилжинэ.</div>
    </main>
    <script>
      const statusEl = document.getElementById('status');
      const statusUrl = ${JSON.stringify(statusUrl)};
      const doneUrl = ${JSON.stringify(doneUrl)};
      let done = false;
      async function checkPaid() {
        if (done) return;
        try {
          const res = await fetch(statusUrl, { cache: 'no-store' });
          const data = await res.json();
          if (data && data.paid) {
            done = true;
            statusEl.textContent = 'Төлбөр амжилттай. Тасалбар руу шилжүүлж байна...';
            statusEl.style.background = '#dcfce7';
            if (window.opener) {
              try { window.opener.postMessage({ type: 'wire-paid', bookingId: data.bookingId }, window.location.origin); } catch {}
            }
            setTimeout(() => { window.location.href = data.redirectUrl || doneUrl; }, 900);
            return;
          }
          statusEl.textContent = 'Төлбөр хүлээгдэж байна...';
        } catch {
          statusEl.textContent = 'Төлбөрийн төлөв шалгах түр алдаа. Дахин шалгаж байна...';
        }
      }
      checkPaid();
      setInterval(checkPaid, 2500);
    </script>
  </body>
</html>`);
};

export const getWireActionCheckoutStatus = async (req, res) => {
  try {
    const page = getWireActionPage(req.params.paymentIntentId);
    if (!page) return res.status(404).json({ success: false, paid: false, message: 'Checkout expired.' });

    const booking = await Booking.findById(page.bookingId);
    if (!booking) return res.status(404).json({ success: false, paid: false, message: 'Booking not found.' });

    if (booking.payment?.status === 'paid') {
      return res.json({
        success: true,
        paid: true,
        bookingId: booking._id,
        status: 'paid',
        redirectUrl: `${getFrontendUrl()}/ticket-verify/${booking._id}`,
      });
    }

    const intent = await retrievePaymentIntent(req.params.paymentIntentId, {
      wireAmount: toWireMntAmount(booking.totalPrice),
    });

    if (intent.status === 'succeeded') {
      await verifyPaidIntentForBooking({ paymentIntentId: req.params.paymentIntentId, booking, intent });
      await markBookingPaidAndNotify({
        bookingId: booking._id,
        paymentMethod: 'wire',
        transactionId: req.params.paymentIntentId,
      });
      return res.json({
        success: true,
        paid: true,
        bookingId: booking._id,
        status: 'paid',
        redirectUrl: `${getFrontendUrl()}/ticket-verify/${booking._id}`,
      });
    }

    return res.json({ success: true, paid: false, bookingId: booking._id, status: intent.status || 'pending' });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, paid: false, message: err.message, error: err.details || err.message });
  }
};

export const getWirePaymentStatus = async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.bookingId);
    if (!booking) return res.status(404).json({ success: false, message: 'Захиалга олдсонгүй.' });
    if (!canAccessBooking(booking, req.user)) {
      return res.status(403).json({ success: false, message: 'Энэ захиалгын төлөв шалгах эрхгүй байна.' });
    }

    if (booking.payment?.status === 'paid') {
      return res.json({ success: true, paid: true, bookingId: booking._id, status: 'paid' });
    }

    const paymentIntentId = booking.payment?.transactionId;
    if (!paymentIntentId) {
      return res.json({ success: true, paid: false, bookingId: booking._id, status: booking.payment?.status || 'pending' });
    }

    const intent = await retrievePaymentIntent(paymentIntentId, {
      wireAmount: toWireMntAmount(booking.totalPrice),
    });
    if (intent.status === 'succeeded') {
      await verifyPaidIntentForBooking({ paymentIntentId, booking, intent });
      const { emailResult } = await markBookingPaidAndNotify({
        bookingId: booking._id,
        paymentMethod: 'wire',
        transactionId: paymentIntentId,
      });
      return res.json({ success: true, paid: true, bookingId: booking._id, status: 'paid', email: emailResult });
    }

    return res.json({ success: true, paid: false, bookingId: booking._id, status: intent.status || 'pending' });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message, error: err.details || err.message });
  }
};

export const handleWireWebhook = async (req, res) => {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body || {}));
    const signature = req.get('WirePayment-Signature');

    if (!verifyWireSignature(rawBody, signature)) {
      return res.status(400).json({ success: false, message: 'Wire webhook signature буруу байна.' });
    }

    const event = JSON.parse(rawBody.toString('utf8'));
    if (event.type !== 'payment_intent.succeeded') {
      return res.json({ received: true });
    }

    const paymentIntentId = extractPaymentIntentId(event);
    let bookingId = extractBookingId(event);

    if (!bookingId && paymentIntentId) {
      const booking = await Booking.findOne({ 'payment.transactionId': paymentIntentId });
      bookingId = booking?._id;
    }

    if (!bookingId) {
      return res.status(400).json({ success: false, message: 'Webhook дээр bookingId олдсонгүй.' });
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Захиалга олдсонгүй.' });
    }

    await verifyPaidIntentForBooking({ paymentIntentId, booking });

    const { emailResult } = await markBookingPaidAndNotify({
      bookingId,
      paymentMethod: 'wire',
      transactionId: paymentIntentId,
    });

    return res.json({ received: true, email: emailResult });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, message: err.message, error: err.details || err.message });
  }
};
