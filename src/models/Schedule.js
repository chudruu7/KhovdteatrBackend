// src/models/Schedule.js

import mongoose from 'mongoose';

// Суудлын Загвар
const hallLayoutSchema = new mongoose.Schema({
  hallName: {
    type: String,
    required: true,
  },
  rows: {
    type: Number,
    required: true,
  },
  seatsPerRow: {
    type: Number,
    required: true,
  },
  totalSeats: {
    type: Number,
    required: true,
  }
});

// Кино гарах цагийн хуваарийн загвар
const scheduleSchema = new mongoose.Schema({
  movie: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Movie',
    required: true,
    index: true,
  },
  showTime: {
    type: Date,
    required: true,
    index: true,
  },
  hall: {
    type: hallLayoutSchema,
    required: true,
  },
  soldSeats: {
    type: [String],
    default: [],
  },
  basePrice: {
    type: Number,
    required: true,
    default: 15000,
  }
}, {
  timestamps: true
});

// Индексүүд
scheduleSchema.index({ movie: 1, showTime: 1 });
scheduleSchema.index({ showTime: 1 });

const Schedule = mongoose.model('Schedule', scheduleSchema);

export default Schedule;