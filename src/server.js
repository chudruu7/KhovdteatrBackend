import 'dotenv/config';
import cron from 'node-cron';

import app from './app.js';
import connectDB from './config/db.js';
import { getJwtSecret } from './utils/jwtSecret.js';
import { cancelExpiredBookings } from './controllers/bookingController.js';
import { processUnsentPaidBookingEmails } from './services/bookingFulfillmentService.js';
import { autoCleanupExpiredTickets, requestCleanupApproval } from './utils/cleanupService.js';

getJwtSecret();
connectDB();

cron.schedule('5 0 * * *', async () => {
  await autoCleanupExpiredTickets();
  await requestCleanupApproval();
});

cancelExpiredBookings();
setInterval(cancelExpiredBookings, 5 * 60 * 1000);

processUnsentPaidBookingEmails().catch((err) => {
  console.error('[Booking/Fulfillment] Initial unsent paid email scan failed:', err.message);
});
setInterval(() => {
  processUnsentPaidBookingEmails().catch((err) => {
    console.error('[Booking/Fulfillment] Scheduled unsent paid email scan failed:', err.message);
  });
}, 60 * 1000);

const PORT = process.env.PORT || 7000;

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is running on port ${PORT}`);
});
