// cinema-back/src/services/Emailservice.js
import nodemailer from 'nodemailer';
import dns from 'dns/promises';

/**
 * Nodemailer transporter-г үүсгэх helper.
 * Gmail холболтыг verify хийж, холбогдож чадахгүй бол шалтгааныг лог руу бичнэ.
 */
const createVerifiedTransporter = async (USER, PASS) => {
  let smtpHosts = ['smtp.gmail.com'];
  try {
    const ipv4Hosts = await dns.resolve4('smtp.gmail.com');
    if (ipv4Hosts.length) smtpHosts = ipv4Hosts;
    console.log('[Email] Gmail SMTP IPv4 hosts:', smtpHosts.join(', '));
  } catch (dnsErr) {
    console.warn('[Email] Gmail IPv4 resolve амжилтгүй, hostname ашиглана:', dnsErr.message);
  }

  const configs = smtpHosts.flatMap((host) => [
    { host, port: 587, secure: false, requireTLS: true, name: `gmail-587-starttls-${host}` },
    { host, port: 465, secure: true, name: `gmail-465-ssl-${host}` },
  ]);

  const baseTls = {
    servername: 'smtp.gmail.com',
  };

  const baseOptions = [
    {
      connectionTimeout: 12000,
      greetingTimeout: 12000,
      socketTimeout: 18000,
    },
    {
      localAddress: '0.0.0.0',
      connectionTimeout: 12000,
      greetingTimeout: 12000,
      socketTimeout: 18000,
    },
  ];

  let lastError = null;

  for (const config of configs) {
    for (const options of baseOptions) {
      const label = `${config.name}${options.localAddress ? '-local4' : ''}`;
      const transporter = nodemailer.createTransport({
        ...config,
        ...options,
        tls: baseTls,
        auth: { user: USER, pass: PASS },
      });

      try {
        await transporter.verify();
        console.log(`[Email] ✅ Gmail холболт амжилттай: ${label}`);
        return transporter;
      } catch (verifyErr) {
        lastError = verifyErr;
        console.error(`[Email] ❌ Gmail холболт амжилтгүй: ${label}`, {
          message: verifyErr.message,
          code: verifyErr.code,
          command: verifyErr.command,
          response: verifyErr.response,
        });
      }
    }
  }

  throw lastError || new Error('Gmail SMTP холболт амжилтгүй.');
};

const getEmailFrom = (fallbackUser) => (
  process.env.EMAIL_FROM ||
  process.env.RESEND_FROM ||
  (fallbackUser ? `"Хөгжимт Драмын Театр" <${fallbackUser}>` : 'Khovd Teatr <onboarding@resend.dev>')
);

const sendViaResend = async ({ to, subject, html, text, fallbackUser }) => {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { configured: false };
  if (typeof fetch !== 'function') {
    return { configured: true, success: false, provider: 'resend', error: 'fetch_unavailable' };
  }

  const from = getEmailFrom(fallbackUser);
  console.log('[Email/Resend] Илгээж байна...', { to, from });

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, html, text }),
    });

    const raw = await response.text();
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = { raw }; }

    if (!response.ok) {
      console.error('[Email/Resend] Алдаа:', response.status, data);
      return { configured: true, success: false, provider: 'resend', status: response.status, error: data };
    }

    console.log('[Email/Resend] ✅ Амжилттай:', data?.id || data);
    return { configured: true, success: true, provider: 'resend', messageId: data?.id };
  } catch (err) {
    console.error('[Email/Resend] Илгээхэд алдаа:', err.message);
    return { configured: true, success: false, provider: 'resend', error: err.message };
  }
};

const getFrontendUrl = () => (
  process.env.FRONTEND_URL ||
  process.env.CLIENT_URL ||
  'https://khovdteatr-web-pied.vercel.app'
).replace(/\/$/, '');

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const buildTicketVerifyUrl = (orderId) => `${getFrontendUrl()}/ticket-verify/${encodeURIComponent(orderId)}`;
const buildQrImageUrl = (value) => `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=14&data=${encodeURIComponent(value)}`;
const formatTicketType = (type) => (type === 'child' ? 'Хүүхэд' : 'Том хүн');
const formatMoney = (value) => `${Number(value || 0).toLocaleString('mn-MN')}₮`;

