const mongoose = require('mongoose');

const GracePeriodSchema = new mongoose.Schema({
  dayOfWeek: {
    type: String,
    enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    required: true,
    unique: true
  },
  periods: [{
    label: { type: String, default: 'Rest Period' },
    startTime: { type: String, required: true }, // e.g., "1:00 PM"
    endTime: { type: String, required: true }     // e.g., "2:00 PM"
  }],
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Update the updatedAt timestamp before saving
GracePeriodSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('GracePeriod', GracePeriodSchema);