// src/models/User.js
const mongoose = require('mongoose');

const WeeklyScheduleSchema = new mongoose.Schema({
  dayOfWeek: { 
    type: String, 
    enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
    required: true 
  },
  isWorking: { type: Boolean, default: true },
  shifts: [{
    startTime: { type: String, required: true },
    endTime: { type: String, required: true }
  }],
  // CRITICAL: Add breaks here
  breaks: [{
    label: { type: String, default: 'Break' },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true }
  }]
}, { _id: false });

const DateOverrideSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  isWorking: { type: Boolean, default: false },
  shifts: [{
    startTime: String,
    endTime: String
  }],
  // Breaks for date overrides
  breaks: [{
    label: { type: String, default: 'Break' },
    startTime: { type: String, required: true },
    endTime: { type: String, required: true }
  }],
  reason: String
}, { _id: false });

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['admin', 'client', 'therapist'], default: 'client' },
  phone: String,
  
  expertise: [{ type: String }],
  weeklySchedule: [WeeklyScheduleSchema],
  dateOverrides: [DateOverrideSchema],
  
  defaultShift: {
    startTime: { type: String, default: "9:00 AM" },
    endTime: { type: String, default: "8:00 PM" }
  },
  
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);