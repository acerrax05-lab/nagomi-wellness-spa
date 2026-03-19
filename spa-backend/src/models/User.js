// src/models/User.js
// ─────────────────────────────────────────────────────────────────────────
// Added fields (NEW — won't break existing data):
//   paySchedule   : 'semi-monthly' (every 15 days, default) | 'weekly'
//   commissionRate: 0-100 (% of service price, default 60)
//   payrollNotes  : free-text (e.g. "weekly - supporting children")
// ─────────────────────────────────────────────────────────────────────────
const mongoose = require('mongoose');

const ShiftSchema = new mongoose.Schema({
  startTime: String,
  endTime:   String,
}, { _id: false });

const DayScheduleSchema = new mongoose.Schema({
  dayOfWeek: { type: String, enum: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'] },
  isWorking: { type: Boolean, default: true },
  shifts:    [ShiftSchema],
  breaks:    [ShiftSchema],
}, { _id: false });

const DateOverrideSchema = new mongoose.Schema({
  date:      { type: Date, required: true },
  isWorking: { type: Boolean, default: false },
  shifts:    [ShiftSchema],
  reason:    { type: String, default: 'Unavailable' },
});

const UserSchema = new mongoose.Schema({
  name:         { type: String, required: true },
  email:        { type: String, required: true, unique: true, lowercase: true },
  passwordHash: { type: String, required: true },

  role: {
    type:    String,
    enum:    ['admin', 'therapist'],
    default: 'therapist',
  },

  // ── Therapist-specific fields ──────────────────────────────────────
  expertise:     [{ type: String }],
  defaultShift:  { startTime: String, endTime: String },
  weeklySchedule: [DayScheduleSchema],
  dateOverrides:  [DateOverrideSchema],

  // ── ✅ NEW: Pay & commission settings ──────────────────────────────
  paySchedule: {
    type:    String,
    enum:    ['semi-monthly', 'weekly'],
    default: 'semi-monthly',
    // 'semi-monthly' = paid on the 15th and last day of each month
    // 'weekly'       = paid every Friday (for therapists supporting children)
  },

  commissionRate: {
    type:    Number,
    default: 60,      // 60% of service price goes to the therapist
    min:     0,
    max:     100,
  },

  payrollNotes: {
    type:    String,
    default: '',
    // e.g. "Weekly pay — supporting children"
  },
  // ── ──────────────────────────────────────────────────────────────

  gender: {
    type:    String,
    enum:    ['male', 'female'],
    default: 'female',
  },

  isActive:  { type: Boolean, default: true },
  createdAt: { type: Date,    default: Date.now },
}, { timestamps: true });

module.exports = mongoose.model('User', UserSchema);