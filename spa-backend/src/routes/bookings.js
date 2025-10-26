// src/routes/bookings.js
const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const Service = require('../models/Service');
const User = require('../models/User');
const auth = require('../middleware/auth');
const roles = require('../middleware/roles');

// ✅ IMPORTANT: Specific routes MUST come before parameterized routes (/:id)

// ✅ Get bookings for logged-in client
router.get('/my-bookings', auth, async (req, res) => {
  try {
    const bookings = await Booking.find({ client: req.user.id })
      .populate('service', 'name price durationMinutes')
      .populate('therapist', 'name')
      .sort({ date: -1 });
    
    res.json(bookings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ✅ Get bookings assigned to the logged-in therapist
router.get('/my-appointments', auth, roles(['therapist']), async (req, res) => {
  try {
    const bookings = await Booking.find({ therapist: req.user.id })
      .populate('service', 'name price durationMinutes')
      .populate('client', 'name phone email')
      .sort({ date: 1 });
    
    res.json(bookings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ✅ Get all bookings (Admin only) - WITH POPULATION
router.get('/', auth, roles(['admin']), async (req, res) => {
  try {
    const bookings = await Booking.find()
      .populate('service', 'name price durationMinutes')
      .populate('client', 'name email phone')
      .populate('therapist', 'name')
      .sort({ date: -1 });
    
    res.json(bookings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ✅ Create booking (Public or authenticated)
router.post('/', async (req, res) => {
  try {
    const {
      serviceId,
      therapistId,
      date,
      time,
      notes,
      guestName,
      guestPhone
    } = req.body;

    // Validate service exists
    const service = await Service.findById(serviceId);
    if (!service) {
      return res.status(404).json({ msg: 'Service not found' });
    }

    // Create booking data
    const bookingData = {
      service: serviceId,
      date,
      time,
      notes,
      price: service.price,
      status: 'pending'
    };

    // If user is authenticated, use their ID as client
    if (req.user) {
      bookingData.client = req.user.id;
    } else {
      // For walk-in/guest bookings
      if (!guestName || !guestPhone) {
        return res.status(400).json({ msg: 'Guest name and phone required' });
      }
      bookingData.guestName = guestName;
      bookingData.guestPhone = guestPhone;
    }

    // Add therapist if specified
    if (therapistId && therapistId !== 'any') {
      bookingData.therapist = therapistId;
    }

    const booking = await Booking.create(bookingData);
    
    // Populate before sending response
    await booking.populate('service client therapist');

    res.status(201).json({ msg: 'Booking created successfully!', booking });
  } catch (err) {
    console.error('Booking error:', err);
    res.status(500).json({ msg: 'Server error while creating booking.' });
  }
});

// ✅ Update booking status (Admin and Therapist can update)
router.patch('/:id/status', auth, async (req, res) => {
  try {
    const { status } = req.body;
    
    if (!['pending', 'confirmed', 'completed', 'cancelled'].includes(status)) {
      return res.status(400).json({ msg: 'Invalid status' });
    }

    const booking = await Booking.findById(req.params.id);
    
    if (!booking) {
      return res.status(404).json({ msg: 'Booking not found' });
    }

    // Authorization check
    const isAdmin = req.user.role === 'admin';
    const isTherapist = req.user.role === 'therapist' && booking.therapist?.toString() === req.user.id;
    const isClient = req.user.role === 'client' && booking.client?.toString() === req.user.id;

    // Only allow authorized users
    if (!isAdmin && !isTherapist && !isClient) {
      return res.status(403).json({ msg: 'Not authorized to update this booking' });
    }

    // Clients can only cancel their own bookings
    if (isClient && status !== 'cancelled') {
      return res.status(403).json({ msg: 'Clients can only cancel bookings' });
    }

    // Therapists can only mark as completed
    if (isTherapist && status !== 'completed') {
      return res.status(403).json({ msg: 'Therapists can only mark bookings as completed' });
    }

    booking.status = status;
    await booking.save();

    // Populate and return
    await booking.populate('service client therapist');

    res.json({ msg: 'Status updated', booking });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ✅ Get single booking
router.get('/:id', auth, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('service client therapist');
    
    if (!booking) {
      return res.status(404).json({ msg: 'Booking not found' });
    }

    // Authorization check
    const isAdmin = req.user.role === 'admin';
    const isTherapist = req.user.role === 'therapist' && booking.therapist?.toString() === req.user.id;
    const isClient = booking.client?.toString() === req.user.id;

    if (!isAdmin && !isTherapist && !isClient) {
      return res.status(403).json({ msg: 'Not authorized to view this booking' });
    }

    res.json(booking);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ✅ Delete booking (Admin only)
router.delete('/:id', auth, roles(['admin']), async (req, res) => {
  try {
    const booking = await Booking.findByIdAndDelete(req.params.id);
    
    if (!booking) {
      return res.status(404).json({ msg: 'Booking not found' });
    }

    res.json({ msg: 'Booking deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;