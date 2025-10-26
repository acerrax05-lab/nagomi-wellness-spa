// src/routes/services.js
const express = require('express');
const router = express.Router();
const Service = require('../models/Service');
const auth = require('../middleware/auth');
const roles = require('../middleware/roles');

// Public: list services
router.get('/', async (req, res) => {
  const services = await Service.find({ active: true }).sort({ name: 1 });
  res.json(services);
});

// Admin: add a service
router.post('/', auth, roles(['admin']), async (req, res) => {
  const { name, description, durationMinutes, price } = req.body;
  if (!name) return res.status(400).json({ msg: 'Name required' });
  const s = await Service.create({ name, description, durationMinutes, price });
  res.json({ msg: 'Service created', service: s });
});

// Admin: update a service
router.put('/:id', auth, roles(['admin']), async (req, res) => {
  const updated = await Service.findByIdAndUpdate(req.params.id, req.body, { new: true });
  res.json({ msg: 'Service updated', service: updated });
});

// Admin: deactivate a service
router.delete('/:id', auth, roles(['admin']), async (req, res) => {
  const s = await Service.findByIdAndUpdate(req.params.id, { active: false }, { new: true });
  res.json({ msg: 'Service deactivated', service: s });
});

module.exports = router;
