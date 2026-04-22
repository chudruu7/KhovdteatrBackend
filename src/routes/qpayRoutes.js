// src/routes/qpayRoutes.js
import express from 'express';
import {
  createInvoice,
  checkPayment,
  handleCallback,
  cancelInvoice,
  createEbarimtHandler,
  cancelPaymentHandler,
} from '../controllers/qpayController.js';

const router = express.Router();

// Invoice
router.post  ('/invoice',                createInvoice);        // Нэхэмжлэл үүсгэх
router.delete('/invoice/:invoiceId',     cancelInvoice);        // Нэхэмжлэл цуцлах
router.post('/test-complete/:invoiceId', async (req, res) => {
  // Booking-ийг manual PAID болгох
  res.json({ success: true, paid: true });
});
// Payment
router.get   ('/payment/:invoiceId',     checkPayment);         // Төлбөр шалгах
router.delete('/payment/:paymentId',     cancelPaymentHandler); // Төлбөр буцаах
router.get   ('/callback',               handleCallback);       // QPay callback

// Ebarimt
router.post  ('/ebarimt',                createEbarimtHandler); // И-баримт үүсгэх

export default router;