// src/models/Service.js
const mongoose = require('mongoose');

const ServiceSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String,
  durationMinutes: Number, // e.g. 60, 90
  price: Number,
  active: { type: Boolean, default: true }
});

module.exports = mongoose.model('Service', ServiceSchema);
