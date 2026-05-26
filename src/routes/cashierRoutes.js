import express from 'express';
import {
  admitTicket,
  getCashierTicket,
  getLatestStationScan,
  scanTicketToStation,
} from '../controllers/cashierController.js';
import { authorize, protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);
router.use(authorize('admin', 'cashier'));

router.get('/tickets/:bookingId', getCashierTicket);
router.post('/tickets/:bookingId/admit', admitTicket);
router.get('/stations/:stationKey/latest', getLatestStationScan);
router.post('/stations/:stationKey/scans', scanTicketToStation);

export default router;
