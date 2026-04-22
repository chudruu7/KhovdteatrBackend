import Booking from '../models/Booking.js';
import Schedule from '../models/Schedule.js';
import CleanupRequest from '../models/CleanupRequest.js';

const DAYS_THRESHOLD = 14;

/* ─── Автомат: Expired тасалбар 1 хоногийн дараа устгана ─────────────── */
export const autoCleanupExpiredTickets = async () => {
  try {
    const now = new Date();

    // Schedule populate хийж showTime-аар шалгана
    const activeBookings = await Booking.find({ status: 'active' })
      .populate('schedule', 'showTime');

    const expiredIds = activeBookings
      .filter(b => b.schedule?.showTime && new Date(b.schedule.showTime) < now)
      .map(b => b._id);

    let updatedCount = 0;
    if (expiredIds.length > 0) {
      const updated = await Booking.updateMany(
        { _id: { $in: expiredIds } },
        { $set: { status: 'used', expiredAt: now } }
      );
      updatedCount = updated.modifiedCount;
      console.log(`[Cleanup] ${updatedCount} тасалбар used болгогдлоо`);
    }

    // 1 хоногоос өмнө used болсон тасалбаруудыг устгана
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const deleted = await Booking.deleteMany({
      status: 'used',
      expiredAt: { $lt: oneDayAgo }
    });
    if (deleted.deletedCount > 0)
      console.log(`[Cleanup] ${deleted.deletedCount} тасалбар устгагдлаа`);

    return { updated: updatedCount, deleted: deleted.deletedCount };
  } catch (error) {
    console.error('[Cleanup] autoCleanupExpiredTickets алдаа:', error.message);
    return { updated: 0, deleted: 0 };
  }
};

/* ─── Гар аргаар: Нэг тасалбар устгах ───────────────────────────────── */
export const deleteOneBooking = async (bookingId) => {
  try {
    const deleted = await Booking.findByIdAndDelete(bookingId);
    if (!deleted) {
      return { success: false, error: 'Тасалбар олдсонгүй' };
    }
    console.log(`[Cleanup] Тасалбар устгагдлаа: ${bookingId}`);
    return { success: true };
  } catch (error) {
    console.error('[Cleanup] deleteOneBooking алдаа:', error.message);
    return { success: false, error: error.message };
  }
};

/* ─── Хуучин өгөгдлийн cleanup хүсэлт ───────────────────────────────── */
export const requestCleanupApproval = async () => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - DAYS_THRESHOLD);
    const now = new Date();

    const existingPending = await CleanupRequest.findOne({ status: 'pending' });
    if (existingPending) return;

    const rejectedRequest = await CleanupRequest.findOne({
      status: 'rejected',
      askAgainAfter: { $gt: now },
    }).sort({ createdAt: -1 });
    if (rejectedRequest) return;

    const bookingCount  = await Booking.countDocuments({ createdAt: { $lt: cutoffDate } });
    const scheduleCount = await Schedule.countDocuments({ showDate: { $lt: cutoffDate } });

    if (bookingCount === 0 && scheduleCount === 0) return;

    const oldestBooking = await Booking.findOne({ createdAt: { $lt: cutoffDate } }).sort({ createdAt: 1 });

    await CleanupRequest.create({
      status: 'pending',
      stats: {
        bookingCount,
        scheduleCount,
        oldestDate: oldestBooking?.createdAt || cutoffDate,
      },
    });

    console.log(`[Cleanup] Хүсэлт үүслээ: Booking ${bookingCount}, Schedule ${scheduleCount}`);
  } catch (error) {
    console.error('[Cleanup] requestCleanupApproval алдаа:', error.message);
  }
};

/* ─── Хуучин өгөгдлийн cleanup гүйцэтгэх ────────────────────────────── */
export const executeCleanup = async (requestId) => {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - DAYS_THRESHOLD);

    const deletedBookings  = await Booking.deleteMany({ createdAt: { $lt: cutoffDate } });
    const deletedSchedules = await Schedule.deleteMany({ showDate: { $lt: cutoffDate } });

    await CleanupRequest.findByIdAndUpdate(requestId, {
      status: 'approved',
      resolvedAt: new Date(),
    });

    console.log(`[Cleanup] Устгалт дууслаа: Booking ${deletedBookings.deletedCount}, Schedule ${deletedSchedules.deletedCount}`);

    return {
      success: true,
      deletedBookings:  deletedBookings.deletedCount,
      deletedSchedules: deletedSchedules.deletedCount,
    };
  } catch (error) {
    console.error('[Cleanup] executeCleanup алдаа:', error.message);
    return { success: false, error: error.message };
  }
};