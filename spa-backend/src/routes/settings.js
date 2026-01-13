const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');
const auth = require('../middleware/auth');
const roles = require('../middleware/roles');

// Get a specific setting (public for post-service rest)
router.get('/:key', async (req, res) => {
  try {
    const { key } = req.params;
    
    let setting = await Settings.findOne({ key });
    
    // Default values if not found
    if (!setting) {
      const defaults = {
        'postServiceRest': { value: 60, description: 'Minutes of rest after each service' }
      };
      
      if (defaults[key]) {
        setting = await Settings.create({ key, ...defaults[key] });
      } else {
        return res.status(404).json({ msg: 'Setting not found' });
      }
    }
    
    res.json(setting);
  } catch (err) {
    console.error('Error fetching setting:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Update a setting (Admin only)
router.put('/:key', auth, roles(['admin']), async (req, res) => {
  try {
    const { key } = req.params;
    const { value, description } = req.body;
    
    let setting = await Settings.findOne({ key });
    
    if (setting) {
      setting.value = value;
      if (description) setting.description = description;
      setting.updatedAt = Date.now();
      await setting.save();
    } else {
      setting = await Settings.create({ key, value, description });
    }
    
    res.json({ msg: 'Setting updated successfully', setting });
  } catch (err) {
    console.error('Error updating setting:', err);
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});

// Get all settings (Admin only)
router.get('/', auth, roles(['admin']), async (req, res) => {
  try {
    const settings = await Settings.find();
    
    const formatted = {};
    settings.forEach(s => {
      formatted[s.key] = s.value;
    });
    
    res.json(formatted);
  } catch (err) {
    console.error('Error fetching settings:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;