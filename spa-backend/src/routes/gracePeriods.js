const express = require('express');
const router = express.Router();
const GracePeriod = require('../models/GracePeriod');
const auth = require('../middleware/auth');
const roles = require('../middleware/roles');

// Get all grace periods (public - needed for booking page)
router.get('/', async (req, res) => {
  try {
    const gracePeriods = await GracePeriod.find({ isActive: true }).sort({ dayOfWeek: 1 });
    
    const formatted = {};
    gracePeriods.forEach(gp => {
      formatted[gp.dayOfWeek] = gp.periods;
    });
    
    res.json(formatted);
  } catch (err) {
    console.error('Error fetching grace periods:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Get grace period for a specific day
router.get('/:dayOfWeek', async (req, res) => {
  try {
    const { dayOfWeek } = req.params;
    
    const gracePeriod = await GracePeriod.findOne({ 
      dayOfWeek, 
      isActive: true 
    });
    
    if (!gracePeriod) {
      return res.json({ dayOfWeek, periods: [] });
    }
    
    res.json(gracePeriod);
  } catch (err) {
    console.error('Error fetching grace period:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Bulk update all grace periods (Admin only)
router.put('/bulk', auth, roles(['admin']), async (req, res) => {
  try {
    const { gracePeriods } = req.body;
    
    if (!gracePeriods || typeof gracePeriods !== 'object') {
      return res.status(400).json({ msg: 'Invalid data format' });
    }
    
    const updated = [];
    
    for (const [dayOfWeek, periods] of Object.entries(gracePeriods)) {
      let gracePeriod = await GracePeriod.findOne({ dayOfWeek });
      
      if (gracePeriod) {
        gracePeriod.periods = periods;
        gracePeriod.updatedAt = Date.now();
        await gracePeriod.save();
      } else {
        gracePeriod = await GracePeriod.create({
          dayOfWeek,
          periods,
          isActive: true
        });
      }
      
      updated.push(gracePeriod);
    }
    
    res.json({ 
      msg: 'Grace periods updated successfully',
      updated 
    });
  } catch (err) {
    console.error('Error bulk updating grace periods:', err);
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});

module.exports = router;