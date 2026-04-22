import express from 'express';
import { protect, admin } from '../middleware/authMiddleware.js';
import { getPendingRequest, approveCleanup, rejectCleanup, deleteSingleBooking, markExpiredTickets } from '../controllers/cleanupController.js';

const router = express.Router();

router.get('/pending', protect, admin, getPendingRequest);
router.post('/:id/approve', protect, admin, approveCleanup);
router.post('/:id/reject', protect, admin, rejectCleanup);
router.delete('/booking/:bookingId', protect, admin, deleteSingleBooking);

router.post('/mark-expired', protect, admin, markExpiredTickets);
export default router;