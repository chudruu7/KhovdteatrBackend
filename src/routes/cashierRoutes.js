import express from 'express';
import {
  admitTicket,
  getCashierTicket,
  getLatestStationScan,
  scanTicketToStation,
} from '../controllers/cashierController.js';
import { authorize, protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Кассчин заавал системд нэвтэрсэн байх шаардлагатай
router.use(protect);
router.use(authorize('admin', 'cashier'));

// Кассчин гараар болон захиалгын ID-аар тасалбар шалгах маршрутууд
router.get('/tickets/:bookingId', getCashierTicket);
router.post('/tickets/:bookingId/admit', admitTicket);

// Компьютерийн дэлгэц (Station) сүүлийн скандагдсан өгөгдлийг татаж авах маршрут
router.get('/stations/:stationKey/latest', getLatestStationScan);


/**
 * 🛠️ ШИНЭЭР НЭМЭГДСЭН ГЕТ МАРШРУТ (Утасны хөтөчид зориулав)
 * Гар утасны камераар QR код уншуулахад шууд GET хүсэлт очдог тул 404 алдаанаас сэргийлнэ.
 * Хаяг: https://hovdteatr.com/api/cashier/stations/:stationKey/scans
 */
router.get('/stations/:stationKey/scans', (req, res) => {
  const { stationKey } = req.params;
  
  // ХЭРЭВ: Та утасны хөтөч дээр сканнердах тусгай Frontend (React) хуудас руу үсрэхийг хүсвэл:
  // (Доорх тайлбарыг арилгаад өөрийн frontend линкийг тавьж болно)
  // return res.redirect(`https://hovdteatr.com/cashier/scanner?station=${stationKey}`);
  
  // ОДООРХОЙ: Хөтөч дээр шууд холболт амжилттай болсныг харуулах гоёмсог HTML дэлгэц:
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Station Холболт</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-align: center; padding: 40px 20px; background: #0b0f19; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 80vh; margin: 0; }
          .card { background: #111827; border: 1px solid #1f2937; padding: 32px 24px; border-radius: 16px; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.5); max-width: 360px; width: 100%; }
          .icon-box { background: rgba(34, 197, 94, 0.1); width: 64px; height: 64px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px auto; color: #22c55e; font-size: 32px; font-weight: bold; }
          h2 { margin: 0 0 10px 0; color: #ffffff; font-size: 22px; font-weight: 600; }
          p { color: #9ca3af; font-size: 14px; line-height: 1.6; margin: 0 0 20px 0; }
          .badge { background: #1f2937; color: #38bdf8; padding: 6px 12px; border-radius: 20px; font-family: monospace; font-size: 14px; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="icon-box">✓</div>
          <h2>Холболт амжилттай</h2>
          <p>Кассчны утас компьютертэй амжилттай холбогдлоо. Одоо хэрэглэгчийн тасалбарыг шалгаж болно.</p>
          <span class="badge">Station: ${stationKey}</span>
        </div>
      </body>
    </html>
  `);
});


// Компьютер болон утасны апп-аас өгөгдөл илгээх үндсэн POST маршрут (Хэвээр үлдсэн)
router.post('/stations/:stationKey/scans', scanTicketToStation);

export default router;