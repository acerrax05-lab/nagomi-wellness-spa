// src/routes/bookings.js - UPDATED with my-appointments route
const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const Service = require('../models/Service');
const User = require('../models/User');
const auth = require('../middleware/auth');
const roles = require('../middleware/roles');
const {
  calculateEndTimes,
  isTherapistWorkingAt,
  hasExpertise,
  isTherapistAvailable,
  getAvailableTherapists
} = require('../utils/availability');

function convertTimeToDate(baseDate, timeString) {
  const [time, period] = timeString.split(' ');
  let [hours, minutes] = time.split(':').map(Number);
  
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  
  const dateObj = new Date(baseDate);
  dateObj.setHours(hours, minutes, 0, 0);
  
  return dateObj;
}

// Get all bookings (Admin only)
router.get('/', auth, roles(['admin']), async (req, res) => {
  try {
    const bookings = await Booking.find()
      .populate('service', 'name price pricing durationMinutes allowedDurations')
      .populate('client', 'name email phone')
      .populate('therapist therapists', 'name email')
      .sort({ date: -1 });
    
    res.json(bookings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ✅ NEW: Get therapist's appointments (MUST BE BEFORE /:id route)
router.get('/my-appointments', auth, async (req, res) => {
  try {
    // Verify user is a therapist
    if (req.user.role !== 'therapist') {
      return res.status(403).json({ msg: 'Access denied. Therapists only.' });
    }

    console.log('📋 Fetching appointments for therapist:', req.user.id);

    const bookings = await Booking.find({ 
      therapist: req.user.id,
      status: { $ne: 'cancelled' }
    })
      .populate('client', 'name email phone')
      .populate('service', 'name price durationMinutes')
      .sort({ date: 1, time: 1 });

    console.log(`✅ Found ${bookings.length} appointments`);

    res.json(bookings);
  } catch (error) {
    console.error('❌ Error fetching therapist appointments:', error);
    res.status(500).json({ msg: 'Server error', error: error.message });
  }
});

// Check availability
router.post('/check-availability', async (req, res) => {
  try {
    const { service, date, time, durationMinutes } = req.body;
    
    console.log('📥 Availability check request:', { service, date, time, durationMinutes });
    
    if (!service || !date || !time || !durationMinutes) {
      console.log('❌ Missing required fields');
      return res.status(400).json({ msg: 'Missing required fields' });
    }
    
    const bookingDate = new Date(date);
    
    let availableTherapists;
    try {
      availableTherapists = await getAvailableTherapists(
        service,
        bookingDate,
        time,
        parseInt(durationMinutes)
      );
    } catch (availErr) {
      console.error('❌ Error in getAvailableTherapists:', availErr);
      return res.status(500).json({ 
        msg: 'Error checking availability', 
        error: availErr.message 
      });
    }
    
    console.log(`✅ Found ${availableTherapists.length} available therapists`);
    
    res.json({
      available: availableTherapists.map(t => ({
        id: t._id,
        name: t.name,
        email: t.email,
        expertise: t.expertise
      })),
      totalAvailable: availableTherapists.length
    });
  } catch (err) {
    console.error('❌ Availability check error:', err);
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});

// Get booked dates
router.get('/booked-dates', async (req, res) => {
  try {
    const { year, month } = req.query;
    
    const startDate = new Date(year, month, 1);
    const endDate = new Date(year, parseInt(month) + 1, 0, 23, 59, 59);
    
    const bookings = await Booking.find({
      date: {
        $gte: startDate,
        $lte: endDate
      },
      status: { $ne: 'cancelled' }
    }).select('date');
    
    const bookedDates = [...new Set(bookings.map(b => 
      b.date.toISOString().split('T')[0]
    ))];
    
    res.json({ bookedDates });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ✅ UPDATED: Create booking - NO AUTO-ASSIGNMENT if "Any Available"
router.post('/', async (req, res) => {
  try {
    const {
      service: serviceName,
      minutes,
      therapists: selectedTherapists,
      numberOfClients, 
      date,
      time,
      endTime, 
      notes,
      name: guestName,
      phone: guestPhone,
      totalAmount,
      paymentMethod,
      termsAccepted
    } = req.body;

    console.log('📥 Booking request:', { 
      serviceName, 
      minutes, 
      therapists: selectedTherapists,
      numberOfClients,
      date,
      time,
      paymentMethod,
      termsAccepted
    });

    // ✅ Validate terms acceptance
    if (!termsAccepted) {
      return res.status(400).json({ msg: 'You must accept the terms and conditions to proceed' });
    }

    // ✅ Validate payment method
    if (!paymentMethod || !['COD', 'PayPal', 'GCash', 'Credit Card'].includes(paymentMethod)) {
      return res.status(400).json({ msg: 'Please select a valid payment method' });
    }

    // Validate required fields
    if (!guestName || !guestPhone) {
      return res.status(400).json({ msg: 'Name and phone are required' });
    }

    if (!serviceName || !minutes || !date || !time) {
      return res.status(400).json({ msg: 'Please fill all required fields' });
    }

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
      return res.status(404).json({ msg: 'Service not found' });
    }

    // Check duration restrictions
    if (service.allowedDurations && service.allowedDurations.length > 0) {
      if (!service.allowedDurations.includes(durationMinutes)) {
        return res.status(400).json({ 
          msg: `${serviceName} is not available for ${durationMinutes} minutes` 
        });
      }
    }

    const bookingDate = new Date(date);
    
    const { endTime: calculatedEndTime, availableAfter: availableAfterTime, gracePeriodUsed } = await calculateEndTimes(time, durationMinutes);

    const endTimeDate = convertTimeToDate(bookingDate, endTime || calculatedEndTime);
    const availableAfterDate = convertTimeToDate(bookingDate, availableAfterTime);

    // Calculate price
    let finalPrice = totalAmount;
    if (service.pricing) {
      const pricingObj = service.pricing.toObject ? service.pricing.toObject() : service.pricing;
      const basePrice = pricingObj[durationMinutes] || pricingObj[durationMinutes.toString()] || totalAmount;
      finalPrice = basePrice * (numberOfClients || 1);
    }

    console.log('💰 Final price:', finalPrice);

    // ✅ CHANGED: Handle therapist assignments - NO AUTO-ASSIGNMENT
    const therapistIds = [];
    const requestedTherapists = selectedTherapists && selectedTherapists.length > 0 
      ? selectedTherapists 
      : [];

    // ✅ If "Any available therapist" - DON'T assign yet, let admin do it
    if (requestedTherapists.length === 0 || 
        requestedTherapists.some(t => t.name === 'Any available therapist')) {
      
      console.log('⏳ Client selected "Any Available Therapist" - waiting for admin assignment');
      // Don't assign any therapist - leave empty for admin to assign later
      
    } else {
      // Specific therapists requested - validate each one
      for (const therapistData of requestedTherapists) {
        if (therapistData.name && therapistData.name !== 'Any available therapist') {
          const therapist = await User.findOne({ 
            name: { $regex: new RegExp(`^${therapistData.name.trim()}$`, 'i') },
            role: 'therapist',
            isActive: true
          });

          if (!therapist) {
            return res.status(400).json({ 
              msg: `Therapist "${therapistData.name}" not found or inactive` 
            });
          }

          // Validate expertise
          if (!hasExpertise(therapist, serviceName)) {
            return res.status(400).json({ 
              msg: `${therapist.name} is not qualified to perform ${serviceName}` 
            });
          }

          // Validate schedule
          if (!isTherapistWorkingAt(therapist, bookingDate, time)) {
            return res.status(400).json({ 
              msg: `${therapist.name} is not scheduled to work at ${time}` 
            });
          }

          // Check availability
          const isAvailable = await isTherapistAvailable(
            therapist._id,
            bookingDate,
            time,
            durationMinutes
          );

          if (!isAvailable) {
            return res.status(400).json({ 
              msg: `${therapist.name} is already booked at ${time}` 
            });
          }

          therapistIds.push(therapist._id);
        }
      }
    }

    // Create booking data
    const bookingData = {
      service: service._id,
      durationMinutes,
      numberOfClients: numberOfClients || 1,
      date: bookingDate,
      time,
      endTime: endTimeDate, 
      availableAfter: availableAfterDate,
      notes,
      price: finalPrice,
      status: 'pending',
      guestName,
      guestPhone,
      paymentMethod,
      therapists: therapistIds.length > 0 ? therapistIds : [],
      therapist: therapistIds.length > 0 ? therapistIds[0] : null
    };

    const booking = await Booking.create(bookingData);
    await booking.populate('service therapist therapists');

    console.log('✅ Booking created:', booking._id);
    console.log(`📋 Therapists assigned: ${therapistIds.length > 0 ? therapistIds.length : 'None (pending admin assignment)'}`);

    // EMIT SOCKET EVENT
    const io = req.app.get('socketio');
    if (io) {
      io.emit('newBooking', {
        message: 'New booking created',
        booking: booking
      });

      // Only notify if therapists were assigned
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

// Update booking status
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

    const isAdmin = req.user.role === 'admin';
    const isTherapist = req.user.role === 'therapist' && booking.therapist?.toString() === req.user.id;

    if (!isAdmin && !isTherapist) {
      return res.status(403).json({ msg: 'Not authorized' });
    }

    if (isTherapist && status !== 'completed') {
      return res.status(403).json({ msg: 'Therapists can only mark as completed' });
    }

    const oldStatus = booking.status;
    booking.status = status;
    await booking.save();

    await booking.populate('service therapist');

    const io = req.app.get('socketio');
    if (io) {
      io.emit('bookingStatusUpdated', {
        message: `Booking status changed from ${oldStatus} to ${status}`,
        booking: booking
      });

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

// Admin: Reassign therapist to booking
router.patch('/:id/reassign', auth, roles(['admin']), async (req, res) => {
  try {
    const { therapistId } = req.body;

    const booking = await Booking.findById(req.params.id).populate('service');
    if (!booking) {
      return res.status(404).json({ msg: 'Booking not found' });
    }

    const oldTherapist = booking.therapist;
    
    if (therapistId) {
      const therapist = await User.findOne({ _id: therapistId, role: 'therapist', isActive: true });
      if (!therapist) {
        return res.status(404).json({ msg: 'Therapist not found or inactive' });
      }

      if (!hasExpertise(therapist, booking.service.name)) {
        return res.status(400).json({ 
          msg: `${therapist.name} is not qualified for ${booking.service.name}` 
        });
      }

      const bookingDate = new Date(booking.date);
      if (!isTherapistWorkingAt(therapist, bookingDate, booking.time)) {
        return res.status(400).json({ 
          msg: `${therapist.name} is not working at ${booking.time}` 
        });
      }

      const isAvailable = await isTherapistAvailable(
        therapist._id,
        bookingDate,
        booking.time,
        booking.durationMinutes
      );

      if (!isAvailable) {
        return res.status(400).json({ 
          msg: `${therapist.name} is already booked at this time` 
        });
      }

      booking.therapist = therapistId;
      booking.therapists = [therapistId];
    } else {
      booking.therapist = null;
      booking.therapists = [];
    }

    await booking.save();
    await booking.populate('service therapist');

    const io = req.app.get('socketio');
    if (io) {
      if (oldTherapist) {
        io.to(oldTherapist.toString()).emit('appointmentRemoved', {
          message: 'An appointment was reassigned',
          bookingId: booking._id
        });
      }

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

// ⚠️ IMPORTANT: All /:id routes MUST come AFTER specific routes
// Get single booking
router.get('/:id', auth, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('service therapist therapists');
    
    if (!booking) {
      return res.status(404).json({ msg: 'Booking not found' });
    }

    const isAdmin = req.user.role === 'admin';
    const isTherapist = req.user.role === 'therapist' && booking.therapist?.toString() === req.user.id;

    if (!isAdmin && !isTherapist) {
      return res.status(403).json({ msg: 'Not authorized' });
    }

    res.json(booking);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Delete booking
router.delete('/:id', auth, roles(['admin']), async (req, res) => {
  try {
    const booking = await Booking.findByIdAndDelete(req.params.id);
    
    if (!booking) {
      return res.status(404).json({ msg: 'Booking not found' });
    }

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