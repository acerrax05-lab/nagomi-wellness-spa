const mongoose = require('mongoose');

const ServiceSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  description: String,
  
  pricing: {
    type: Map,
    of: Number,
    default: new Map()
  },
  
  // CRITICAL: Allowed durations for this service
  allowedDurations: {
    type: [Number],
    default: [60, 90, 120] // All durations allowed by default
  },
  
  durationMinutes: Number,
  price: Number,
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Service', ServiceSchema);