import CleanupRequest from '../models/CleanupRequest.js';
import { executeCleanup, deleteOneBooking, autoCleanupExpiredTickets } from '../utils/cleanupService.js';

// GET /api/cleanup/pending
export const getPendingRequest = async (req, res) => {
  try {
    const request = await CleanupRequest.findOne({ status: 'pending' }).sort({ createdAt: -1 });
    res.json({ success: true, request });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/cleanup/:id/approve
export const approveCleanup = async (req, res) => {
  try {
    const { id } = req.params;
    const request = await CleanupRequest.findById(id);

    if (!request || request.status !== 'pending') {
      return res.status(404).json({ success: false, message: 'Хүсэлт олдсонгүй эсвэл хэдийн шийдвэрлэгдсэн' });
    }

    const result = await executeCleanup(id);
    res.json({ success: true, message: 'Өгөгдөл амжилттай устгагдлаа', ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
// POST /api/cleanup/mark-expired
export const markExpiredTickets = async (req, res) => {
  try {
    const result = await autoCleanupExpiredTickets();
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
// POST /api/cleanup/:id/reject
export const rejectCleanup = async (req, res) => {
  try {
    const { id } = req.params;

    const askAgainAfter = new Date();
    askAgainAfter.setDate(askAgainAfter.getDate() + 7);

    const request = await CleanupRequest.findByIdAndUpdate(
      id,
      { status: 'rejected', askAgainAfter, resolvedAt: new Date() },
      { new: true }
    );

    if (!request) {
      return res.status(404).json({ success: false, message: 'Хүсэлт олдсонгүй' });
    }

    res.json({
      success: true,
      message: `7 хоногийн дараа дахин мэдэгдэнэ (${askAgainAfter.toLocaleDateString('mn-MN')})`,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/cleanup/booking/:bookingId
export const deleteSingleBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    console.log('[Cleanup] Устгах тасалбар:', bookingId); // debug

    const result = await deleteOneBooking(bookingId);

    if (!result.success) {
      return res.status(500).json({ success: false, message: result.error });
    }

    return res.status(200).json({ success: true, message: 'Тасалбар устгагдлаа' });
  } catch (error) {
    console.error('[Cleanup] deleteSingleBooking алдаа:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};