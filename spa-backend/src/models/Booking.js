// models/Booking.js 
const mongoose = require('mongoose');

const BookingSchema = new mongoose.Schema({
  service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
  
  therapists: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  therapist: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  client: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  guestName: { type: String, required: true },
  guestPhone: { type: String, required: true },
  
  numberOfClients: { type: Number, default: 1, min: 1, max: 6 },
  femaleClients:   { type: Number, default: 0, min: 0, max: 4 },
  maleClients:     { type: Number, default: 0, min: 0, max: 2 },
  
  durationMinutes: { type: Number, required: true },
  date: { type: Date, required: true },
  time: { type: String, required: true },
  
  endTime: { type: Date },
  availableAfter: { type: Date },
  
  notes: { type: String },
  price: { type: Number, required: true },
  
  paymentMethod: {
    type: String,
    enum: [
      'Cash on Arrival',
      'Online Payment',
      'GCash',
      'Maya',
      'Credit Card',
      'Debit Card',
      'Not specified',
    ],
    default: 'Not specified',
  },
  
  status: {
    type: String,
    enum: ['pending','confirmed','completed','cancelled','pending_cancellation','pending_reschedule'],
    default: 'pending',
  },

  previousStatus: {
    type: String,
    enum: ['pending', 'confirmed', 'completed', 'cancelled', null],
    default: null,
  },

  bookingType: {
    type: String,
    enum: ['online', 'walk-in'],
    default: 'online',
  },

  assignNote: {
  type: String,
  default: null
},

  cancellationReason: { type: String, default: null },
  cancellationRequestedAt: { type: Date, default: null },
  cancelledAt: { type: Date, default: null },

  rescheduleReason: { type: String, default: null },
  rescheduleRequestedAt: { type: Date, default: null },
  pendingRescheduleDate: { type: Date, default: null },
  pendingRescheduleTime: { type: String, default: null },

  adminRejectionNote: { type: String, default: null },

  rescheduledFrom: {
    date:          { type: Date,   default: null },
    time:          { type: String, default: null },
    rescheduledAt: { type: Date,   default: null },
  },

  completedAt: { type: Date },
  completedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  transactionNumber: {
    type: String,
    unique: true,
    sparse: true,
  },

  reviewed: { type: Boolean, default: false },

}, { timestamps: true });

BookingSchema.index({ therapist: 1, date: 1, status: 1 });
BookingSchema.index({ therapists: 1, date: 1, status: 1 });
BookingSchema.index({ date: 1, time: 1 });
BookingSchema.index({ status: 1, date: 1 });
BookingSchema.index({ transactionNumber: 1 });

BookingSchema.pre('save', function(next) {
  if (this.guestPhone) {
    this.guestPhone = this.guestPhone.replace(/[\s\-\(\)]/g, '');
  }
  if (this.isNew && !this.transactionNumber) {
    const date = new Date();
    const dateStr = date.getFullYear() + 
                    String(date.getMonth() + 1).padStart(2, '0') + 
                    String(date.getDate()).padStart(2, '0');
    const randomStr = Math.random().toString(36).substring(2, 8).toUpperCase();
    this.transactionNumber = `NWS${dateStr}-${randomStr}`;
  }
  next();
});

module.exports = mongoose.model('Booking', BookingSchema);