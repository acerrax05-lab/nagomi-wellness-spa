// src/routes/settings.js 
const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');
const auth = require('../middleware/auth');
const roles = require('../middleware/roles');

// Get commission settings (Admin only)
router.get('/commission', auth, roles(['admin']), async (req, res) => {
  try {
    let settings = await Settings.findOne({ key: 'commission' });
    
    if (!settings) {
      // Create default settings
      settings = await Settings.create({
        key: 'commission',
        value: {
          rate: 60,
          baseRate: 0
        },
        description: 'Therapist commission settings'
      });
    }
    
    res.json(settings.value);
  } catch (err) {
    console.error('Error fetching commission settings:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Update commission settings (Admin only)
router.put('/commission', auth, roles(['admin']), async (req, res) => {
  try {
    const { rate, baseRate } = req.body;
    
    if (rate < 0 || rate > 100) {
      return res.status(400).json({ msg: 'Commission rate must be between 0 and 100' });
    }
    
    let settings = await Settings.findOne({ key: 'commission' });
    
    if (settings) {
      settings.value = { rate, baseRate: baseRate || 0 };
      await settings.save();
    } else {
      settings = await Settings.create({
        key: 'commission',
        value: { rate, baseRate: baseRate || 0 },
        description: 'Therapist commission settings'
      });
    }
    
    res.json({ msg: 'Commission settings updated', value: settings.value });
  } catch (err) {
    console.error('Error updating commission settings:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Get post-service rest setting (Public - needed for availability checks)
router.get('/postServiceRest', async (req, res) => {
  try {
    let setting = await Settings.findOne({ key: 'postServiceRest' });
    
    if (!setting) {
      setting = await Settings.create({
        key: 'postServiceRest',
        value: 60,
        description: 'Minutes of rest after each service'
      });
    }
    
    res.json(setting);
  } catch (err) {
    console.error('Error fetching postServiceRest:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Update post-service rest (Admin only)
router.put('/postServiceRest', auth, roles(['admin']), async (req, res) => {
  try {
    const { value, description } = req.body;
    
    let setting = await Settings.findOne({ key: 'postServiceRest' });
    
    if (setting) {
      setting.value = value;
      if (description) setting.description = description;
      await setting.save();
    } else {
      setting = await Settings.create({
        key: 'postServiceRest',
        value,
        description: description || 'Minutes of rest after each service'
      });
    }
    
    res.json(setting);
  } catch (err) {
    console.error('Error updating postServiceRest:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// GET closures (public — needed by client booking form)
router.get('/closures', async (req, res) => {
  try {
    let setting = await Settings.findOne({ key: 'closures' });
    if (!setting) {
      setting = await Settings.create({ key: 'closures', value: [], description: 'Store closure periods (holidays + vacations)' });
    }
    res.json({ closures: setting.value || [] });
  } catch (err) {
    console.error('Error fetching closures:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// PUT closures (Admin only)
router.put('/closures', auth, roles(['admin']), async (req, res) => {
  try {
    const { closures } = req.body;
    if (!Array.isArray(closures)) {
      return res.status(400).json({ msg: 'closures must be an array' });
    }
    let setting = await Settings.findOne({ key: 'closures' });
    if (setting) {
      setting.value = closures;
      await setting.save();
    } else {
      setting = await Settings.create({ key: 'closures', value: closures, description: 'Store closure periods (holidays + vacations)' });
    }
    res.json({ msg: 'Closures updated', closures: setting.value });
  } catch (err) {
    console.error('Error updating closures:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Get a specific setting by key (Mixed access)
router.get('/:key', async (req, res) => {
  try {
    const { key } = req.params;
    
    let setting = await Settings.findOne({ key });
    
    if (!setting) {
      // Default values if not found
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