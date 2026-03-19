// src/models/Service.js
const mongoose = require('mongoose');

const ServiceSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  description: String,

  // ── All 7 categories from the menu ────────────────────────────────────────
  category: {
    type: String,
    enum: [
      'Massage Services',
      'Foot Treatment',
      'Spot Massage',
      'Body Scrub',
      'Facial Treatment',
      'Packages',
      'Couples Packages'
    ],
    default: 'Massage Services'
  },

  // Duration-based pricing map  e.g. { 30: 350, 60: 699, 90: 979, 120: 1279 }
  pricing: {
    type: Map,
    of: Number,
    default: new Map()
  },

  // Which durations (in minutes) are selectable for this service
  allowedDurations: {
    type: [Number],
    default: [60, 90, 120]
  },

  // Flat price for fixed-price services (no duration selector shown)
  price: { type: Number, default: 0 },

  // true  → fixed single price, duration selector hidden in booking UI
  // false → duration selector is shown and pricing is per-duration
  isFixedPrice: { type: Boolean, default: false },

  // Default/fallback duration in minutes (used for scheduling)
  durationMinutes: { type: Number, default: 60 },

  active: { type: Boolean, default: true },

  image: { type: String, default: null },

  // ── Analytics ──────────────────────────────────────────────────────────────
  bookingCount:  { type: Number, default: 0 },
  averageRating: { type: Number, default: 0, min: 0, max: 5 },
  totalRatings:  { type: Number, default: 0 },

  createdAt: { type: Date, default: Date.now }
});

ServiceSchema.methods.updateRating = function (newRating) {
  const totalScore = this.averageRating * this.totalRatings + newRating;
  this.totalRatings += 1;
  this.averageRating = totalScore / this.totalRatings;
  return this.save();
};

ServiceSchema.methods.incrementBookingCount = function () {
  this.bookingCount += 1;
  return this.save();
};

module.exports = mongoose.model('Service', ServiceSchema);