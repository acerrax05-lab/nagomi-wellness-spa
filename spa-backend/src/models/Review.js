const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  booking: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking'
  },
  
  // Guest review fields
  guestName: {
    type: String,
    trim: true
  },
  
  guestEmail: {
    type: String,
    trim: true,
    lowercase: true
  },
  
  isGuest: {
    type: Boolean,
    default: false
  },
  
  service: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Service',
    required: true
  },
  
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5
  },
  
  comment: {
    type: String,
    required: true,
    trim: true,
    minlength: 10,
    maxlength: 1000
  },
  
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  
  hidden: {
    type: Boolean,
    default: false
  },
  
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

reviewSchema.index({ service: 1, status: 1 });
reviewSchema.index({ user: 1 });
reviewSchema.index({ createdAt: -1 });

reviewSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

reviewSchema.pre('save', function(next) {
  if (!this.user && !this.guestName) {
    next(new Error('Review must have either user or guest name'));
  } else {
    next();
  }
});

module.exports = mongoose.model('Review', reviewSchema);