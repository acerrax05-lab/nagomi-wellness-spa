// src/routes/services.js 
const express = require('express');
const router = express.Router();
const Service = require('../models/Service');
const auth = require('../middleware/auth');
const roles = require('../middleware/roles');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const path   = require('path');
const fs     = require('fs');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});
 
// Use Cloudinary storage instead of disk storage
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:         'nagomi-services',       // images go to this folder in Cloudinary
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [{ width: 800, height: 600, crop: 'fill', quality: 'auto' }],
    public_id: (req, file) => {
      // Use service ID + timestamp as filename so it's unique
      const name = (req.params.id || 'service') + '-' + Date.now();
      return name.replace(/[^a-zA-Z0-9-_]/g, '-');
    },
  },
});
 
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
});

// PUBLIC ROUTES 

//  Get all active services with filtering and sorting
router.get('/', async (req, res) => {
  try {
    const { category, sortBy = 'name' } = req.query;
    
    // Build query - only show active services
    let query = { active: true };
    
    // Filter by category if provided
    if (category && category !== 'all') {
      query.category = category;
    }
    
    // Determine sort option
    let sortOption = {};
    switch(sortBy) {
      case 'popular':
        sortOption = { bookingCount: -1 }; // Most booked first
        break;
      case 'rating':
        sortOption = { averageRating: -1 }; // Highest rated first
        break;
      case 'price-low':
        sortOption = { price: 1 }; // Lowest price first
        break;
      case 'price-high':
        sortOption = { price: -1 }; // Highest price first
        break;
      case 'alphabetical':
      case 'name':
      default:
        sortOption = { name: 1 }; // A-Z
    }
    
    const services = await Service.find(query).sort(sortOption);
    res.json(services);
  } catch (err) {
    console.error('❌ Error fetching services:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

//  Get all categories (for filter dropdown)
router.get('/categories/list', async (req, res) => {
  try {
    const categories = await Service.distinct('category', { active: true });
    res.json(categories);
  } catch (err) {
    console.error('❌ Error fetching categories:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Get all services including hidden (Admin only)
router.get('/admin/all', auth, roles(['admin']), async (req, res) => {
  try {
    const services = await Service.find().sort({ name: 1 });
    res.json(services);
  } catch (err) {
    console.error('❌ Error fetching all services:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ── POST /api/services/:id/image — upload or replace ────────────────────────
router.post('/:id/image', auth, roles(['admin']), upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ msg: 'No image file provided' });
    }
 
    // Cloudinary returns the permanent URL in req.file.path
    const imageUrl = req.file.path;
 
    const service = await Service.findByIdAndUpdate(
      req.params.id,
      { image: imageUrl },
      { new: true }
    );
 
    if (!service) {
      return res.status(404).json({ msg: 'Service not found' });
    }
 
    console.log(`✅ Image uploaded to Cloudinary: ${imageUrl}`);
 
    res.json({
      msg:   'Image uploaded successfully',
      image: imageUrl,
      service,
    });
 
  } catch (err) {
    console.error('❌ Image upload error:', err);
    res.status(500).json({ msg: 'Upload failed', error: err.message });
  }
});

// ── DELETE /api/services/:id/image — remove image ────────────────────────────
router.delete('/:id/image', auth, roles(['admin']), async (req, res) => {
  try {
    const service = await Service.findById(req.params.id);
    if (!service) return res.status(404).json({ msg: 'Service not found' });
 
    // Delete from Cloudinary if it's a Cloudinary URL
    if (service.image && service.image.includes('cloudinary.com')) {
      try {
        // Extract public_id from URL
        const parts   = service.image.split('/');
        const file    = parts[parts.length - 1].split('.')[0];
        const folder  = parts[parts.length - 2];
        const publicId = `${folder}/${file}`;
        await cloudinary.uploader.destroy(publicId);
        console.log(`🗑️  Deleted from Cloudinary: ${publicId}`);
      } catch (cloudErr) {
        console.warn('⚠️ Could not delete from Cloudinary:', cloudErr.message);
      }
    }
 
    service.image = null;
    await service.save();
 
    res.json({ msg: 'Image removed', service });
 
  } catch (err) {
    console.error('❌ Image remove error:', err);
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
    const { 
      name, 
      description, 
      durationMinutes, 
      price, 
      pricing, 
      allowedDurations,
      category 
    } = req.body;
    
    if (!name) {
      return res.status(400).json({ msg: 'Service name is required' });
    }

    // Create service with all fields
    const serviceData = {
      name,
      description,
      durationMinutes,
      price,
      allowedDurations: allowedDurations || [60, 90, 120],
      category: category || 'Massage' //  Default category
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

// Update service
router.put('/:id', auth, roles(['admin']), async (req, res) => {
  try {
    const { 
      name, 
      description, 
      durationMinutes, 
      price, 
      pricing, 
      allowedDurations, 
      active,
      category 
    } = req.body;
    
    const updateData = {
      name,
      description,
      durationMinutes,
      price,
      allowedDurations,
      active,
      category 
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

//  Toggle service visibility (hide/show instead of delete)
router.patch('/:id/toggle', auth, roles(['admin']), async (req, res) => {
  try {
    const service = await Service.findById(req.params.id);
    
    if (!service) {
      return res.status(404).json({ msg: 'Service not found' });
    }
    
    service.active = !service.active;
    await service.save();
    
    res.json({ 
      msg: `Service ${service.active ? 'activated' : 'hidden'}`, 
      service 
    });
  } catch (err) {
    console.error('❌ Error toggling service:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Delete/Deactivate service (keep original for compatibility)
router.delete('/:id', auth, roles(['admin']), async (req, res) => {
  try {
    // Soft delete (set active: false)
    const service = await Service.findByIdAndUpdate(
      req.params.id, 
      { active: false }, 
      { new: true }
    );
    
    if (!service) {
      return res.status(404).json({ msg: 'Service not found' });
    }
    
    res.json({ 
      msg: 'Service hidden successfully', 
      service 
    });
  } catch (err) {
    console.error('❌ Error hiding service:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

router.get('/public', async (req, res) => {
  try {
    const services = await Service.find({ active: true })
      .select('name category description pricing image benefits')
      .sort({ name: 1 });
    res.json(services);
  } catch (err) {
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;