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

const THEATER_UTC_OFFSET = '+07:00';

const buildGoogleCalendarUrl = ({ movieTitle, date, time, hall, orderId }) => {
  const start = new Date(`${date}T${time || '00:00'}:00${THEATER_UTC_OFFSET}`);
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
  if (process.env.NODE_ENV === 'test') {
    return { success: true, test: true, messageId: `test-${orderId}` };
  }

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

  const seatList = Array.isArray(seats) ? seats.join(', ') : seats;
  const ticketItems = (tickets?.length ? tickets : (seats || []).map((seatId) => ({ seatId, type: 'adult' })));

  const panelStyle = 'background:#ffffff;border:1px solid #e5e7eb;border-radius:20px;box-shadow:0 14px 38px rgba(15,23,42,0.08);';
  const softPanelStyle = 'background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;';
  const labelStyle = 'font-size:11px;line-height:15px;color:#64748b;font-weight:800;letter-spacing:.08em;text-transform:uppercase;';
  const valueStyle = 'font-size:18px;line-height:24px;color:#0f172a;font-weight:900;';

  const ticketRows = ticketItems.map((ticket) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;color:#0f172a;font-weight:800;font-size:15px;line-height:21px;">
        ${escapeHtml(ticket.seatId)}
      </td>
      <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;color:#475569;text-align:right;font-size:14px;line-height:20px;">
        ${formatTicketType(ticket.type)}
      </td>
    </tr>
  `).join('');

  const simpleSeatBadges = ticketItems.map((ticket) => (
    `<span style="display:inline-block;margin:0 8px 10px 0;padding:9px 13px;border-radius:999px;background:#eef2ff;border:1px solid #c7d2fe;color:#312e81;font-size:14px;line-height:18px;font-weight:800;">
      ${escapeHtml(ticket.seatId)} <span style="color:#64748b;font-weight:700;">· ${formatTicketType(ticket.type)}</span>
    </span>`
  )).join('');

  const verifyUrl = buildTicketVerifyUrl(orderId);
  const qrImageUrl = buildQrImageUrl(verifyUrl);
  const calendarUrl = buildGoogleCalendarUrl({ movieTitle, date, time, hall, orderId });

  const finalSubject = `✨ Таны тасалбар бэлэн: ${movieTitle} — ${orderId}`;
  const finalText = `Захиалга амжилттай!\nДугаар: ${orderId}\nҮзвэр: ${movieTitle}\nОгноо: ${date} ${time}\nТанхим: ${hall || ''}\nСуудал: ${seatList}\nНийт: ${formatMoney(totalPrice)}\nQR/тасалбар: ${verifyUrl}`;

  const finalHtml = `<!DOCTYPE html>
<html lang="mn">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>Тасалбар</title>
  <style>
    @media screen and (max-width:560px) {
      .container { width:100% !important; }
      .mobile-pad { padding-left:18px !important; padding-right:18px !important; }
      .stack { display:block !important; width:100% !important; box-sizing:border-box !important; }
      .stack-gap { padding-top:12px !important; }
      .button { display:block !important; width:100% !important; box-sizing:border-box !important; text-align:center !important; }
      .qr-img { width:220px !important; height:220px !important; }
    }
  </style>
</head>
<body bgcolor="#f1f5f9" style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#0f172a;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Таны төлбөр баталгаажлаа. Үүдэнд QR кодоо уншуулна уу.</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f1f5f9" style="border-collapse:collapse;background:#f1f5f9;">
    <tr>
      <td align="center" class="mobile-pad" style="padding:28px 14px;">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" class="container" style="width:600px;max-width:600px;border-collapse:separate;border-spacing:0;">
          <tr>
            <td style="padding:0 0 12px;text-align:left;">
              <span style="display:inline-block;padding:8px 12px;border-radius:999px;background:#dcfce7;color:#166534;font-size:12px;line-height:16px;font-weight:900;letter-spacing:.04em;">ТӨЛБӨР БАТАЛГААЖЛАА</span>
            </td>
          </tr>
          <tr>
            <td style="${panelStyle}overflow:hidden;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                <tr>
                  <td style="background:#111827;padding:26px 28px 24px;">
                    <div style="font-size:13px;line-height:18px;color:#c4b5fd;font-weight:900;letter-spacing:.12em;text-transform:uppercase;margin-bottom:10px;">E-TICKET</div>
                    <h1 style="margin:0 0 10px;font-size:28px;line-height:34px;color:#ffffff;font-weight:900;">${escapeHtml(movieTitle)}</h1>
                    <p style="margin:0;font-size:15px;line-height:23px;color:#cbd5e1;">Сайн байна уу, <strong style="color:#ffffff;">${escapeHtml(customer?.name || 'Үзэгч')}</strong>. Доорх QR кодыг театрын үүдэнд уншуулна уу.</p>
                  </td>
                </tr>
                <tr>
                  <td class="mobile-pad" style="padding:24px 28px 8px;background:#ffffff;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                      <tr>
                        <td class="stack" width="50%" style="width:50%;padding:0 6px 12px 0;">
                          <div style="${softPanelStyle}padding:16px;">
                            <div style="${labelStyle};margin-bottom:6px;">Огноо</div>
                            <div style="${valueStyle}">${escapeHtml(date)}</div>
                          </div>
                        </td>
                        <td class="stack stack-gap" width="50%" style="width:50%;padding:0 0 12px 6px;">
                          <div style="${softPanelStyle}padding:16px;">
                            <div style="${labelStyle};margin-bottom:6px;">Цаг</div>
                            <div style="${valueStyle}">${escapeHtml(time)}</div>
                          </div>
                        </td>
                      </tr>
                      <tr>
                        <td class="stack" width="50%" style="width:50%;padding:0 6px 12px 0;">
                          <div style="${softPanelStyle}padding:16px;">
                            <div style="${labelStyle};margin-bottom:6px;">Танхим</div>
                            <div style="font-size:16px;line-height:23px;color:#0f172a;font-weight:800;">${escapeHtml(hall || 'Танхим')}</div>
                          </div>
                        </td>
                        <td class="stack stack-gap" width="50%" style="width:50%;padding:0 0 12px 6px;">
                          <div style="${softPanelStyle}padding:16px;">
                            <div style="${labelStyle};margin-bottom:6px;">Захиалгын дугаар</div>
                            <div style="font-size:14px;line-height:20px;color:#0f172a;font-weight:800;word-break:break-all;">${escapeHtml(orderId)}</div>
                          </div>
                        </td>
                      </tr>
                    </table>
                    <div style="margin:6px 0 14px;">
                      <div style="${labelStyle};margin-bottom:10px;">Суудал</div>
                      ${simpleSeatBadges || `<span style="color:#475569;font-size:14px;line-height:20px;">${escapeHtml(seatList || '')}</span>`}
                    </div>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin:4px 0 18px;">
                      <tr>
                        <td style="background:#4f46e5;border-radius:18px;padding:18px 20px;">
                          <div style="font-size:12px;line-height:16px;color:#c7d2fe;font-weight:900;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;">Нийт төлбөр</div>
                          <div style="font-size:30px;line-height:36px;color:#ffffff;font-weight:900;">${formatMoney(totalPrice)}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td class="mobile-pad" style="padding:22px 28px 26px;background:#f8fafc;border-top:1px dashed #cbd5e1;text-align:center;">
                    <div style="font-size:13px;line-height:18px;color:#334155;font-weight:900;letter-spacing:.08em;text-transform:uppercase;margin-bottom:14px;">QR код</div>
                    <a href="${qrImageUrl}" title="QR татах" style="display:inline-block;text-decoration:none;">
                      <span style="display:inline-block;background:#ffffff;border:1px solid #cbd5e1;border-radius:22px;padding:14px;box-shadow:0 10px 26px rgba(15,23,42,0.12);">
                        <img class="qr-img" src="${qrImageUrl}" width="230" height="230" alt="Ticket QR" style="display:block;width:230px;height:230px;border:0;border-radius:12px;"/>
                      </span>
                    </a>
                    <p style="margin:16px auto 0;max-width:420px;color:#475569;font-size:14px;line-height:22px;">QR кодоо хадгалж эсвэл энэ мэйлийг нээгээд үүдэнд уншуулна уу. Мөн профайл хэсгийн <strong style="color:#312e81;">Миний тасалбарууд</strong> цэсээс харах боломжтой.</p>
                  </td>
                </tr>
                <tr>
                  <td class="mobile-pad" style="padding:22px 28px 28px;background:#ffffff;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                      <tr>
                        <td class="stack" width="50%" style="width:50%;padding:0 6px 10px 0;">
                          <a class="button" href="${verifyUrl}" style="display:block;text-decoration:none;background:#4f46e5;color:#ffffff;border-radius:14px;padding:14px 16px;font-size:15px;line-height:20px;font-weight:900;text-align:center;">Тасалбар нээх</a>
                        </td>
                        <td class="stack stack-gap" width="50%" style="width:50%;padding:0 0 10px 6px;">
                          <a class="button" href="${calendarUrl}" style="display:block;text-decoration:none;background:#ffffff;color:#312e81;border:1px solid #c7d2fe;border-radius:14px;padding:13px 16px;font-size:15px;line-height:20px;font-weight:900;text-align:center;">Календарт нэмэх</a>
                        </td>
                      </tr>
                    </table>
                    <div style="margin-top:8px;background:#fffbeb;border:1px solid #fde68a;border-radius:16px;padding:14px 16px;color:#92400e;font-size:13px;line-height:20px;">Үзвэр эхлэхээс 10-15 минутын өмнө ирнэ үү. Тасалбар буцаах боломжгүй.</div>
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:18px;">
                      <tr>
                        <td style="padding:0;">
                          <div style="${labelStyle};margin-bottom:2px;">Тасалбарын дэлгэрэнгүй</div>
                          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                            ${ticketRows}
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 8px 0;text-align:center;color:#64748b;font-size:12px;line-height:18px;">Ховд аймаг Хөгжимт Драмын Театр</td>
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
  
  const glassStyle = (opacity = 0.15, blur = '12px') => 
    `background: rgba(255, 255, 255, ${opacity}); backdrop-filter: blur(${blur}); -webkit-backdrop-filter: blur(${blur}); border: 1px solid rgba(255, 255, 255, 0.18); box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.08);`;
  
  const subject = `🎬 Шинэ үзвэр нэмэгдлээ: ${title}`;
  
  const html = `<!DOCTYPE html>
<html lang="mn">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>Шинэ үзвэр</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1e293b !important;background:linear-gradient(135deg,#f0f4ff 0%,#fce7f3 35%,#f0f9ff 65%,#f3e8ff 100%);background-attachment:fixed;">
  
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;border-collapse:separate;border-spacing:0;">
          
          <!-- 🎬 Icon Header -->
          <tr>
            <td style="text-align:center;padding:0 0 20px;">
              <div style="font-size:64px;line-height:1;">🎬</div>
            </td>
          </tr>
          
          <!-- ✨ Main Card -->
          <tr>
            <td style="border-radius:32px;overflow:hidden;${glassStyle(0.12, '18px')};">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                
                <!-- Gradient Bar -->
                <tr>
                  <td style="height:6px;background:linear-gradient(90deg,#7c3aed,#a855f7,#ec4899,#f43f5e,#f59e0b);font-size:0;line-height:0;">&nbsp;</td>
                </tr>
                
                <tr>
                  <td style="padding:32px 28px;">
                    
                    <!-- Badge -->
                    <div style="text-align:center;margin-bottom:20px;">
                      <span style="display:inline-block;padding:8px 18px;border-radius:50px;${glassStyle(0.25, '10px')};">
                        <span style="font-size:16px;vertical-align:middle;margin-right:6px;">🌟</span>
                        <span style="font-size:12px;font-weight:800;letter-spacing:.14em;color:#7c3aed;vertical-align:middle;">ШИНЭ ҮЗВЭР НЭМЭГДЛЭЭ</span>
                        <span style="font-size:16px;vertical-align:middle;margin-left:6px;">🌟</span>
                      </span>
                    </div>
                    
                    <!-- Title -->
                    <h1 style="margin:0 0 16px;font-size:28px;font-weight:900;color:#1e293b !important;text-align:center;line-height:1.3;">
                      🎞️ ${escapeHtml(title)}
                    </h1>
                    
                    <!-- Greeting -->
                    <p style="margin:0 0 16px;font-size:15px;color:#475569 !important;text-align:center;line-height:1.6;">
                      Сайн байна уу, <strong style="color:#7c3aed !important;">${escapeHtml(userName || 'үзэгч')}</strong>! 🎉<br/>
                      Манай театрын системд шинэ үзвэр нэмэгдлээ.
                    </p>
                    
                    <!-- Genre Tag -->
                    <div style="text-align:center;margin-bottom:24px;">
                      <span style="display:inline-block;padding:10px 20px;border-radius:16px;${glassStyle(0.2, '8px')};">
                        <span style="font-size:14px;margin-right:6px;">🎭</span>
                        <span style="font-size:14px;color:#64748b;font-weight:600;">${escapeHtml(genre)}</span>
                      </span>
                    </div>
                    
                    <!-- CTA Button -->
                    <div style="text-align:center;">
                      <a href="${url}" style="display:inline-block;text-decoration:none;padding:16px 32px;border-radius:18px;background:linear-gradient(135deg,#7c3aed,#a855f7);color:#ffffff;font-weight:800;font-size:15px;box-shadow:0 12px 32px rgba(124,58,237,0.3);border:none;">
                        <span style="vertical-align:middle;">🎬</span> <span style="vertical-align:middle;">Үзвэр үзэх</span>
                      </a>
                    </div>
                    
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding:24px 8px 12px;text-align:center;">
              <div style="display:inline-block;padding:12px 22px;border-radius:16px;${glassStyle(0.1, '8px')};">
                <span style="font-size:16px;vertical-align:middle;margin-right:4px;">🎭</span>
                <span style="font-size:13px;font-weight:700;color:#7c3aed;vertical-align:middle;">ХОВД АЙМАГ ХӨГЖИМТ ДРАМЫН ТЕАТР</span>
                <span style="font-size:16px;vertical-align:middle;margin-left:4px;">🎭</span>
              </div>
            </td>
          </tr>
          
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `🌟 Шинэ үзвэр нэмэгдлээ!\n\nСайн байна уу, ${userName || 'үзэгч'}!\n🎬 ${title}\n🎭 Төрөл: ${genre}\n\n👉 Үзвэр үзэх: ${url}\n\nХОВД АЙМАГ ХӨГЖИМТ ДРАМЫН ТЕАТР`;

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
