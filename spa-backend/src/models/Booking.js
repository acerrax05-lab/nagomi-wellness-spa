// models/Booking.js - UPDATED WITH PAYMENT METHOD
const mongoose = require('mongoose');

const BookingSchema = new mongoose.Schema({
  service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
  
  therapists: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  therapist: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  guestName: { type: String, required: true },
  guestPhone: { type: String, required: true },
  
  numberOfClients: { type: Number, default: 1, min: 1, max: 5 },
  
  durationMinutes: { type: Number, required: true },
  date: { type: Date, required: true },
  time: { type: String, required: true },
  
  endTime: { type: Date },  // When service ends (no grace period)
  availableAfter: { type: Date },  // When therapist becomes available (includes grace period)
  
  notes: { type: String },
  price: { type: Number, required: true },
  
  // ✅ NEW: Payment method field
  paymentMethod: {
    type: String,
    enum: ['COD', 'PayPal', 'GCash', 'Credit Card'],
    required: true
  },
  
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'completed', 'cancelled'],
    default: 'pending'
  },
  
  cancellationReason: { type: String },
  
  createdAt: { type: Date, default: Date.now }
});

// Indexes for better query performance
BookingSchema.index({ therapist: 1, date: 1, status: 1 });
BookingSchema.index({ therapists: 1, date: 1, status: 1 });
BookingSchema.index({ date: 1, time: 1 });
BookingSchema.index({ status: 1, date: 1 });

module.exports = mongoose.model('Booking', BookingSchema);