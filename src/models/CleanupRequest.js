import mongoose from 'mongoose';

const cleanupRequestSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending',
    },
    stats: {
      bookingCount: { type: Number, default: 0 },
      scheduleCount: { type: Number, default: 0 },
      oldestDate: { type: Date },
    },
    askAgainAfter: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

export default mongoose.model('CleanupRequest', cleanupRequestSchema);