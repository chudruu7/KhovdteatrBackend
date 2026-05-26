import mongoose from 'mongoose';

const cashierScanSchema = new mongoose.Schema({
  stationKey: {
    type: String,
    required: true,
    index: true,
  },
  booking: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    default: null,
  },
  scannedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  qrData: {
    type: String,
    default: '',
  },
  result: {
    type: String,
    enum: ['valid', 'warning', 'invalid'],
    required: true,
  },
  message: {
    type: String,
    default: '',
  },
  payload: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 24 * 60 * 60 * 1000),
  },
}, { timestamps: true });

cashierScanSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
cashierScanSchema.index({ stationKey: 1, createdAt: -1 });

const CashierScan = mongoose.model('CashierScan', cashierScanSchema);
export default CashierScan;
