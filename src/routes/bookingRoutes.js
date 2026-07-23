// cinema-back/src/routes/bookingRoutes.js
import express from 'express';
import {
  createBooking,
  getBookingDetails,
  getAllBookings,
  getBookingStats,
  getMyHistory, 
  verifyBookingStatus,
  cancelBooking,
  hideBookingForMe,
  resendBookingConfirmation
} from '../controllers/bookingController.js';
import { protect, admin } from '../middleware/authMiddleware.js';

const router = express.Router();

// ✅ Тогтмол route-ууд ЭХЭЛЖ — /:id-аас өмнө заавал байх ёстой
router.get('/verify/:bookingId', verifyBookingStatus);
router.get('/my-history', protect, getMyHistory); 
router.get   ('/stats',          protect, admin, getBookingStats);
router.get   ('/',               protect, admin, getAllBookings);
router.post  ('/',               protect, createBooking);
router.post  ('/:id/resend-confirmation', protect, resendBookingConfirmation);
router.post  ('/:id/cancel',     protect, cancelBooking);
router.delete('/:id/my-history',  protect, hideBookingForMe);
// ✅ Dynamic route-ууд ХАМГИЙН СҮҮЛД
router.get   ('/:bookingId',     protect, getBookingDetails);

export default router;
