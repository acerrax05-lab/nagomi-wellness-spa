// src/models/Booking.js
const mongoose = require('mongoose');

const BookingSchema = new mongoose.Schema({
  service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
  therapist: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Reference to User with role 'therapist'
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // Reference to client
  date: { type: Date, required: true },
  time: { type: String, required: true },
  notes: { type: String },
  
  // Keep these for non-registered clients (walk-ins)
  guestName: { type: String },
  guestPhone: { type: String },
  
  price: { type: Number, required: true },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'completed', 'cancelled'],
    default: 'pending'
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Booking', BookingSchema);