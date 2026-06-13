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

  const seatList = Array.isArray(seats) ? seats.join(', ') : seats;
  const ticketItems = (tickets?.length ? tickets : (seats || []).map((seatId) => ({ seatId, type: 'adult' })));

  // 🔮 Glassmorphism стилийн туслах функц
  const glassStyle = (opacity = 0.15, blur = '12px') => 
    `background: rgba(255, 255, 255, ${opacity}); backdrop-filter: blur(${blur}); -webkit-backdrop-filter: blur(${blur}); border: 1px solid rgba(255, 255, 255, 0.18); box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.08);`;

  const ticketRows = ticketItems.map((ticket) => `
    <tr>
      <td style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.1);color:#1e293b;font-weight:700;font-size:15px;">
        <span style="display:inline-block;margin-right:8px;">🎟️</span>${escapeHtml(ticket.seatId)}
      </td>
      <td style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.1);color:#64748b;text-align:right;font-size:14px;">
        ${formatTicketType(ticket.type)}
      </td>
    </tr>
  `).join('');

  const simpleSeatBadges = ticketItems.map((ticket) => (
    `<span style="display:inline-block;margin:0 8px 10px 0;padding:10px 16px;border-radius:14px;${glassStyle(0.2, '10px')};color:#1e293b;font-size:14px;font-weight:600;">
      <span style="margin-right:6px;">💺</span>${escapeHtml(ticket.seatId)} <span style="color:#64748b;font-weight:500;">· ${formatTicketType(ticket.type)}</span>
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
  <title>Тасалбар</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1e293b;background:linear-gradient(135deg,#f0f4ff 0%,#e8f0fe 25%,#fce7f3 50%,#f0f9ff 75%,#f3e8ff 100%);background-attachment:fixed;">
  <div style="display:none;max-height:0;overflow:hidden;">🎬 Таны тасалбар баталгаажлаа. Үүдэнд QR кодоо уншуулна уу.</div>
  
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:580px;border-collapse:separate;border-spacing:0;">
          
          <!-- 🌟 Header -->
          <tr>
            <td style="padding:0 0 20px;text-align:center;">
              <div style="display:inline-block;padding:10px 20px;border-radius:50px;${glassStyle(0.2, '14px')};">
                <span style="font-size:28px;vertical-align:middle;margin-right:8px;">✨</span>
                <span style="font-size:13px;font-weight:700;color:#7c3aed;letter-spacing:.1em;vertical-align:middle;">ТӨЛБӨР БАТАЛГААЖЛАА</span>
                <span style="font-size:28px;vertical-align:middle;margin-left:8px;">✨</span>
              </div>
            </td>
          </tr>
          
          <!-- 🎞️ Movie Title Card -->
          <tr>
            <td style="padding:0 0 24px;text-align:center;">
              <div style="display:inline-block;padding:28px 24px;border-radius:28px;${glassStyle(0.15, '16px')};text-align:center;">
                <div style="font-size:48px;margin-bottom:8px;">🎬</div>
                <h1 style="margin:0 0 8px;font-size:28px;font-weight:900;color:#1e293b;line-height:1.2;">${escapeHtml(movieTitle)}</h1>
                <p style="margin:0;font-size:15px;color:#64748b;line-height:1.5;">Сайн байна уу, <strong style="color:#7c3aed;">${escapeHtml(customer?.name || 'үзэгч')}</strong>!<br/>Доорх QR кодыг үүдэнд уншуулна уу 🎟️</p>
              </div>
            </td>
          </tr>

          <!-- 🎫 Main Ticket Card -->
          <tr>
            <td style="border-radius:30px;overflow:hidden;${glassStyle(0.12, '16px')};">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                
                <!-- Colorful Top Bar -->
                <tr>
                  <td style="height:6px;background:linear-gradient(90deg,#7c3aed,#a855f7,#ec4899,#f43f5e,#f59e0b,#3b82f6);font-size:0;line-height:0;">&nbsp;</td>
                </tr>
                
                <!-- Main Content -->
                <tr>
                  <td style="padding:28px 28px 22px;">
                    
                    <!-- Badge -->
                    <div style="margin-bottom:14px;">
                      <span style="display:inline-block;padding:6px 14px;border-radius:20px;${glassStyle(0.25, '8px')};font-size:11px;font-weight:800;letter-spacing:.16em;color:#7c3aed;">
                        🎟️ E-TICKET
                      </span>
                    </div>
                    
                    <div style="font-size:13px;color:#64748b;font-weight:500;margin-bottom:20px;">
                      📍 Ховд аймаг Хөгжимт Драмын Театр
                    </div>

                    <!-- Date & Time Row -->
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:16px;">
                      <tr>
                        <td style="width:50%;padding:16px;border-radius:18px 0 0 18px;${glassStyle(0.18, '10px')};border-right:0;">
                          <div style="font-size:11px;color:#64748b;font-weight:700;letter-spacing:.1em;margin-bottom:6px;">📅 ОГНОО</div>
                          <div style="font-size:18px;color:#1e293b;font-weight:800;">${escapeHtml(date)}</div>
                        </td>
                        <td style="width:50%;padding:16px;border-radius:0 18px 18px 0;${glassStyle(0.18, '10px')};">
                          <div style="font-size:11px;color:#64748b;font-weight:700;letter-spacing:.1em;margin-bottom:6px;">⏰ ЦАГ</div>
                          <div style="font-size:18px;color:#1e293b;font-weight:800;">${escapeHtml(time)}</div>
                        </td>
                      </tr>
                    </table>

                    <!-- Hall & Order Row -->
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:20px;">
                      <tr>
                        <td style="width:50%;padding:16px;border-radius:18px 0 0 18px;${glassStyle(0.22, '10px')};background:linear-gradient(135deg,rgba(124,58,237,0.08),rgba(236,72,153,0.06));border-right:0;">
                          <div style="font-size:11px;color:#64748b;font-weight:700;letter-spacing:.1em;margin-bottom:6px;">🏛️ ТАНХИМ</div>
                          <div style="font-size:16px;color:#1e293b;font-weight:700;">${escapeHtml(hall || 'Танхим')}</div>
                        </td>
                        <td style="width:50%;padding:16px;border-radius:0 18px 18px 0;${glassStyle(0.15, '10px')};background:linear-gradient(135deg,rgba(59,130,246,0.06),rgba(168,85,247,0.04));">
                          <div style="font-size:11px;color:#64748b;font-weight:700;letter-spacing:.1em;margin-bottom:6px;">🔢 ЗАХИАЛГА</div>
                          <div style="font-size:14px;color:#1e293b;font-weight:700;word-break:break-all;">${escapeHtml(orderId)}</div>
                        </td>
                      </tr>
                    </table>

                    <!-- Seats Section -->
                    <div style="font-size:12px;color:#64748b;font-weight:800;letter-spacing:.12em;margin-bottom:12px;text-transform:uppercase;">💺 Суудал</div>
                    <div style="margin-bottom:22px;line-height:1.4;">
                      ${simpleSeatBadges || `<span style="color:#64748b;font-size:14px;">${escapeHtml(seatList || '')}</span>`}
                    </div>

                    <!-- Total Price -->
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                      <tr>
                        <td style="padding:20px 22px;border-radius:22px;${glassStyle(0.2, '14px')};background:linear-gradient(135deg,rgba(124,58,237,0.1),rgba(236,72,153,0.08));">
                          <div style="font-size:12px;color:#7c3aed;font-weight:800;letter-spacing:.1em;margin-bottom:6px;">💰 НИЙТ ТӨЛБӨР</div>
                          <div style="font-size:32px;font-weight:900;color:#1e293b;">${formatMoney(totalPrice)}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                
                <!-- Dashed Divider -->
                <tr>
                  <td style="border-top:2px dashed rgba(124,58,237,0.2);padding:0 28px;">&nbsp;</td>
                </tr>
                
                <!-- QR Code Section -->
                <tr>
                  <td style="padding:26px 28px 30px;text-align:center;">
                    <div style="font-size:13px;color:#64748b;font-weight:800;letter-spacing:.1em;margin-bottom:16px;">
                      📱 QR КОДЫГ ХАДГАЛНА УУ.
                    </div>
                    
                    <!-- QR Code Container -->
                    <div style="display:inline-block;padding:18px;border-radius:26px;${glassStyle(0.25, '16px')};">
                      <img src="${qrImageUrl}" width="200" height="200" alt="Ticket QR" style="display:block;width:200px;height:200px;border:0;border-radius:16px;"/>
                    </div>
                    
                    <p style="margin:16px auto 0;max-width:380px;color:#64748b;font-size:13px;line-height:1.55;">
                      QR уншихгүй бол захиалгын дугаараа хэлнэ үү:<br/>
                      <strong style="color:#7c3aed;font-size:14px;">${escapeHtml(orderId)}</strong>
                    </p>
                    
                    <!-- Action Buttons -->
                    <div style="margin-top:24px;">
                      <a href="${verifyUrl}" style="display:inline-block;text-decoration:none;padding:14px 24px;border-radius:16px;${glassStyle(0.3, '10px')};background:linear-gradient(135deg,#7c3aed,#a855f7);color:#ffffff;font-weight:800;font-size:14px;border:none;box-shadow:0 8px 24px rgba(124,58,237,0.25);">
                        <span style="vertical-align:middle;">🎟️</span> <span style="vertical-align:middle;">Тасалбар нээх</span>
                      </a>
                      <br style="display:none;"/>
                      <a href="${calendarUrl}" style="display:inline-block;text-decoration:none;padding:14px 24px;border-radius:16px;${glassStyle(0.2, '8px')};background:#ffffff;color:#7c3aed;font-weight:800;font-size:14px;border:1px solid rgba(124,58,237,0.2);margin-top:10px;">
                        <span style="vertical-align:middle;">📅</span> <span style="vertical-align:middle;">Календарьт нэмэх</span>
                      </a>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer Note -->
          <tr>
            <td style="padding:20px 8px 0;text-align:center;">
              <div style="display:inline-block;padding:14px 22px;border-radius:18px;${glassStyle(0.1, '10px')};color:#64748b;font-size:13px;line-height:1.6;">
                <span style="font-size:16px;margin-right:4px;">⏰</span> Үзвэр эхлэхээс 10-15 минутын өмнө ирнэ үү.<br/>
                <span style="font-size:16px;margin-right:4px;">ℹ️</span> Тасалбар буцаах боломжгүй.
              </div>
            </td>
          </tr>
          
          <!-- Brand Footer -->
          <tr>
            <td style="padding:28px 0 12px;text-align:center;">
              <div style="${glassStyle(0.12, '10px')};display:inline-block;padding:14px 24px;border-radius:16px;">
                <span style="font-size:18px;vertical-align:middle;margin-right:6px;">🎭</span>
                <span style="font-size:14px;font-weight:700;color:#7c3aed;vertical-align:middle;">ХОВД АЙМАГ ХӨГЖИМТ ДРАМЫН ТЕАТР</span>
                <span style="font-size:18px;vertical-align:middle;margin-left:6px;">🎭</span>
              </div>
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
  
  const glassStyle = (opacity = 0.15, blur = '12px') => 
    `background: rgba(255, 255, 255, ${opacity}); backdrop-filter: blur(${blur}); -webkit-backdrop-filter: blur(${blur}); border: 1px solid rgba(255, 255, 255, 0.18); box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.08);`;
  
  const subject = `🎬 Шинэ үзвэр нэмэгдлээ: ${title}`;
  
  const html = `<!DOCTYPE html>
<html lang="mn">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Шинэ үзвэр</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#1e293b;background:linear-gradient(135deg,#f0f4ff 0%,#fce7f3 35%,#f0f9ff 65%,#f3e8ff 100%);background-attachment:fixed;">
  
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
                    <h1 style="margin:0 0 16px;font-size:28px;font-weight:900;color:#1e293b;text-align:center;line-height:1.3;">
                      🎞️ ${escapeHtml(title)}
                    </h1>
                    
                    <!-- Greeting -->
                    <p style="margin:0 0 16px;font-size:15px;color:#475569;text-align:center;line-height:1.6;">
                      Сайн байна уу, <strong style="color:#7c3aed;">${escapeHtml(userName || 'үзэгч')}</strong>! 🎉<br/>
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