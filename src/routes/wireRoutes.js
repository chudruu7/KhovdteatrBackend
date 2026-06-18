import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  createWireCheckout,
  getWireActionCheckoutStatus,
  getWirePaymentStatus,
  handleWireWebhook,
  renderWireActionCheckout,
  renderWireSandboxCheckout,
} from '../controllers/wireController.js';

const router = express.Router();

router.post('/checkout', protect, createWireCheckout);
router.get('/payments/:bookingId/status', protect, getWirePaymentStatus);
router.get('/checkout/action/:paymentIntentId', renderWireActionCheckout);
router.get('/checkout/action/:paymentIntentId/status', getWireActionCheckoutStatus);
router.get('/sandbox/checkout/:paymentIntentId', renderWireSandboxCheckout);
router.post('/webhook', handleWireWebhook);

export default router;