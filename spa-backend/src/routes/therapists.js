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
    const io = req.app.get('socketio');
    if (io) io.emit('therapistUpdated', { action: 'created', therapist: safe });
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
    const io = req.app.get('socketio');
    if (io) io.emit('therapistUpdated', { action: 'updated', therapist });
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
    const io = req.app.get('socketio');
    if (io) io.emit('therapistUpdated', { action: 'expertiseUpdated', therapist });
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
    const io = req.app.get('socketio');
    if (io) io.emit('therapistUpdated', { action: 'scheduleUpdated', therapist });
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
    const io = req.app.get('socketio');
    if (io) io.emit('therapistUpdated', { action: 'toggled', therapist: updated });
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
    const io = req.app.get('socketio');
    if (io) io.emit('therapistUpdated', { action: 'paySettingsUpdated', therapist });
    res.json({ msg: 'Pay settings updated', therapist });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});


// ── LEAVE / VACATION REQUEST ROUTES ─────────────────────────────────────────

// In-memory store (persists until server restart).
// On approval we write date overrides to DB so the effect survives restarts.
const leaveRequests = [];
let leaveIdCounter  = 1;

// POST /api/therapists/leave-requests — therapist submits a request
router.post('/leave-requests', auth, roles(['therapist']), async (req, res) => {
  try {
    const { type, startDate, endDate, reason, hours } = req.body;
    if (!type || !startDate || !endDate || !reason) {
      return res.status(400).json({ msg: 'type, startDate, endDate, and reason are required' });
    }
    const therapist = await User.findById(req.user.id).select('name email');
    const request = {
      _id:           String(leaveIdCounter++),
      therapistId:   req.user.id,
      therapistName: therapist?.name || 'Unknown',
      therapistEmail:therapist?.email || '',
      type, startDate, endDate, reason,
      hours:         hours || null,
      status:        'pending',
      submittedAt:   new Date(),
    };
    leaveRequests.unshift(request);

    // Notify admin in real time
    const io = req.app.get('socketio');
    if (io) {
      io.emit('leave-request', {
        therapistName: request.therapistName,
        therapistId:   request.therapistId,
        type,
        startDate,
        endDate
      });
    }
    res.status(201).json({ msg: 'Request submitted', request });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET /api/therapists/leave-requests/all — admin views all requests
router.get('/leave-requests/all', auth, roles(['admin']), (req, res) => {
  res.json(leaveRequests);
});

// GET /api/therapists/leave-requests/my — therapist views own requests
router.get('/leave-requests/my', auth, roles(['therapist']), (req, res) => {
  const mine = leaveRequests.filter(r => r.therapistId === req.user.id);
  res.json(mine);
});

// ── Helper: add date overrides for every day in a date range ──────────────
async function addLeaveOverrides(therapistId, startDate, endDate, reason) {
  const therapist = await User.findOne({ _id: therapistId, role: 'therapist' });
  if (!therapist) return;

  const start = new Date(startDate);
  const end   = new Date(endDate);
  start.setHours(0,0,0,0);
  end.setHours(23,59,59,999);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dayDate   = new Date(d);
    const existing  = therapist.dateOverrides.findIndex(o =>
      new Date(o.date).toDateString() === dayDate.toDateString()
    );
    const override  = { date: dayDate, isWorking: false, shifts: [], reason: reason || 'Approved leave' };
    if (existing !== -1) therapist.dateOverrides[existing] = override;
    else therapist.dateOverrides.push(override);
  }

  await therapist.save();
  console.log(`✅ Added leave overrides for ${therapistId} from ${startDate} to ${endDate}`);
}

// ── Helper: remove leave date overrides (on rejection / rollback) ─────────
async function removeLeaveOverrides(therapistId, startDate, endDate) {
  const therapist = await User.findOne({ _id: therapistId, role: 'therapist' });
  if (!therapist) return;

  const start = new Date(startDate); start.setHours(0,0,0,0);
  const end   = new Date(endDate);   end.setHours(23,59,59,999);

  therapist.dateOverrides = therapist.dateOverrides.filter(o => {
    const od = new Date(o.date);
    return !(od >= start && od <= end);
  });
  await therapist.save();
}

// PATCH /api/therapists/leave-requests/:id/approved — admin approves
router.patch('/leave-requests/:id/approved', auth, roles(['admin']), async (req, res) => {
  const r = leaveRequests.find(r => r._id === req.params.id);
  if (!r) return res.status(404).json({ msg: 'Request not found' });

  r.status     = 'approved';
  r.reviewedAt = new Date();

  try {
    // ── Write date overrides to DB so availability checker blocks these dates ──
    await addLeaveOverrides(r.therapistId, r.startDate, r.endDate, r.type === 'vacation' ? 'Vacation' : 'Approved leave');

    // ── Notify therapist in real time so their calendar refreshes ──
    const io = req.app.get('socketio');
    if (io) {
      io.to(r.therapistId.toString()).emit('leave-approved', {
        therapistId: r.therapistId,
        startDate:   r.startDate,
        endDate:     r.endDate,
        type:        r.type
      });
    }
  } catch (err) {
    console.error('⚠️  Could not write date overrides on approval:', err.message);
  }

  res.json({ msg: 'Request approved', request: r });
});

// PATCH /api/therapists/leave-requests/:id/rejected — admin rejects
router.patch('/leave-requests/:id/rejected', auth, roles(['admin']), async (req, res) => {
  const r = leaveRequests.find(r => r._id === req.params.id);
  if (!r) return res.status(404).json({ msg: 'Request not found' });

  r.status     = 'rejected';
  r.reviewedAt = new Date();

  // If it was previously approved, remove the date overrides
  if (r.status === 'approved') {
    try { await removeLeaveOverrides(r.therapistId, r.startDate, r.endDate); } catch(e) {}
  }

  const io = req.app.get('socketio');
  if (io) {
    io.to(r.therapistId.toString()).emit('leave-rejected', {
      therapistId: r.therapistId,
      type:        r.type
    });
  }

  res.json({ msg: 'Request rejected', request: r });
});

module.exports = router;