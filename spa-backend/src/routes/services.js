// src/routes/services.js
const express = require('express');
const router = express.Router();
const Service = require('../models/Service');
const auth = require('../middleware/auth');
const roles = require('../middleware/roles');

// PUBLIC ROUTES 

// Get all active services
router.get('/', async (req, res) => {
  try {
    const services = await Service.find({ active: true }).sort({ name: 1 });
    res.json(services);
  } catch (err) {
    console.error('❌ Error fetching services:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Get single service by ID
router.get('/:id', async (req, res) => {
  try {
    const service = await Service.findById(req.params.id);
    if (!service) {
      return res.status(404).json({ msg: 'Service not found' });
    }
    res.json(service);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

//ADMIN ROUTES

// Create new service
router.post('/', auth, roles(['admin']), async (req, res) => {
  try {
    const { name, description, durationMinutes, price, pricing, allowedDurations } = req.body;
    
    if (!name) {
      return res.status(400).json({ msg: 'Service name is required' });
    }

    // Create service with all fields
    const serviceData = {
      name,
      description,
      durationMinutes,
      price,
      allowedDurations: allowedDurations || [60, 90, 120]
    };

    // Handle pricing Map
    if (pricing) {
      serviceData.pricing = new Map(Object.entries(pricing));
    }

    const service = await Service.create(serviceData);
    
    res.status(201).json({ 
      msg: 'Service created successfully', 
      service 
    });
  } catch (err) {
    console.error('❌ Error creating service:', err);
    
    if (err.code === 11000) {
      return res.status(400).json({ msg: 'Service with this name already exists' });
    }
    
    res.status(500).json({ msg: 'Server error' });
  }
});

// Update service (SINGLE PUT ROUTE - no duplicates!)
router.put('/:id', auth, roles(['admin']), async (req, res) => {
  try {
    const { name, description, durationMinutes, price, pricing, allowedDurations, active } = req.body;
    
    const updateData = {
      name,
      description,
      durationMinutes,
      price,
      allowedDurations,
      active
    };
    
    // Handle pricing Map
    if (pricing) {
      updateData.pricing = new Map(Object.entries(pricing));
    }
    
    const updated = await Service.findByIdAndUpdate(
      req.params.id,
      updateData,
      { 
        new: true, 
        runValidators: true 
      }
    );
    
    if (!updated) {
      return res.status(404).json({ msg: 'Service not found' });
    }
    
    res.json({ 
      msg: 'Service updated successfully', 
      service: updated 
    });
  } catch (err) {
    console.error('❌ Error updating service:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Delete/Deactivate service
router.delete('/:id', auth, roles(['admin']), async (req, res) => {
  try {
    // Option 1: Soft delete (set active: false)
    const service = await Service.findByIdAndUpdate(
      req.params.id, 
      { active: false }, 
      { new: true }
    );
    
    // Option 2: Hard delete (uncomment if you want to permanently delete)
    // const service = await Service.findByIdAndDelete(req.params.id);
    
    if (!service) {
      return res.status(404).json({ msg: 'Service not found' });
    }
    
    res.json({ 
      msg: 'Service deactivated successfully', 
      service 
    });
  } catch (err) {
    console.error('❌ Error deleting service:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;