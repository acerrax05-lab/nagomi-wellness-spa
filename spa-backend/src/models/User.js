// src/models/User.js
const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['admin', 'client', 'therapist'], default: 'client' },
  phone: String,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
