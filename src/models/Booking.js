import mongoose from 'mongoose';

const bookingSchema = new mongoose.Schema({
  schedule: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Schedule',
    required: [true, 'Цагийн хуваарь заавал шаардлагатай.'],
  },
  movie: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Movie',
    required: true,
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null,
  },
  customer: {
    name:  { type: String, required: [true, 'Нэр заавал шаардлагатай.'] },
    email: { type: String, required: [true, 'И-мэйл заавал шаардлагатай.'] },
    phone: { type: String },
  },
  seats: {
    type: [String],
    required: [true, 'Суудал заавал сонгох шаардлагатай.'],
  },
  totalPrice: {
    type: Number,
    required: true,
  },
  status: {
    type: String,
    enum: ['active', 'used', 'cancelled'],
    default: 'active',
  },
  payment: {
    method: {
      type: String,
      enum: ['card', 'cash', 'qpay', 'other'],
      required: true,
    },
    transactionId: { type: String, default: null },
    status: {
      type: String,
      enum: ['pending', 'paid', 'failed'],
      default: 'pending',
    },
  },
  expiredAt: {
    type: Date,
    default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  },
}, { timestamps: true });

// TTL index — expiredAt болмогц MongoDB автоматаар устгана
bookingSchema.index({ expiredAt: 1 }, { expireAfterSeconds: 0 });

const Booking = mongoose.model('Booking', bookingSchema);
export default Booking;