const buildGoogleCalendarUrl = ({ movieTitle, date, time, hall, orderId }) => {
  const start = new Date(`${date}T${time || '00:00'}:00+08:00`);
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
  const toGoogleDate = (value) => value.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: movieTitle || 'Тасалбар',
    dates: `${toGoogleDate(start)}/${toGoogleDate(end)}`,
    details: `Захиалгын дугаар: ${orderId}\nТасалбар шалгах: ${buildTicketVerifyUrl(orderId)}\nҮзвэр эхлэхээс 10-15 минутын өмнө ирнэ үү.`,
    location: hall || 'Ховд аймаг Хөгжимт драмын театр',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
};

export const sendBookingConfirmation = async ({
  to, orderId, movieTitle, date, time, hall,
  seats, tickets, totalPrice, customer,
}) => {
  const USER = process.env.GMAIL_USER || process.env.EMAIL_USER || process.env.SMTP_USER;
  const RAW_PASS = process.env.GMAIL_APP_PASS || process.env.GMAIL_APP_PASSWORD || process.env.GMAIL_PASS || process.env.EMAIL_PASS || process.env.SMTP_PASS;
  const PASS = RAW_PASS?.replace(/\s/g, '');

  console.log('[Email] ── sendBookingConfirmation эхэллээ ──');
  console.log('[Email] USER:', USER, '| PASS length:', PASS?.length ?? 'UNDEFINED');
  console.log('[Email] To:', to, '| OrderId:', orderId, '| Movie:', movieTitle);

  if (!to) {
    console.warn('[Email] ⚠ Recipient address (to) байхгүй байна — skip.');
    return { success: false, reason: 'missing_recipient' };
  }

  const money = (n) => Number(n).toLocaleString('mn-MN') + '₮';
  const seatList = Array.isArray(seats) ? seats.join(', ') : seats;
  const adults   = tickets?.filter(t => t.type === 'adult') || [];
  const children = tickets?.filter(t => t.type === 'child') || [];

  const html = `<!DOCTYPE html>
<html lang="mn">
<head><meta charset="UTF-8"/><title>Тасалбар</title>
<style>
body{margin:0;padding:0;background:#0a0a12;font-family:'Segoe UI',Arial,sans-serif;color:#e8e6f0;}
.wrap{max-width:540px;margin:0 auto;padding:2rem 1rem;}
.header{text-align:center;padding:2rem 0 1.5rem;}
.h-title{font-size:1.5rem;font-weight:800;color:#fff;margin-bottom:.3rem;}
.h-sub{font-size:.82rem;color:#6b6880;}
.ticket{background:#12121e;border:1px solid rgba(201,168,76,.35);border-radius:20px;overflow:hidden;margin:1.5rem 0;}
.bar{height:8px;background:linear-gradient(90deg,#c9a84c,#f0cc7a,#c9a84c);}
.box{padding:1.5rem;}
.badge{display:inline-block;padding:.2rem .6rem;border-radius:20px;background:rgba(201,168,76,.1);border:1px solid rgba(201,168,76,.3);font-size:.58rem;color:#f0cc7a;letter-spacing:.15em;text-transform:uppercase;margin-bottom:.5rem;}
.title{font-size:1.4rem;font-weight:800;color:#fff;margin-bottom:.25rem;}
.sub{font-size:.62rem;color:#6b6880;margin-bottom:1.25rem;}
table{width:100%;border-collapse:collapse;background:#1a1a2e;border-radius:12px;margin-bottom:1.25rem;}
td{padding:.9rem .8rem;border-right:1px solid rgba(201,168,76,.15);width:33%;}
td:last-child{border-right:none;}
.lbl{font-size:.52rem;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#9896b0;display:block;margin-bottom:.3rem;}
.val{font-size:.82rem;font-weight:700;color:#f0cc7a;}
.seats{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;margin-bottom:1.25rem;}
.chip{display:inline-block;padding:.25rem .6rem;border-radius:6px;background:rgba(201,168,76,.1);border:1px solid rgba(201,168,76,.3);font-size:.72rem;font-weight:700;color:#f0cc7a;}
.price{display:flex;justify-content:space-between;align-items:center;padding:.85rem 1rem;border-radius:10px;background:rgba(201,168,76,.1);border:1px solid rgba(201,168,76,.25);margin-bottom:1rem;}
.plbl{font-size:.62rem;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:#c9a84c;}
.pval{font-size:1.3rem;font-weight:800;color:#f0cc7a;}
.perf{border-top:2px dashed rgba(201,168,76,.25);}
.stub{padding:1.25rem 1.5rem;background:#1a1a2e;}
.oid{font-size:.85rem;font-weight:700;color:#f0cc7a;letter-spacing:.1em;margin-bottom:.4rem;}
.note{font-size:.62rem;color:#6b6880;line-height:1.65;}
.footer{text-align:center;padding:1.5rem 0;border-top:1px solid rgba(255,255,255,.06);font-size:.68rem;color:#6b6880;line-height:1.7;}
</style>
</head>
<body><div class="wrap">
<div class="header">
  <div class="h-title">Захиалга амжилттай!</div>
  <div class="h-sub">Сайн байна уу, ${customer?.name || 'Үйлчлүүлэгч'}! Тасалбарын мэдээлэл дор байна.</div>
</div>
<div class="ticket">
  <div class="bar"></div>
  <div class="box">
    <div class="badge">ТАСАЛБАР</div>
    <div class="title">${movieTitle}</div>
    <div class="sub">● ХОВД АЙМАГ ХӨГЖИМТ ДРАМЫН ТЕАТР</div>
    <table>
      <tr>
        <td><span class="lbl">Огноо</span><span class="val">${date}</span></td>
        <td><span class="lbl">Цаг</span><span class="val">${time}</span></td>
        <td><span class="lbl">Танхим</span><span class="val">${hall || '—'}</span></td>
      </tr>
    </table>
    <div class="seats">
      <span class="lbl" style="white-space:nowrap">Суудал</span>
      ${Array.isArray(seats) ? seats.map(s => `<span class="chip">${s}</span>`).join('') : `<span class="chip">${seatList}</span>`}
    </div>
    ${adults.length > 0 || children.length > 0 ? `<p style="font-size:.72rem;color:#9896b0;margin-bottom:1rem;">
      ${adults.length   > 0 ? `👤 Том хүн × ${adults.length}   ` : ''}
      ${children.length > 0 ? `🧒 Хүүхэд × ${children.length}` : ''}
    </p>` : ''}
    <div class="price">
      <span class="plbl">Нийт төлбөр</span>
      <span class="pval">${money(totalPrice)}</span>
    </div>
  </div>
  <div class="perf"></div>
  <div class="stub">
    <div class="oid">${orderId}</div>
    <div class="note">⏰ Үзвэр эхлэхээс 15 минутын өмнө ирнэ үү.<br/>ℹ️ Тасалбар буцаах боломжгүй.<br/>📞 Лавлах: +976 7038-0000</div>
  </div>
</div>
<div class="footer">ХОВД АЙМАГ ХӨГЖИМТ ДРАМЫН ТЕАТР<br/>Энэхүү и-мэйлийг автоматаар илгээсэн болно.</div>
</div></body></html>`;

  const subject = `🎫 Тасалбар: ${movieTitle} — ${orderId}`;
  const text = `Захиалга амжилттай!\nДугаар: ${orderId}\nҮзвэр: ${movieTitle}\nОгноо: ${date} ${time}\nСуудал: ${seatList}\nНийт: ${money(totalPrice)}`;

  const verifyUrl = buildTicketVerifyUrl(orderId);
  const qrImageUrl = buildQrImageUrl(verifyUrl);
  const calendarUrl = buildGoogleCalendarUrl({ movieTitle, date, time, hall, orderId });
  const ticketItems = (tickets?.length ? tickets : (seats || []).map((seatId) => ({ seatId, type: 'adult' })));
  const ticketRows = ticketItems.map((ticket) => `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #edf1f7;color:#111827;font-weight:800;">${escapeHtml(ticket.seatId)}</td>
      <td style="padding:10px 0;border-bottom:1px solid #edf1f7;color:#5b6474;text-align:right;">${formatTicketType(ticket.type)}</td>
    </tr>
  `).join('');

  const finalSubject = `Тасалбар: ${movieTitle} — ${orderId}`;
  const finalText = `Захиалга амжилттай!\nДугаар: ${orderId}\nҮзвэр: ${movieTitle}\nОгноо: ${date} ${time}\nТанхим: ${hall || ''}\nСуудал: ${seatList}\nНийт: ${formatMoney(totalPrice)}\nQR/тасалбар: ${verifyUrl}`;
  let finalHtml = `<!DOCTYPE html>
<html lang="mn">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Тасалбар</title></head>
<body style="margin:0;padding:0;background:#f7f8fc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#111827;">
  <div style="display:none;max-height:0;overflow:hidden;">Тасалбар баталгаажлаа. Үүдэнд QR кодоо уншуулна уу.</div>
  <div style="max-width:680px;margin:0 auto;padding:28px 14px;background:linear-gradient(135deg,#fff7ed 0%,#f8fafc 42%,#eef2ff 100%);">
    <div style="text-align:center;margin:8px 0 22px;">
      <div style="display:inline-block;padding:7px 12px;border-radius:999px;background:#111827;color:#ffffff;font-size:11px;font-weight:800;letter-spacing:.08em;">ТӨЛБӨР БАТАЛГААЖЛАА</div>
      <h1 style="margin:14px 0 6px;font-size:26px;line-height:1.2;color:#111827;">${escapeHtml(movieTitle)}</h1>
      <p style="margin:0;color:#667085;font-size:14px;">Сайн байна уу, ${escapeHtml(customer?.name || 'үзэгч')}! Үүдэнд доорх QR кодыг уншуулна уу.</p>
    </div>

    <div style="border-radius:30px;padding:1px;background:linear-gradient(135deg,rgba(255,255,255,.9),rgba(251,191,36,.5),rgba(99,102,241,.35));box-shadow:0 24px 70px rgba(31,41,55,.14);">
      <div style="border-radius:29px;background:rgba(255,255,255,.82);border:1px solid rgba(255,255,255,.9);overflow:hidden;">
        <div style="height:10px;background:linear-gradient(90deg,#f59e0b,#f97316,#6366f1);"></div>
        <div style="padding:24px 24px 18px;">
          <div style="font-size:11px;font-weight:900;letter-spacing:.16em;color:#f97316;margin-bottom:10px;">THE GLASSMORPHISM TICKET</div>
          <div style="font-size:13px;color:#667085;margin-bottom:22px;">ХОВД АЙМАГ ХӨГЖИМТ ДРАМЫН ТЕАТР</div>

          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:separate;border-spacing:0 10px;">
            <tr>
              <td style="width:33%;padding:14px;border-radius:18px 0 0 18px;background:rgba(248,250,252,.95);border:1px solid #eef2f7;border-right:0;">
                <div style="font-size:10px;color:#8a94a6;font-weight:900;letter-spacing:.12em;">ОГНОО</div>
                <div style="margin-top:6px;font-size:16px;color:#111827;font-weight:900;">${escapeHtml(date)}</div>
              </td>
              <td style="width:33%;padding:14px;background:rgba(248,250,252,.95);border-top:1px solid #eef2f7;border-bottom:1px solid #eef2f7;">
                <div style="font-size:10px;color:#8a94a6;font-weight:900;letter-spacing:.12em;">ЦАГ</div>
                <div style="margin-top:6px;font-size:16px;color:#111827;font-weight:900;">${escapeHtml(time)}</div>
              </td>
              <td style="width:34%;padding:14px;border-radius:0 18px 18px 0;background:rgba(248,250,252,.95);border:1px solid #eef2f7;border-left:0;">
                <div style="font-size:10px;color:#8a94a6;font-weight:900;letter-spacing:.12em;">ТАНХИМ</div>
                <div style="margin-top:6px;font-size:16px;color:#111827;font-weight:900;">${escapeHtml(hall || 'Танхим')}</div>
              </td>
            </tr>
          </table>

          <div style="margin-top:8px;padding:16px;border-radius:20px;background:#111827;color:#ffffff;">
            <div style="font-size:11px;color:#cbd5e1;font-weight:900;letter-spacing:.14em;margin-bottom:10px;">СУУДАЛ БА АНГИЛАЛ</div>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background:#ffffff;border-radius:14px;overflow:hidden;">
              ${ticketRows}
            </table>
          </div>

          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:16px;border-collapse:collapse;">
            <tr>
              <td style="padding:16px;border-radius:18px;background:#fff7ed;border:1px solid #fed7aa;">
                <div style="font-size:11px;color:#9a3412;font-weight:900;letter-spacing:.12em;">НИЙТ ТӨЛБӨР</div>
                <div style="margin-top:4px;font-size:26px;font-weight:950;color:#111827;">${formatMoney(totalPrice)}</div>
              </td>
              <td style="width:14px;"></td>
              <td style="padding:16px;border-radius:18px;background:#eef2ff;border:1px solid #c7d2fe;">
                <div style="font-size:11px;color:#4338ca;font-weight:900;letter-spacing:.12em;">ЗАХИАЛГА</div>
                <div style="margin-top:6px;font-size:13px;font-weight:850;color:#111827;word-break:break-all;">${escapeHtml(orderId)}</div>
              </td>
            </tr>
          </table>
        </div>

        <div style="border-top:2px dashed #e5e7eb;padding:22px 24px 26px;background:rgba(255,255,255,.9);text-align:center;">
          <div style="font-size:12px;color:#667085;font-weight:800;margin-bottom:12px;">ҮҮДЭНД УНШУУЛАХ QR</div>
          <div style="display:inline-block;padding:14px;border-radius:24px;background:#ffffff;border:1px solid #e5e7eb;box-shadow:0 12px 32px rgba(17,24,39,.12);">
            <img src="${qrImageUrl}" width="240" height="240" alt="Ticket QR" style="display:block;width:240px;height:240px;border:0;"/>
          </div>
          <p style="margin:14px auto 0;max-width:420px;color:#667085;font-size:13px;line-height:1.55;">QR уншихгүй бол захиалгын дугаарыг хэлнэ үү: <strong style="color:#111827;">${escapeHtml(orderId)}</strong></p>
          <div style="margin-top:18px;">
            <a href="${verifyUrl}" style="display:inline-block;text-decoration:none;background:#111827;color:#ffffff;border-radius:14px;padding:12px 18px;font-weight:900;font-size:13px;">Тасалбар нээх</a>
            <a href="${calendarUrl}" style="display:inline-block;text-decoration:none;background:#ffffff;color:#111827;border:1px solid #d0d5dd;border-radius:14px;padding:12px 18px;font-weight:900;font-size:13px;margin-left:8px;">Календарьт нэмэх</a>
          </div>
        </div>
      </div>
    </div>

    <div style="margin:20px 0 4px;padding:16px;border-radius:20px;background:rgba(255,255,255,.72);border:1px solid #eef2f7;color:#667085;font-size:13px;line-height:1.65;">
      <strong style="color:#111827;">Санамж:</strong> Үзвэр эхлэхээс 10-15 минутын өмнө ирнэ үү. Тасалбар буцаах боломжгүй. QR код эсвэл захиалгын дугаараа үүдэнд үзүүлнэ.
    </div>

    <div style="text-align:center;color:#98a2b3;font-size:12px;padding:16px 0 4px;">ХОВД АЙМАГ ХӨГЖИМТ ДРАМЫН ТЕАТР</div>
  </div>
</body></html>`;

  const simpleSeatBadges = ticketItems.map((ticket) => (
    `<span style="display:inline-block;margin:0 6px 8px 0;padding:8px 11px;border-radius:10px;background:#111827;color:#ffffff;font-size:13px;font-weight:800;">${escapeHtml(ticket.seatId)} <span style="color:#cbd5e1;font-weight:600;">${formatTicketType(ticket.type)}</span></span>`
  )).join('');

  finalHtml = `<!DOCTYPE html>
<html lang="mn">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Тасалбар</title>
</head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#111827;">
  <div style="display:none;max-height:0;overflow:hidden;">Таны тасалбар баталгаажлаа. Үүдэнд QR кодоо уншуулна уу.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#eef2f7;border-collapse:collapse;">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;border-collapse:separate;border-spacing:0;">
          <tr>
            <td style="padding:0 0 14px;text-align:center;">
              <div style="display:inline-block;padding:7px 13px;border-radius:999px;background:#111827;color:#ffffff;font-size:11px;font-weight:800;letter-spacing:.08em;">ТӨЛБӨР БАТАЛГААЖЛАА</div>
              <h1 style="margin:14px 0 4px;font-size:28px;line-height:1.18;color:#111827;font-weight:900;">${escapeHtml(movieTitle)}</h1>
              <p style="margin:0;color:#64748b;font-size:14px;line-height:1.5;">Сайн байна уу, ${escapeHtml(customer?.name || 'үзэгч')}! Доорх QR кодыг үүдэнд уншуулна уу.</p>
            </td>
          </tr>

          <tr>
            <td style="border-radius:28px;background:#ffffff;border:1px solid #dbe4f0;box-shadow:0 18px 48px rgba(15,23,42,.12);overflow:hidden;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                <tr>
                  <td style="height:8px;background:linear-gradient(90deg,#f59e0b,#fb7185,#6366f1);font-size:0;line-height:0;">&nbsp;</td>
                </tr>
                <tr>
                  <td style="padding:24px 24px 18px;">
                    <div style="font-size:12px;font-weight:900;letter-spacing:.18em;color:#f97316;margin-bottom:6px;">E-TICKET</div>
                    <div style="font-size:13px;color:#64748b;margin-bottom:20px;">Ховд аймаг Хөгжимт Драмын Театр</div>

                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:14px;">
                      <tr>
                        <td style="width:50%;padding:12px;border-radius:16px 0 0 16px;background:#f8fafc;border:1px solid #e2e8f0;border-right:0;">
                          <div style="font-size:11px;color:#64748b;font-weight:800;letter-spacing:.12em;">ОГНОО</div>
                          <div style="margin-top:5px;font-size:18px;color:#111827;font-weight:900;">${escapeHtml(date)}</div>
                        </td>
                        <td style="width:50%;padding:12px;border-radius:0 16px 16px 0;background:#f8fafc;border:1px solid #e2e8f0;">
                          <div style="font-size:11px;color:#64748b;font-weight:800;letter-spacing:.12em;">ЦАГ</div>
                          <div style="margin-top:5px;font-size:18px;color:#111827;font-weight:900;">${escapeHtml(time)}</div>
                        </td>
                      </tr>
                    </table>

                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:16px;">
                      <tr>
                        <td style="width:50%;padding:12px;border-radius:16px 0 0 16px;background:#fff7ed;border:1px solid #fed7aa;border-right:0;">
                          <div style="font-size:11px;color:#9a3412;font-weight:800;letter-spacing:.12em;">ТАНХИМ</div>
                          <div style="margin-top:5px;font-size:16px;color:#111827;font-weight:900;">${escapeHtml(hall || 'Танхим')}</div>
                        </td>
                        <td style="width:50%;padding:12px;border-radius:0 16px 16px 0;background:#eef2ff;border:1px solid #c7d2fe;">
                          <div style="font-size:11px;color:#4338ca;font-weight:800;letter-spacing:.12em;">ЗАХИАЛГА</div>
                          <div style="margin-top:5px;font-size:13px;color:#111827;font-weight:900;word-break:break-all;">${escapeHtml(orderId)}</div>
                        </td>
                      </tr>
                    </table>

                    <div style="font-size:11px;color:#64748b;font-weight:900;letter-spacing:.14em;margin-bottom:10px;">СУУДАЛ</div>
                    <div style="margin-bottom:18px;">${simpleSeatBadges || `<span style="color:#64748b;">${escapeHtml(seatList || '')}</span>`}</div>

                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                      <tr>
                        <td style="padding:16px;border-radius:18px;background:#111827;color:#ffffff;">
                          <div style="font-size:11px;color:#cbd5e1;font-weight:900;letter-spacing:.14em;">НИЙТ ТӨЛБӨР</div>
                          <div style="margin-top:4px;font-size:28px;font-weight:950;color:#ffffff;">${formatMoney(totalPrice)}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="border-top:2px dashed #dbe4f0;padding:22px 24px 26px;text-align:center;background:#fbfdff;">
                    <div style="font-size:12px;color:#64748b;font-weight:900;letter-spacing:.12em;margin-bottom:12px;">ҮҮДЭНД УНШУУЛАХ QR</div>
                    <div style="display:inline-block;padding:12px;border-radius:20px;background:#ffffff;border:1px solid #e2e8f0;">
                      <img src="${qrImageUrl}" width="220" height="220" alt="Ticket QR" style="display:block;width:220px;height:220px;border:0;"/>
                    </div>
                    <p style="margin:14px auto 0;max-width:420px;color:#64748b;font-size:13px;line-height:1.55;">QR уншихгүй бол захиалгын дугаараа хэлнэ үү: <strong style="color:#111827;">${escapeHtml(orderId)}</strong></p>
                    <div style="margin-top:18px;">
                      <a href="${verifyUrl}" style="display:inline-block;text-decoration:none;background:#111827;color:#ffffff;border-radius:12px;padding:12px 17px;font-weight:900;font-size:13px;">Тасалбар нээх</a>
                      <a href="${calendarUrl}" style="display:inline-block;text-decoration:none;background:#ffffff;color:#111827;border:1px solid #cbd5e1;border-radius:12px;padding:12px 17px;font-weight:900;font-size:13px;margin-left:6px;">Календарьт нэмэх</a>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:16px 6px 0;color:#64748b;font-size:13px;line-height:1.65;text-align:center;">
              Үзвэр эхлэхээс 10-15 минутын өмнө ирнэ үү. Тасалбар буцаах боломжгүй.
              <br/>Ховд аймаг Хөгжимт Драмын Театр
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const resendResult = await sendViaResend({ to, subject: finalSubject, html: finalHtml, text: finalText, fallbackUser: USER });
  if (resendResult.configured) {
    if (resendResult.success) return resendResult;
    console.warn('[Email] Resend амжилтгүй тул Gmail SMTP fallback оролдоно.', resendResult.error || resendResult.status);
  }

  if (!USER || !PASS) {
    console.warn('[Email] ⚠ HTTP provider болон Gmail credentials тохируулаагүй.');
    return { success: false, reason: 'not_configured', resend: resendResult };
  }

  let transporter;
  try {
    transporter = await createVerifiedTransporter(USER, PASS);
  } catch (err) {
    console.error('[Email] ❌ SMTP холболт/нэвтрэлт амжилтгүй:', {
      message: err.message,
      code: err.code,
      command: err.command,
      response: err.response,
      responseCode: err.responseCode,
    });
    return {
      success: false,
      reason: err.code === 'EAUTH' ? 'smtp_auth_failed' : 'smtp_connect_failed',
      error: err.message,
      code: err.code,
      command: err.command,
      response: err.response,
      responseCode: err.responseCode,
      resend: resendResult,
    };
  }

  try {
    console.log('[Email] 📤 Илгээж байна... To:', to);
    const info = await transporter.sendMail({
      from:    getEmailFrom(USER),
      to,
      subject: finalSubject,
      html: finalHtml,
      text: finalText,
    });
    console.log('[Email] ✅ Амжилттай илгээгдлээ:', info.messageId, '→', to);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[Email] ❌ Илгээхэд алдаа гарлаа:', err.message);
    console.error('[Email] ❌ Дэлгэрэнгүй:', {
      code: err.code,
      command: err.command,
      response: err.response,
      responseCode: err.responseCode,
      to,
      stack: err.stack,
    });
    return {
      success: false,
      error: err.message,
      code: err.code,
      command: err.command,
      response: err.response,
      responseCode: err.responseCode,
    };
  }
};

export const sendNewMovieNotification = async ({ to, userName, movie, frontendUrl }) => {
  const USER = process.env.GMAIL_USER || process.env.EMAIL_USER || process.env.SMTP_USER;
  const RAW_PASS = process.env.GMAIL_APP_PASS || process.env.GMAIL_APP_PASSWORD || process.env.GMAIL_PASS || process.env.EMAIL_PASS || process.env.SMTP_PASS;
  const PASS = RAW_PASS?.replace(/\s/g, '');

  const url = frontendUrl || 'https://khovdteatr-web-pied.vercel.app';
  const title = movie?.title || 'Шинэ үзвэр';
  const genre = Array.isArray(movie?.genre) ? movie.genre.join(', ') : movie?.genre || 'Төрөл тодорхойгүй';
  const subject = `Шинэ үзвэр нэмэгдлээ: ${title}`;
  const html = `<!DOCTYPE html>
<html lang="mn">
<head><meta charset="UTF-8"/><title>Шинэ үзвэр</title></head>
<body style="margin:0;background:#0a0a12;color:#e8e6f0;font-family:Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:28px 18px;">
    <div style="border:1px solid rgba(201,168,76,.35);border-radius:18px;padding:24px;background:#12121e;">
      <p style="color:#f0cc7a;font-size:12px;letter-spacing:.14em;text-transform:uppercase;margin:0 0 12px;">Шинэ үзвэр</p>
      <h1 style="margin:0 0 12px;color:#fff;font-size:24px;">${title}</h1>
      <p style="margin:0 0 10px;color:#b8b4ca;">Сайн байна уу, ${userName || 'үзэгч'}! Манай системд шинэ үзвэр нэмэгдлээ.</p>
      <p style="margin:0 0 18px;color:#8f8aa3;">Төрөл: ${genre}</p>
      <a href="${url}" style="display:inline-block;background:#c9a84c;color:#111827;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:10px;">Үзвэр үзэх</a>
    </div>
  </div>
</body>
</html>`;
  const text = `Сайн байна уу, ${userName || 'үзэгч'}!\nШинэ үзвэр нэмэгдлээ: ${title}\nТөрөл: ${genre}\n${url}`;

  const resendResult = await sendViaResend({ to, subject, html, text, fallbackUser: USER });
  if (resendResult.configured) {
    if (resendResult.success) return resendResult;
    console.warn('[Email] Resend notification амжилтгүй тул Gmail SMTP fallback оролдоно.', resendResult.error || resendResult.status);
  }

  if (!USER || !PASS) {
    console.warn('[Email] HTTP provider болон Gmail credentials тохируулаагүй.');
    return { success: false, reason: 'not_configured', resend: resendResult };
  }

  let transporter;
  try {
    transporter = await createVerifiedTransporter(USER, PASS);
  } catch (err) {
    console.error('[Email] Notification SMTP холболт/нэвтрэлт амжилтгүй:', {
      message: err.message,
      code: err.code,
      command: err.command,
      response: err.response,
      responseCode: err.responseCode,
    });
    return {
      success: false,
      reason: err.code === 'EAUTH' ? 'smtp_auth_failed' : 'smtp_connect_failed',
      error: err.message,
      code: err.code,
      command: err.command,
      response: err.response,
      responseCode: err.responseCode,
      resend: resendResult,
    };
  }

  try {
    const info = await transporter.sendMail({
      from: getEmailFrom(USER),
      to,
      subject,
      html,
      text,
    });
    console.log('[Email] Шинэ үзвэрийн мэдэгдэл:', info.messageId, '→', to);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[Email] Шинэ үзвэрийн мэдэгдэл алдаа:', err.message);
    console.error('[Email] Send failed detail:', {
      code: err.code,
      command: err.command,
      response: err.response,
      responseCode: err.responseCode,
      to,
    });
    return {
      success: false,
      error: err.message,
      code: err.code,
      command: err.command,
      response: err.response,
      responseCode: err.responseCode,
    };
  }
};
