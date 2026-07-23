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

// ── Validate Cloudinary env vars on startup ──────────────────────────────────
const CLOUDINARY_CONFIGURED = !!(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY    &&
  process.env.CLOUDINARY_API_SECRET
);

if (!CLOUDINARY_CONFIGURED) {
  console.error('❌ CLOUDINARY env vars missing! Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET in Render > Environment.');
} else {
  console.log('✅ Cloudinary configured for image uploads');
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key:    process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

// Build multer/Cloudinary storage only if env vars are present
let upload = null;

if (CLOUDINARY_CONFIGURED) {
  const storage = new CloudinaryStorage({
    cloudinary,
    params: {
      folder:          'nagomi-services',
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
      transformation:  [{ width: 800, height: 600, crop: 'fill', quality: 'auto' }],
      public_id: (req) => {
        const name = (req.params.id || 'service') + '-' + Date.now();
        return name.replace(/[^a-zA-Z0-9-_]/g, '-');
      },
    },
  });

  upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
  });
}

// Returns a clear 503 when Cloudinary env vars aren't configured
function requireCloudinary(req, res, next) {
  if (!CLOUDINARY_CONFIGURED || !upload) {
    return res.status(503).json({
      msg: 'Image uploads unavailable — Cloudinary is not configured on the server.',
      fix: 'Add CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET to Render > Environment tab, then redeploy.',
    });
  }
  next();
}

// PUBLIC ROUTES 

//  Get all active services with filtering and sorting
router.get('/', async (req, res) => {
  try {
    const { category, sortBy = 'name' } = req.query;
 
    let query = { active: true };
    if (category && category !== 'all') {
      query.category = { $regex: new RegExp(category, 'i') };
    }
 
    let sortOption = {};
    switch (sortBy) {
      case 'popular':    sortOption = { bookingCount: -1 };  break;
      case 'rating':     sortOption = { averageRating: -1 }; break;
      case 'price-low':  sortOption = { price: 1 };          break;
      case 'price-high': sortOption = { price: -1 };         break;
      default:           sortOption = { name: 1 };
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
// Uses requireCloudinary middleware to return a clear error if env vars are missing,
// then dynamically applies upload.single('image') so it never crashes on init.
router.post('/:id/image', auth, roles(['admin']), requireCloudinary, (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      console.error('❌ Multer/Cloudinary error:', err.message);
      return res.status(500).json({ msg: 'Upload failed', error: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ msg: 'No image file provided. Make sure you are sending a multipart/form-data request with an "image" field.' });
    }

    // req.file.path is the permanent Cloudinary HTTPS URL
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
    res.json({ msg: 'Image uploaded successfully', image: imageUrl, service });

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
        const parts    = service.image.split('/');
        const file     = parts[parts.length - 1].split('.')[0];
        const folder   = parts[parts.length - 2];
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
    if (!service) return res.status(404).json({ msg: 'Service not found' });
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
    const { name, description, durationMinutes, price, pricing, allowedDurations, category } = req.body;
 
    if (!name) return res.status(400).json({ msg: 'Service name is required' });
 
    const serviceData = {
      name,
      description,
      durationMinutes,
      price,
      allowedDurations: allowedDurations || [60, 90, 120],
      category: category || 'Massage Services',
    };
 
    if (pricing) {
      serviceData.pricing = new Map(Object.entries(pricing));
    }
 
    const service = await Service.create(serviceData);
    const io = req.app.get('socketio');
    if (io) io.emit('serviceUpdated', { action: 'created', service });
    res.status(201).json({ msg: 'Service created successfully', service });
 
  } catch (err) {
    console.error('❌ Error creating service:', err);
    if (err.code === 11000) {
      return res.status(400).json({ msg: 'Service with this name already exists' });
    }
    res.status(500).json({ msg: 'Server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const service = await Service.findById(req.params.id);
    if (!service) return res.status(404).json({ msg: 'Service not found' });
    res.json(service);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});
 
// Update service
router.put('/:id', auth, roles(['admin']), async (req, res) => {
  try {
    const { name, description, durationMinutes, price, pricing, allowedDurations, active, category } = req.body;
 
    const updateData = { name, description, durationMinutes, price, allowedDurations, active, category };
 
    if (pricing) {
      updateData.pricing = new Map(Object.entries(pricing));
    }
 
    const updated = await Service.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );
 
    if (!updated) return res.status(404).json({ msg: 'Service not found' });
 
    const io = req.app.get('socketio');
    if (io) io.emit('serviceUpdated', { action: 'updated', service: updated });
    res.json({ msg: 'Service updated successfully', service: updated });
 
  } catch (err) {
    console.error('❌ Error updating service:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

//  Toggle service visibility (hide/show instead of delete)
router.patch('/:id/toggle', auth, roles(['admin']), async (req, res) => {
  try {
    const service = await Service.findById(req.params.id);
    if (!service) return res.status(404).json({ msg: 'Service not found' });
 
    service.active = !service.active;
    await service.save();
 
    const io = req.app.get('socketio');
    if (io) io.emit('serviceUpdated', { action: 'toggled', service });
    res.json({ msg: `Service ${service.active ? 'activated' : 'hidden'}`, service });
 
  } catch (err) {
    console.error('❌ Error toggling service:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});
 
// DELETE /api/services/:id — soft delete (set active: false)
router.delete('/:id', auth, roles(['admin']), async (req, res) => {
  try {
    const service = await Service.findByIdAndUpdate(
      req.params.id,
      { active: false },
      { new: true }
    );
 
    if (!service) return res.status(404).json({ msg: 'Service not found' });
 
    const io = req.app.get('socketio');
    if (io) io.emit('serviceUpdated', { action: 'deleted', serviceId: req.params.id });
    res.json({ msg: 'Service hidden successfully', service });
 
  } catch (err) {
    console.error('❌ Error hiding service:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;