// src/models/Booking.js
const mongoose = require('mongoose');

const BookingSchema = new mongoose.Schema({
  service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
  
  // Multiple therapists support
  therapists: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  therapist: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Keep for backward compatibility
  
  // Client is optional (only for staff-created bookings)
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  // Guest info (required for public bookings)
  guestName: { type: String, required: true },
  guestPhone: { type: String, required: true },
  
  // NEW: Number of clients
  numberOfClients: { type: Number, default: 1, min: 1, max: 5 },
  
  durationMinutes: { type: Number, required: true },
  date: { type: Date, required: true },
  time: { type: String, required: true },
  
  // NEW: End time (calculated)
  endTime: { type: String },
  
  notes: { type: String },
  price: { type: Number, required: true },
  
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'completed', 'cancelled'],
    default: 'pending'
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Booking', BookingSchema);