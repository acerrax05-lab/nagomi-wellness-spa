// src/routes/therapists.js
const express = require('express');
const router  = express.Router();
const bcrypt  = require('bcryptjs');
const User    = require('../models/User');
const auth    = require('../middleware/auth');
const roles   = require('../middleware/roles');

// ── GET /api/therapists — all therapists ──────────────────────────────────
router.get('/', auth, roles(['admin']), async (req, res) => {
  try {
    const therapists = await User.find({ role: 'therapist' })
      .select('-passwordHash')
      .sort({ name: 1 });
    res.json(therapists);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET /api/therapists/me — therapist fetches their own profile
router.get('/me', auth, roles(['therapist', 'admin']), async (req, res) => {
  try {
    const therapist = await User.findById(req.user.id).select('-passwordHash');
    if (!therapist) return res.status(404).json({ msg: 'Therapist not found' });
    res.json(therapist);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ── GET /api/therapists/:id ────────────────────────────────────────────────
router.get('/:id', auth, roles(['admin']), async (req, res) => {
  try {
    const therapist = await User.findOne({ _id: req.params.id, role: 'therapist' })
      .select('-passwordHash');
    if (!therapist) return res.status(404).json({ msg: 'Therapist not found' });
    res.json(therapist);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ── POST /api/therapists — create therapist (admin) ───────────────────────
router.post('/', auth, roles(['admin']), async (req, res) => {
  try {
    const { name, email, phone } = req.body;

    if (!name || !email) {
      return res.status(400).json({ msg: 'Name and email are required' });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ msg: 'A user with this email already exists' });
    }

    // ✅ Default password is therapist123
    const passwordHash = await bcrypt.hash('therapist123', 10);

    const therapist = await User.create({
      name,
      email:        email.toLowerCase(),
      passwordHash,
      role:         'therapist',
      phone:        phone || '',
      isActive:     true,
      expertise:    [],
      weeklySchedule: [],
      dateOverrides:  [],
      paySchedule:    'semi-monthly',   // ✅ NEW: default pay schedule
      commissionRate: 60,               // ✅ NEW: default commission rate
      payrollNotes:   '',
    });

    const safe = await User.findById(therapist._id).select('-passwordHash');
    res.status(201).json({ msg: 'Therapist created. Default password: therapist123', therapist: safe });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});

// ── PUT /api/therapists/:id — update basic info ───────────────────────────
router.put('/:id', auth, roles(['admin']), async (req, res) => {
  try {
    const { name, email, phone } = req.body;
    const updates = {};
    if (name)  updates.name  = name;
    if (email) updates.email = email.toLowerCase();
    if (phone !== undefined) updates.phone = phone;

    const therapist = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'therapist' },
      { $set: updates },
      { new: true }
    ).select('-passwordHash');

    if (!therapist) return res.status(404).json({ msg: 'Therapist not found' });
    res.json({ msg: 'Therapist updated', therapist });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ── PATCH /api/therapists/:id/expertise ──────────────────────────────────
router.patch('/:id/expertise', auth, roles(['admin']), async (req, res) => {
  try {
    const { expertise } = req.body;
    if (!Array.isArray(expertise)) return res.status(400).json({ msg: 'Expertise must be an array' });

    const therapist = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'therapist' },
      { expertise },
      { new: true }
    ).select('-passwordHash');

    if (!therapist) return res.status(404).json({ msg: 'Therapist not found' });
    res.json({ msg: 'Expertise updated', therapist });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ── PATCH /api/therapists/:id/schedule ───────────────────────────────────
router.patch('/:id/schedule', auth, roles(['admin']), async (req, res) => {
  try {
    const { weeklySchedule } = req.body;
    if (!Array.isArray(weeklySchedule)) return res.status(400).json({ msg: 'Weekly schedule must be an array' });

    const validDays = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
    for (const day of weeklySchedule) {
      if (!validDays.includes(day.dayOfWeek)) return res.status(400).json({ msg: `Invalid day: ${day.dayOfWeek}` });
      if (day.isWorking && (!day.shifts || day.shifts.length === 0)) {
        return res.status(400).json({ msg: `${day.dayOfWeek} is marked as working but has no shifts` });
      }
    }

    const therapist = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'therapist' },
      { weeklySchedule },
      { new: true }
    ).select('-passwordHash');

    if (!therapist) return res.status(404).json({ msg: 'Therapist not found' });
    res.json({ msg: 'Schedule updated', therapist });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ── POST /api/therapists/:id/date-override ───────────────────────────────
router.post('/:id/date-override', auth, roles(['admin']), async (req, res) => {
  try {
    const { date, isWorking, shifts, reason } = req.body;
    if (!date) return res.status(400).json({ msg: 'Date is required' });

    const therapist = await User.findOne({ _id: req.params.id, role: 'therapist' });
    if (!therapist) return res.status(404).json({ msg: 'Therapist not found' });

    const overrideDate  = new Date(date);
    const existingIndex = therapist.dateOverrides.findIndex(o =>
      new Date(o.date).toDateString() === overrideDate.toDateString()
    );
    const override = { date: overrideDate, isWorking: isWorking || false, shifts: shifts || [], reason: reason || '' };

    if (existingIndex !== -1) therapist.dateOverrides[existingIndex] = override;
    else therapist.dateOverrides.push(override);

    await therapist.save();
    const updated = await User.findById(therapist._id).select('-passwordHash');
    res.json({ msg: 'Date override added', therapist: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ── DELETE /api/therapists/:id/date-override/:date ───────────────────────
router.delete('/:id/date-override/:date', auth, roles(['admin']), async (req, res) => {
  try {
    const therapist = await User.findOne({ _id: req.params.id, role: 'therapist' });
    if (!therapist) return res.status(404).json({ msg: 'Therapist not found' });

    const targetDate = new Date(req.params.date);
    therapist.dateOverrides = therapist.dateOverrides.filter(o =>
      new Date(o.date).toDateString() !== targetDate.toDateString()
    );
    await therapist.save();

    const updated = await User.findById(therapist._id).select('-passwordHash');
    res.json({ msg: 'Date override removed', therapist: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ── PATCH /api/therapists/:id/default-shift ──────────────────────────────
router.patch('/:id/default-shift', auth, roles(['admin']), async (req, res) => {
  try {
    const { startTime, endTime } = req.body;
    if (!startTime || !endTime) return res.status(400).json({ msg: 'Start and end time required' });

    const therapist = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'therapist' },
      { defaultShift: { startTime, endTime } },
      { new: true }
    ).select('-passwordHash');

    if (!therapist) return res.status(404).json({ msg: 'Therapist not found' });
    res.json({ msg: 'Default shift updated', therapist });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ── PATCH /api/therapists/:id/toggle-active ──────────────────────────────
router.patch('/:id/toggle-active', auth, roles(['admin']), async (req, res) => {
  try {
    const therapist = await User.findOne({ _id: req.params.id, role: 'therapist' });
    if (!therapist) return res.status(404).json({ msg: 'Therapist not found' });

    therapist.isActive = !therapist.isActive;
    await therapist.save();

    const updated = await User.findById(therapist._id).select('-passwordHash');
    res.json({ msg: `Therapist ${therapist.isActive ? 'activated' : 'deactivated'}`, therapist: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ── PUT /api/therapists/:id/pay-settings (admin) ─────────────────────────
// Also accessible via /api/payroll/settings/:id in payroll.js
// Duplicated here so admin can call either route
router.put('/:id/pay-settings', auth, roles(['admin']), async (req, res) => {
  try {
    const { paySchedule, commissionRate, payrollNotes } = req.body;
    const updates = {};
    if (paySchedule)                     updates.paySchedule    = paySchedule;
    if (commissionRate !== undefined)    updates.commissionRate = commissionRate;
    if (payrollNotes   !== undefined)    updates.payrollNotes   = payrollNotes;

    const therapist = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'therapist' },
      { $set: updates },
      { new: true, select: '-passwordHash' }
    );

    if (!therapist) return res.status(404).json({ msg: 'Therapist not found' });
    res.json({ msg: 'Pay settings updated', therapist });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;