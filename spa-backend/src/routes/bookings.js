// src/routes/bookings.js
const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const Service = require('../models/Service');
const User = require('../models/User');
const auth = require('../middleware/auth');
const roles = require('../middleware/roles');

// ✅ IMPORTANT: Specific routes MUST come before parameterized routes (/:id)

// ✅ Get bookings for logged-in client (NOT USED ANYMORE but keep for compatibility)
router.get('/my-bookings', auth, async (req, res) => {
  try {
    const bookings = await Booking.find({ client: req.user.id })
      .populate('service', 'name price pricing durationMinutes')
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
      .populate('service', 'name price pricing durationMinutes')
      .populate('client', 'name phone email')
      .sort({ date: 1 });
    
    res.json(bookings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ✅ Get all bookings (Admin only)
router.get('/', auth, roles(['admin']), async (req, res) => {
  try {
    const bookings = await Booking.find()
      .populate('service', 'name price pricing durationMinutes')
      .populate('client', 'name email phone')
      .populate('therapist', 'name')
      .sort({ date: -1 });
    
    res.json(bookings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ✅ Create booking (PUBLIC - no authentication required)
router.post('/', async (req, res) => {
  try {
    const {
      service: serviceName,
      minutes,
      therapists: selectedTherapists, // NEW: Array of therapists
      numberOfClients, // NEW
      date,
      time,
      endTime, // NEW
      notes,
      name: guestName,
      phone: guestPhone,
      totalAmount
    } = req.body;

    console.log('📥 Booking request:', { 
      serviceName, 
      minutes, 
      therapists: selectedTherapists,
      numberOfClients,
      guestName, 
      guestPhone 
    });

    // Validate required fields
    if (!guestName || !guestPhone) {
      return res.status(400).json({ msg: 'Name and phone are required' });
    }

    if (!serviceName || !minutes || !date || !time) {
      return res.status(400).json({ msg: 'Please fill all required fields' });
    }

    // Extract duration
    const durationMinutes = parseInt(minutes);
    if (!durationMinutes || ![60, 90, 120].includes(durationMinutes)) {
      return res.status(400).json({ msg: 'Invalid duration' });
    }

    // Find service
    const service = await Service.findOne({ 
      name: { $regex: new RegExp(`^${serviceName.trim()}$`, 'i') },
      active: true 
    });

    if (!service) {
      console.log('❌ Service not found:', serviceName);
      const allServices = await Service.find({ active: true }, 'name');
      return res.status(404).json({ 
        msg: 'Service not found',
        availableServices: allServices.map(s => s.name)
      });
    }

    // Calculate price
    let finalPrice = totalAmount;
    if (service.pricing) {
      const pricingObj = service.pricing.toObject ? service.pricing.toObject() : service.pricing;
      const basePrice = pricingObj[durationMinutes] || pricingObj[durationMinutes.toString()] || totalAmount;
      finalPrice = basePrice * (numberOfClients || 1);
    }

    console.log('💰 Final price:', finalPrice);

    // Create booking data
    const bookingData = {
      service: service._id,
      durationMinutes,
      numberOfClients: numberOfClients || 1,
      date,
      time,
      endTime,
      notes,
      price: finalPrice,
      status: 'pending',
      guestName,
      guestPhone
    };

    // Handle therapist assignments (multiple)
    const therapistIds = [];
    if (selectedTherapists && selectedTherapists.length > 0) {
      for (const therapistData of selectedTherapists) {
        if (therapistData.name && therapistData.name !== 'Any available therapist') {
          const therapist = await User.findOne({ 
            name: { $regex: new RegExp(`^${therapistData.name.trim()}$`, 'i') },
            role: 'therapist' 
          });
          if (therapist) {
            therapistIds.push(therapist._id);
          }
        }
      }
    }

    if (therapistIds.length > 0) {
      bookingData.therapists = therapistIds;
      bookingData.therapist = therapistIds[0]; // First therapist for backward compatibility
      console.log('👥 Therapists assigned:', therapistIds.length);
    }

    const booking = await Booking.create(bookingData);
    await booking.populate('service therapist therapists');

    console.log('✅ Booking created:', booking._id);

    // 🔥 EMIT SOCKET EVENT
    const io = req.app.get('socketio');
    if (io) {
      io.emit('newBooking', {
        message: 'New booking created',
        booking: booking
      });

      // Notify all assigned therapists
      if (therapistIds.length > 0) {
        therapistIds.forEach(therapistId => {
          io.to(therapistId.toString()).emit('newAssignment', {
            message: 'You have a new appointment!',
            booking: booking
          });
        });
      }
    }

    res.status(201).json({ msg: 'Booking created successfully!', booking });
  } catch (err) {
    console.error('❌ Booking error:', err);
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});

// ✅ Update booking status (Admin, Therapist, and Client)
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

    // Only allow authorized users
    if (!isAdmin && !isTherapist) {
      return res.status(403).json({ msg: 'Not authorized to update this booking' });
    }

    // Therapists can only mark as completed
    if (isTherapist && status !== 'completed') {
      return res.status(403).json({ msg: 'Therapists can only mark bookings as completed' });
    }

    const oldStatus = booking.status;
    booking.status = status;
    await booking.save();

    // Populate and return
    await booking.populate('service therapist');

    // 🔥 EMIT SOCKET EVENT - STATUS UPDATE
    const io = req.app.get('socketio');
    if (io) {
      io.emit('bookingStatusUpdated', {
        message: `Booking status changed from ${oldStatus} to ${status}`,
        booking: booking
      });

      // Notify therapist if their appointment status changed
      if (booking.therapist) {
        io.to(booking.therapist._id.toString()).emit('appointmentUpdated', {
          message: `Appointment status updated to ${status}`,
          booking: booking
        });
      }
    }

    res.json({ msg: 'Status updated', booking });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ✅ Admin: Reassign therapist to booking
router.patch('/:id/reassign', auth, roles(['admin']), async (req, res) => {
  try {
    const { therapistId } = req.body;

    const booking = await Booking.findById(req.params.id);
    if (!booking) {
      return res.status(404).json({ msg: 'Booking not found' });
    }

    const oldTherapist = booking.therapist;
    
    if (therapistId) {
      const therapist = await User.findOne({ _id: therapistId, role: 'therapist' });
      if (!therapist) {
        return res.status(404).json({ msg: 'Therapist not found' });
      }
      booking.therapist = therapistId;
    } else {
      booking.therapist = null;
    }

    await booking.save();
    await booking.populate('service therapist');

    // 🔥 EMIT SOCKET EVENT - REASSIGNMENT
    const io = req.app.get('socketio');
    if (io) {
      // Notify old therapist
      if (oldTherapist) {
        io.to(oldTherapist.toString()).emit('appointmentRemoved', {
          message: 'An appointment was reassigned',
          bookingId: booking._id
        });
      }

      // Notify new therapist
      if (booking.therapist) {
        io.to(booking.therapist._id.toString()).emit('newAssignment', {
          message: 'You have been assigned a new appointment!',
          booking: booking
        });
      }

      io.emit('bookingUpdated', { booking });
    }

    res.json({ msg: 'Therapist reassigned', booking });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ✅ Get single booking
router.get('/:id', auth, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('service therapist');
    
    if (!booking) {
      return res.status(404).json({ msg: 'Booking not found' });
    }

    const isAdmin = req.user.role === 'admin';
    const isTherapist = req.user.role === 'therapist' && booking.therapist?.toString() === req.user.id;

    if (!isAdmin && !isTherapist) {
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

    // 🔥 EMIT SOCKET EVENT - BOOKING DELETED
    const io = req.app.get('socketio');
    if (io) {
      io.emit('bookingDeleted', { bookingId: req.params.id });
    }

    res.json({ msg: 'Booking deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;