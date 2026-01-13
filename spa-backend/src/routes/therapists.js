// src/routes/therapists.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');
const roles = require('../middleware/roles');

// Get all therapists with their schedules
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

// Get single therapist details
router.get('/:id', auth, roles(['admin']), async (req, res) => {
  try {
    const therapist = await User.findOne({ 
      _id: req.params.id, 
      role: 'therapist' 
    }).select('-passwordHash');
    
    if (!therapist) {
      return res.status(404).json({ msg: 'Therapist not found' });
    }
    
    res.json(therapist);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Update therapist expertise
router.patch('/:id/expertise', auth, roles(['admin']), async (req, res) => {
  try {
    const { expertise } = req.body;
    
    if (!Array.isArray(expertise)) {
      return res.status(400).json({ msg: 'Expertise must be an array' });
    }
    
    const therapist = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'therapist' },
      { expertise },
      { new: true }
    ).select('-passwordHash');
    
    if (!therapist) {
      return res.status(404).json({ msg: 'Therapist not found' });
    }
    
    res.json({ msg: 'Expertise updated', therapist });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Update therapist weekly schedule
router.patch('/:id/schedule', auth, roles(['admin']), async (req, res) => {
  try {
    const { weeklySchedule } = req.body;
    
    if (!Array.isArray(weeklySchedule)) {
      return res.status(400).json({ msg: 'Weekly schedule must be an array' });
    }
    
    // Validate schedule format
    const validDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    for (const daySchedule of weeklySchedule) {
      if (!validDays.includes(daySchedule.dayOfWeek)) {
        return res.status(400).json({ msg: `Invalid day: ${daySchedule.dayOfWeek}` });
      }
      
      if (daySchedule.isWorking && (!daySchedule.shifts || daySchedule.shifts.length === 0)) {
        return res.status(400).json({ 
          msg: `${daySchedule.dayOfWeek} is marked as working but has no shifts defined` 
        });
      }
    }
    
    const therapist = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'therapist' },
      { weeklySchedule },
      { new: true }
    ).select('-passwordHash');
    
    if (!therapist) {
      return res.status(404).json({ msg: 'Therapist not found' });
    }
    
    res.json({ msg: 'Schedule updated', therapist });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Add date override (vacation, special hours, etc.)
router.post('/:id/date-override', auth, roles(['admin']), async (req, res) => {
  try {
    const { date, isWorking, shifts, reason } = req.body;
    
    if (!date) {
      return res.status(400).json({ msg: 'Date is required' });
    }
    
    const therapist = await User.findOne({ 
      _id: req.params.id, 
      role: 'therapist' 
    });
    
    if (!therapist) {
      return res.status(404).json({ msg: 'Therapist not found' });
    }
    
    // Check if override already exists for this date
    const overrideDate = new Date(date);
    const existingIndex = therapist.dateOverrides.findIndex(o => 
      new Date(o.date).toDateString() === overrideDate.toDateString()
    );
    
    const override = {
      date: overrideDate,
      isWorking: isWorking || false,
      shifts: shifts || [],
      reason: reason || ''
    };
    
    if (existingIndex !== -1) {
      // Update existing override
      therapist.dateOverrides[existingIndex] = override;
    } else {
      // Add new override
      therapist.dateOverrides.push(override);
    }
    
    await therapist.save();
    
    const updated = await User.findById(therapist._id).select('-passwordHash');
    
    res.json({ msg: 'Date override added', therapist: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Remove date override
router.delete('/:id/date-override/:date', auth, roles(['admin']), async (req, res) => {
  try {
    const therapist = await User.findOne({ 
      _id: req.params.id, 
      role: 'therapist' 
    });
    
    if (!therapist) {
      return res.status(404).json({ msg: 'Therapist not found' });
    }
    
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

// Update default shift
router.patch('/:id/default-shift', auth, roles(['admin']), async (req, res) => {
  try {
    const { startTime, endTime } = req.body;
    
    if (!startTime || !endTime) {
      return res.status(400).json({ msg: 'Start time and end time are required' });
    }
    
    const therapist = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'therapist' },
      { defaultShift: { startTime, endTime } },
      { new: true }
    ).select('-passwordHash');
    
    if (!therapist) {
      return res.status(404).json({ msg: 'Therapist not found' });
    }
    
    res.json({ msg: 'Default shift updated', therapist });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Toggle therapist active status
router.patch('/:id/toggle-active', auth, roles(['admin']), async (req, res) => {
  try {
    const therapist = await User.findOne({ 
      _id: req.params.id, 
      role: 'therapist' 
    });
    
    if (!therapist) {
      return res.status(404).json({ msg: 'Therapist not found' });
    }
    
    therapist.isActive = !therapist.isActive;
    await therapist.save();
    
    const updated = await User.findById(therapist._id).select('-passwordHash');
    
    res.json({ 
      msg: `Therapist ${therapist.isActive ? 'activated' : 'deactivated'}`, 
      therapist: updated 
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;