// cinema-back/src/routes/bookingRoutes.js
import express from 'express';
import {
  createBooking,
  getBookingDetails,
  getAllBookings,
  getBookingStats,
  getMyHistory, 
  cancelBooking,
  confirmBooking
} from '../controllers/bookingController.js';
import { sendBookingConfirmation } from '../services/Emailservice.js';
import { protect, admin } from '../middleware/authMiddleware.js';

const router = express.Router();

// ✅ Тогтмол route-ууд ЭХЭЛЖ — /:id-аас өмнө заавал байх ёстой
router.get('/my-history', protect, getMyHistory); 
router.get   ('/stats',          protect, getBookingStats);
router.get   ('/',               protect, getAllBookings);
router.post  ('/',               protect, createBooking);
router.post  ('/:id/confirm',    protect, confirmBooking);   // ← QPay callback дараа дуудна
router.post  ('/:id/cancel',     protect, cancelBooking);
// ✅ Dynamic route-ууд ХАМГИЙН СҮҮЛД
router.get   ('/:bookingId',     protect, getBookingDetails);

// Email дахин илгээх
router.post('/send-confirmation', async (req, res) => {
  try {
    const { to, orderId, movieTitle, moviePoster, date, time, hall, seats, tickets, totalPrice, customer } = req.body;
    if (!to || !orderId || !movieTitle)
      return res.status(400).json({ success: false, message: 'to, orderId, movieTitle заавал шаардлагатай' });

    const result = await sendBookingConfirmation({ to, orderId, movieTitle, moviePoster, date, time, hall, seats, tickets, totalPrice, customer });

    if (result.success)               return res.json({ success: true, messageId: result.messageId });
    if (result.reason === 'not_configured') return res.json({ success: false, message: '.env тохируулаагүй' });
    return res.status(500).json({ success: false, message: result.error });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

export default router;