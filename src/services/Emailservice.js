// cinema-back/src/services/Emailservice.js
import nodemailer from 'nodemailer';

export const sendBookingConfirmation = async ({
  to, orderId, movieTitle, date, time, hall,
  seats, tickets, totalPrice, customer,
}) => {
  const USER = process.env.GMAIL_USER;
  const PASS = process.env.GMAIL_APP_PASS;

  console.log('[Email] USER:', USER, '| PASS length:', PASS?.length ?? 'UNDEFINED');

  if (!USER || !PASS) {
    console.warn('[Email] Credentials тохируулаагүй.');
    return { success: false, reason: 'not_configured' };
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: USER, pass: PASS },
  });

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
    <div class="sub">● ХОВД АЙМАГ ХӨГЖИМТ КИНО ТЕАТР</div>
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
    <div class="note">⏰ Кино эхлэхээс 15 минутын өмнө ирнэ үү.<br/>ℹ️ Тасалбар буцаах боломжгүй.<br/>📞 Лавлах: +976 7038-0000</div>
  </div>
</div>
<div class="footer">ХОВД АЙМАГ ХӨГЖИМТ КИНО ТЕАТР<br/>Энэхүү и-мэйлийг автоматаар илгээсэн болно.</div>
</div></body></html>`;

  try {
    const info = await transporter.sendMail({
      from:    `"Кино Театр" <${USER}>`,
      to,
      subject: `🎫 Тасалбар: ${movieTitle} — ${orderId}`,
      html,
      text: `Захиалга амжилттай!\nДугаар: ${orderId}\nКино: ${movieTitle}\nОгноо: ${date} ${time}\nСуудал: ${seatList}\nНийт: ${money(totalPrice)}`,
    });
    console.log('[Email] ✅ Амжилттай:', info.messageId, '→', to);
    return { success: true, messageId: info.messageId };
  } catch (err) {
    console.error('[Email] Алдаа:', err.message);
    return { success: false, error: err.message };
  }
};