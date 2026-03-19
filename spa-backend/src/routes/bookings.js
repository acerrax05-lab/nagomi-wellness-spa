// src/routes/bookings.js - 
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
    const Review = require('../models/Review');

    function convertTimeToDate(baseDate, timeString) {
      const [time, period] = timeString.split(' ');
      let [hours, minutes] = time.split(':').map(Number);
      
      if (period === 'PM' && hours !== 12) hours += 12;
      if (period === 'AM' && hours === 12) hours = 0;
      
      const dateObj = new Date(baseDate);
      dateObj.setHours(hours, minutes, 0, 0);
      
      return dateObj;
    }

    router.get('/most-booked', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 3;
        const period = req.query.period || 'all'; // 'all', 'month', 'week'

        let dateFilter = {};

        if (period === 'month') {
          const startOfMonth = new Date();
          startOfMonth.setDate(1);
          startOfMonth.setHours(0, 0, 0, 0);
          dateFilter = { createdAt: { $gte: startOfMonth } };
        } else if (period === 'week') {
          const startOfWeek = new Date();
          startOfWeek.setDate(startOfWeek.getDate() - 7);
          dateFilter = { createdAt: { $gte: startOfWeek } };
        }

        const mostBooked = await Booking.aggregate([
          {
            $match: {
              status: { $in: ['confirmed', 'completed'] },
              ...dateFilter
            }
          },
          {
            $group: {
              _id: '$service',
              count: { $sum: 1 }
            }
          },
          {
            $lookup: {
              from: 'services',
              localField: '_id',
              foreignField: '_id',
              as: 'service'
            }
          },
          {
            $unwind: '$service'
          },
          {
            $sort: { count: -1 }
          },
          {
            $limit: limit
          },
          {
            $project: {
              _id: 1,
              count: 1,
              service: {
                _id: 1,
                name: 1,
                category: 1,
                image: 1
              }
            }
          }
        ]);

        res.json(mostBooked);

      } catch (err) {
        console.error('Error fetching most booked:', err);
        res.status(500).json({ 
          error: 'Failed to fetch most booked services',
          message: err.message 
        });
      }
    });

    router.get('/trending', async (req, res) => {
      try {
        const daysAgo = parseInt(req.query.days) || 7;
        const limit = parseInt(req.query.limit) || 3;

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - daysAgo);

        const trending = await Booking.aggregate([
          {
            $match: {
              createdAt: { $gte: startDate },
              status: { $in: ['confirmed', 'completed', 'pending'] }
            }
          },
          {
            $group: {
              _id: '$service',
              recentBookings: { $sum: 1 },
              growthRate: {
                $avg: {
                  $cond: [
                    { $gte: ['$createdAt', new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)] },
                    1.5, // Weight recent bookings higher
                    1
                  ]
                }
              }
            }
          },
          {
            $lookup: {
              from: 'services',
              localField: '_id',
              foreignField: '_id',
              as: 'service'
            }
          },
          {
            $unwind: '$service'
          },
          {
            $match: {
              recentBookings: { $gte: 5 } // Minimum threshold for "trending"
            }
          },
          {
            $sort: { growthRate: -1, recentBookings: -1 }
          },
          {
            $limit: limit
          }
        ]);

        res.json(trending);

      } catch (err) {
        console.error('Error fetching trending services:', err);
        res.status(500).json({ 
          error: 'Failed to fetch trending services',
          message: err.message 
        });
      }
    });

    // Get all bookings (Admin only)
    router.get('/', auth, roles(['admin']), async (req, res) => {
      try {
        let bookings = await Booking.find()
          .populate('service', 'name price pricing durationMinutes allowedDurations')
          .populate('client', 'name email phone')
          .populate('therapist therapists', 'name email')
          .sort({ date: -1 });

        // Fix null services by checking serviceName field or price-based lookup
        const services = await Service.find().select('name price pricing');
        
        bookings = bookings.map(b => {
          const booking = b.toObject();
          
          // If service is null but we can infer from price
          if (!booking.service && services.length > 0) {
            // Try to match by price
            const matched = services.find(s => {
              const p = s.pricing?.toObject?.() || s.pricing || {};
              return Object.values(p).includes(booking.price) || 
                    s.price === booking.price;
            });
            if (matched) {
              booking.service = { 
                _id: matched._id, 
                name: matched.name 
              };
            }
          }
          
          return booking;
        });
        
        res.json(bookings);
      } catch (err) {
        console.error(err);
        res.status(500).json({ msg: 'Server error' });
      }
    });

    // Get therapist's appointments (MUST BE BEFORE /:id route)
    router.get('/my-appointments', auth, async (req, res) => {
      try {
        if (req.user.role !== 'therapist') {
          return res.status(403).json({ msg: 'Access denied. Therapists only.' });
        }

        console.log('📋 Fetching appointments for therapist:', req.user.id);

        // ✅ Check BOTH therapist field AND therapists array
        const bookings = await Booking.find({ 
          $or: [
            { therapist: req.user.id },      // Single therapist bookings
            { therapists: req.user.id }      // Multi-therapist bookings
          ],
          status: { $ne: 'cancelled' }
        })
          .populate('client', 'name email phone')
          .populate('service', 'name price durationMinutes')
          .populate('therapist therapists', 'name email')  // ✅ Populate both fields
          .sort({ date: 1, time: 1 });

        console.log(`✅ Found ${bookings.length} appointments for ${req.user.id}`);
        
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
            id: t._id.toString(),
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


    router.get('/date-availability', async (req, res) => {
      try {
        const { date, duration } = req.query;
        if (!date) return res.status(400).json({ msg: 'date is required' });

        const durationMins = parseInt(duration) || 60;

        // ── Block admin-set closures (holidays + vacation ranges) ─────────────────
try {
  const Settings = require('../models/Settings');
  const closureSetting = await Settings.findOne({ key: 'closures' });
  const closures = closureSetting?.value || [];

  const checkDate = new Date(date + 'T00:00:00');

  const matched = closures.find(c => {
    const start = new Date(c.start + 'T00:00:00');
    const end   = new Date(c.end   + 'T00:00:00');
    return checkDate >= start && checkDate <= end;
  });

  if (matched) {
    const isSingleDay = matched.start === matched.end;
    return res.json({
      fullyBooked:    true,
      blockedByAdmin: true,
      blockReason:    isSingleDay ? 'holiday' : 'vacation',
      blockLabel:     matched.label || (isSingleDay ? 'Store Holiday' : 'Store Closed'),
      busySlots:      [],
      slotAvailability: {},
      availableCount: 0,
      totalTherapists: 0,
      date,
    });
  }
} catch (blockErr) {
  console.error('Error checking closures:', blockErr);
  // Non-fatal — continue with normal availability check
}

        // ── 1. Get all active therapists ─────────────────────────────────────
        const therapists = await User.find({ role: 'therapist', isActive: true }, '_id name');
        const totalTherapists = therapists.length;

        // ── 2. Get all non-cancelled bookings on this date ───────────────────
        const dayStart = new Date(date + 'T00:00:00+08:00');
        const dayEnd   = new Date(date + 'T23:59:59+08:00');

        const dayBookings = await Booking.find({
          date:   { $gte: dayStart, $lte: dayEnd },
          status: { $nin: ['cancelled'] },
        }).select('therapists time durationMinutes availableAfter');

        // ── 3. Build a set of time slots (in 30-min increments) ──────────────
        //    For each slot, count how many therapists are available
        const allTimes = [
          '9:30 AM','10:00 AM','10:30 AM','11:00 AM','11:30 AM',
          '12:00 PM','12:30 PM','1:00 PM','1:30 PM','2:00 PM',
          '2:30 PM','3:00 PM','3:30 PM','4:00 PM','4:30 PM',
          '5:00 PM','5:30 PM','6:00 PM','6:30 PM','7:00 PM',
          '7:30 PM','8:00 PM','8:30 PM','9:00 PM','9:30 PM',
        ];

        function parseTimeMins(t) {
          const [tp, per] = t.split(' ');
          let [h, m] = tp.split(':').map(Number);
          if (per === 'PM' && h !== 12) h += 12;
          if (per === 'AM' && h === 12) h = 0;
          return h * 60 + m;
        }

        // Build a map: therapistId → array of [startMins, endMins] busy windows
        const therapistBusy = {};
        therapists.forEach(t => { therapistBusy[t._id.toString()] = []; });

        dayBookings.forEach(b => {
  const startM = parseTimeMins(b.time);
  const endM   = startM + b.durationMinutes + 15;
  const assignedIds = (b.therapists || []).map(t => t.toString()).filter(Boolean);

  if (assignedIds.length > 0) {
    // Block only the assigned therapists
    assignedIds.forEach(id => {
      if (!therapistBusy[id]) therapistBusy[id] = [];
      therapistBusy[id].push([startM, endM]);
    });
  } else {
    // Unassigned booking — conservatively block ALL therapists for this slot
    therapists.forEach(t => {
      therapistBusy[t._id.toString()].push([startM, endM]);
    });
  }
});

        // For each time slot, count available therapists
        const CLOSING = 23 * 60;
        const slotAvailability = {};
        let hasAnyAvailableSlot = false;
        const busySlots = [];

        allTimes.forEach(t => {
          const sm = parseTimeMins(t);
          if (sm + durationMins > CLOSING) return; // too late for this duration

          let availCount = 0;
          therapists.forEach(therapist => {
            const busy = therapistBusy[therapist._id.toString()] || [];
            const isBusy = busy.some(([s, e]) => sm < e && sm + durationMins > s);
            if (!isBusy) availCount++;
          });

          slotAvailability[t] = availCount;
          if (availCount > 0) hasAnyAvailableSlot = true;
          if (availCount === 0) busySlots.push(t);
        });

        // Min available therapists across all valid slots
        const minAvailable = Object.values(slotAvailability).length > 0
          ? Math.min(...Object.values(slotAvailability))
          : 0;

        return res.json({
          fullyBooked:      !hasAnyAvailableSlot,
          busySlots,
          slotAvailability,   // { "9:30 AM": 5, "10:00 AM": 3, ... }
          availableCount:   hasAnyAvailableSlot
            ? Math.max(...Object.values(slotAvailability))
            : 0,
          totalTherapists,
          date,
        });

      } catch (err) {
        console.error('Date availability error:', err);
        res.status(500).json({ msg: 'Server error checking date availability' });
      }
    });
    //  Create booking - NO AUTO-ASSIGNMENT if "Any Available"
    //  Create booking with Walk-in/Online detection
    router.post('/', async (req, res) => {
      try {
        const {
          service: serviceName,
          minutes,
          therapists: selectedTherapists,
          numberOfClients,
          femaleClients,
          maleClients,
          date,
          time,
          endTime,
          notes,
          name: guestName,
          phone: guestPhone,
          totalAmount,
          paymentMethod,
          termsAccepted,
          bookingType
        } = req.body;

        console.log('📥 Booking request:', {
          serviceName,
          minutes,
          therapists: selectedTherapists,
          numberOfClients,
          date,
          time,
          paymentMethod,
          bookingType,
          termsAccepted
        });

        // ── Validate booking type ──────────────────────────────────
        if (!bookingType || !['online', 'walk-in'].includes(bookingType)) {
          return res.status(400).json({ msg: 'Invalid booking type. Must be "online" or "walk-in"' });
        }

        if (bookingType === 'online' && !termsAccepted) {
          return res.status(400).json({ msg: 'You must accept the terms and conditions to proceed' });
        }

        if (bookingType === 'walk-in') {
          console.log('💼 Processing walk-in booking — payment collected at spa');
        }

        // ── Validate required fields ───────────────────────────────
        if (!guestName || !guestPhone) {
          return res.status(400).json({ msg: 'Name and phone are required' });
        }

        if (!serviceName || !minutes || !date || !time) {
          return res.status(400).json({ msg: 'Please fill all required fields' });
        }

        // ── FIX 1: Allow 30-minute durations ──────────────────────
        const durationMinutes = parseInt(minutes);
        if (!durationMinutes || ![30, 60, 90, 120].includes(durationMinutes)) {
          return res.status(400).json({ msg: 'Invalid duration. Must be 30, 60, 90, or 120 minutes.' });
        }

        // ── FIX 2: Service lookup with partial-match fallback ──────
        // Try exact match first (case-insensitive)
        let service = await Service.findOne({
          name: { $regex: new RegExp(`^${serviceName.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
          active: true
        });

        // Fallback: match first 3 meaningful words of the name
        if (!service) {
          const words = serviceName.trim().split(/\s+/).slice(0, 3).join(' ');
          service = await Service.findOne({
            name: { $regex: new RegExp(words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
            active: true
          });
          if (service) {
            console.log(`⚠️  Exact match failed for "${serviceName}", using partial match: "${service.name}"`);
          }
        }

        if (!service) {
          console.error(`❌ Service not found: "${serviceName}"`);
          return res.status(404).json({
            msg: `Service "${serviceName}" not found. Run: node bulkCreateServices.js to seed services.`
          });
        }

        // ── Check allowed durations for this service ───────────────
        if (service.allowedDurations && service.allowedDurations.length > 0) {
          if (!service.allowedDurations.includes(durationMinutes)) {
            return res.status(400).json({
              msg: `${serviceName} is not available for ${durationMinutes} minutes`
            });
          }
        }

        const bookingDate = new Date(date);

        const {
          endTime: calculatedEndTime,
          availableAfter: availableAfterTime,
          gracePeriodUsed
        } = await calculateEndTimes(time, durationMinutes);

        const endTimeDate        = convertTimeToDate(bookingDate, endTime || calculatedEndTime);
        const availableAfterDate = convertTimeToDate(bookingDate, availableAfterTime);

        // ── Calculate total clients (needed for price) ─────────────
        const totalClients = (femaleClients || 0) + (maleClients || 0) || numberOfClients || 1;

        // ── Calculate price ────────────────────────────────────────
        let finalPrice = totalAmount;
        if (service.pricing) {
          const pricingObj = service.pricing.toObject
            ? service.pricing.toObject()
            : service.pricing;
          const basePrice =
            pricingObj[durationMinutes] ||
            pricingObj[durationMinutes.toString()] ||
            service.price ||
            totalAmount;
          finalPrice = basePrice * (totalClients || numberOfClients || 1);
        }

        console.log('💰 Final price:', finalPrice);

        // ── Therapist assignments ──────────────────────────────────
        const therapistIds       = [];
        const requestedTherapists = selectedTherapists && selectedTherapists.length > 0
          ? selectedTherapists
          : [];

        const wantsAny = requestedTherapists.length === 0 ||
          requestedTherapists.some(t => t.name === 'Any available therapist');

        if (wantsAny) {
          console.log('⏳ Client chose "Any available therapist" — pending admin assignment');
        } else {
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

              if (!hasExpertise(therapist, serviceName)) {
                return res.status(400).json({
                  msg: `${therapist.name} is not qualified to perform ${serviceName}`
                });
              }

              if (!isTherapistWorkingAt(therapist, bookingDate, time)) {
                return res.status(400).json({
                  msg: `${therapist.name} is not scheduled to work at ${time}`
                });
              }

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

        // ── Set payment method ─────────────────────────────────────
        const finalPaymentMethod = bookingType === 'walk-in'
          ? 'Cash on Arrival'
          : (paymentMethod || 'Not specified');

        // ── Create booking ─────────────────────────────────────────
        const bookingData = {
          service:         service._id,
          durationMinutes,
          numberOfClients: totalClients,
          femaleClients:   femaleClients || 0,
          maleClients:     maleClients   || 0,
          date:            bookingDate,
          time,
          endTime:         endTimeDate,
          availableAfter:  availableAfterDate,
          notes,
          price:           finalPrice,
          status:          'pending',
          guestName,
          guestPhone,
          bookingType,
          paymentMethod:   finalPaymentMethod,
          therapists:      therapistIds.length > 0 ? therapistIds : [],
          therapist:       therapistIds.length > 0 ? therapistIds[0] : null
        };

        const booking = await Booking.create(bookingData);
        await booking.populate('service therapist therapists');

        // Increment booking count on the service
        try {
          await service.incrementBookingCount();
          console.log(`📊 Updated booking count for ${service.name}: ${service.bookingCount}`);
        } catch (countErr) {
          console.error('⚠️  Failed to update booking count:', countErr);
        }

        console.log('✅ Booking created:', booking._id);
        console.log(`📋 Type: ${bookingType} | Payment: ${finalPaymentMethod}`);
        console.log(`👤 Therapists: ${therapistIds.length > 0 ? therapistIds.length : 'None (pending admin)'}`);

        // ── Socket emit ────────────────────────────────────────────
        const io = req.app.get('socketio');
        if (io) {
          io.emit('newBooking', {
            message: `New ${bookingType} booking created`,
            booking,
            bookingType
          });

          therapistIds.forEach(therapistId => {
            io.to(therapistId.toString()).emit('newAssignment', {
              message: 'You have a new appointment!',
              booking
            });
          });
        }

        res.status(201).json({
          msg: `${bookingType === 'walk-in' ? 'Walk-in' : 'Online'} booking created successfully!`,
          booking
        });

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

        let booking = await Booking.findById(req.params.id)
          .populate('service', 'name');
        
        if (!booking) {
          return res.status(404).json({ msg: 'Booking not found' });
        }

        const isAdmin = req.user.role === 'admin';
        const isTherapist = req.user.role === 'therapist' && booking.therapist?.toString() === req.user.id;

        if (!isAdmin && !isTherapist) {
          return res.status(403).json({ msg: 'Not authorized' });
        }

        //  THERAPIST-SPECIFIC RESTRICTIONS
        if (isTherapist) {
          // Therapists can only mark as completed
          if (status !== 'completed') {
            return res.status(403).json({ 
              msg: 'Therapists can only mark appointments as completed. Contact admin for other status changes.' 
            });
          }

          //  TIME RESTRICTIONS: Can only mark complete during or after appointment time
          const now = new Date();
          const bookingDate = new Date(booking.date);
          
          // Parse appointment start time
          const [time, period] = booking.time.split(' ');
          let [hours, minutes] = time.split(':').map(Number);
          
          if (period === 'PM' && hours !== 12) hours += 12;
          if (period === 'AM' && hours === 12) hours = 0;
          
          const appointmentStart = new Date(bookingDate);
          appointmentStart.setHours(hours, minutes, 0, 0);
          
          // Calculate appointment end time
          const appointmentEnd = new Date(appointmentStart.getTime() + booking.durationMinutes * 60 * 1000);
          
          // Add 30-minute grace period after appointment ends
          const gracePeriodEnd = new Date(appointmentEnd.getTime() + 30 * 60 * 1000);
          
          console.log('⏰ Time validation:', {
            now: now.toLocaleString(),
            appointmentStart: appointmentStart.toLocaleString(),
            appointmentEnd: appointmentEnd.toLocaleString(),
            gracePeriodEnd: gracePeriodEnd.toLocaleString()
          });
          
          // Check if current time is before appointment start
          if (now < appointmentStart) {
            const minutesUntil = Math.round((appointmentStart - now) / (1000 * 60));
            const hoursUntil = Math.floor(minutesUntil / 60);
            const minsUntil = minutesUntil % 60;
            
            let timeUntilMsg = '';
            if (hoursUntil > 0) {
              timeUntilMsg = `${hoursUntil} hour${hoursUntil > 1 ? 's' : ''} and ${minsUntil} minute${minsUntil !== 1 ? 's' : ''}`;
            } else {
              timeUntilMsg = `${minutesUntil} minute${minutesUntil !== 1 ? 's' : ''}`;
            }
            
            return res.status(400).json({ 
              msg: `Cannot mark as complete yet. Appointment starts in ${timeUntilMsg} (at ${booking.time}).`,
              appointmentStart: appointmentStart.toISOString(),
              minutesUntilStart: minutesUntil
            });
          }
          
          // ✅ OPTIONAL: Prevent marking complete too long after appointment
          // Uncomment if you want to enforce this restriction
          /*
          if (now > gracePeriodEnd) {
            return res.status(400).json({ 
              msg: 'Cannot mark as complete. Too much time has passed since the appointment ended. Please contact admin.',
              appointmentEnd: appointmentEnd.toISOString()
            });
          }
          */
          
          // Within valid time window
          console.log('✅ Time validation passed - marking as complete');
        }

        const oldStatus = booking.status;

// Build only the fields we're actually changing
const updateFields = { status };

if (status === 'completed' && oldStatus !== 'completed') {
  updateFields.completedAt = new Date();
  updateFields.completedBy = req.user.id;

  // Attribute revenue to therapist
  if (booking.therapist && booking.price) {
    try {
      const therapist = await User.findById(booking.therapist);
      if (therapist && therapist.income) {
        const commissionRate = therapist.commissionRate || 0.60;
        const earning = booking.price * commissionRate;
        therapist.income.total += earning;
        await therapist.save();
      }
    } catch (incomeErr) {
      console.error('⚠️ Failed to attribute revenue:', incomeErr);
    }
  }
}

const updatedBooking = await Booking.findByIdAndUpdate(
  booking._id,
  { $set: updateFields },
  { new: true, runValidators: false }
).populate('service therapist');

booking = updatedBooking;

        // Emit socket event
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

        res.json({ 
          msg: `Status updated to ${status}`, 
          booking,
          completedAt: booking.completedAt 
        });
      } catch (err) {
        console.error('❌ Error updating status:', err);
        res.status(500).json({ msg: 'Server error', error: err.message });
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

    router.get('/lookup-by-id/:transactionNumber', async (req, res) => {
      try {
        const { transactionNumber } = req.params;
        
        if (!transactionNumber) {
          return res.status(400).json({ msg: 'Transaction number is required' });
        }
        
        console.log('🔍 Looking up booking by transaction ID:', transactionNumber);
        
        // Find booking by transaction number
        const booking = await Booking.findOne({
          transactionNumber: transactionNumber.toUpperCase(),
        })
          .populate('service', 'name price pricing')
          .populate('therapist', 'name');
        
        if (!booking) {
          return res.status(404).json({ 
            msg: 'Booking not found. Please check your transaction number or contact us for assistance.' 
          });
        }
        
        console.log('✅ Found booking:', booking._id);
        
        res.json(booking);
      } catch (err) {
        console.error('❌ Transaction lookup error:', err);
        res.status(500).json({ msg: 'Server error' });
      }
    });

    // POST /lookup — show ALL bookings, not just active ones
    router.post('/lookup', async (req, res) => {
      try {
        const { phone, name } = req.body;
        
        if (!phone || !name) {
          return res.status(400).json({ msg: 'Phone number and name are required' });
        }
        
        const bookings = await Booking.find({
          guestPhone: phone,
          guestName: { $regex: new RegExp(name.trim(), 'i') },
          // ✅ REMOVED: status filter — show all bookings
        })
          .populate('service', 'name price pricing')
          .populate('therapist', 'name')
          .sort({ date: -1 }); // Most recent first
        
        res.json(bookings);
      } catch (err) {
        console.error('❌ Booking lookup error:', err);
        res.status(500).json({ msg: 'Server error' });
      }
    });

    // PATCH /cancel/:id
    router.patch('/cancel/:id', async (req, res) => {
      try {
        const { phone, reason, transactionNumber } = req.body;

        // Reason is now REQUIRED
        if (!reason || reason.trim().length < 10) {
          return res.status(400).json({
            msg: 'Please provide a valid reason for cancellation (at least 10 characters).'
          });
        }

        const booking = await Booking.findById(req.params.id)
          .populate('service', 'name');

        if (!booking) {
          return res.status(404).json({ msg: 'Booking not found' });
        }

        // Identity verification: phone OR transactionNumber
        const phoneMatches = phone && booking.guestPhone === phone;
        const txnMatches   = transactionNumber &&
          booking.transactionNumber === transactionNumber.toUpperCase();

        if (!phoneMatches && !txnMatches) {
          return res.status(403).json({
            msg: 'Could not verify booking identity. Please provide matching phone or transaction number.'
          });
        }

        if (booking.status === 'cancelled') {
          return res.status(400).json({ msg: 'Booking is already cancelled' });
        }
        if (booking.status === 'completed') {
          return res.status(400).json({ msg: 'Cannot cancel a completed booking' });
        }
        if (booking.status === 'pending_cancellation') {
          return res.status(400).json({ msg: 'A cancellation request is already pending admin approval.' });
        }
        if (booking.status === 'pending_reschedule') {
          return res.status(400).json({ msg: 'A reschedule request is already pending. Please wait for admin review.' });
        }

        // Store the previous status so admin can restore it on rejection
        booking.previousStatus         = booking.status;
        booking.status                 = 'pending_cancellation';
        booking.cancellationReason     = reason.trim();
        booking.cancellationRequestedAt = new Date();

        await booking.save();

        const io = req.app.get('socketio');
        if (io) {
          io.emit('cancellationRequested', {
            message: `Cancellation requested for booking ${booking.transactionNumber}`,
            booking
          });
        }

        res.json({
          msg: 'Cancellation request submitted. An admin will review it shortly.',
          booking
        });

      } catch (err) {
        console.error('❌ Cancel request error:', err);
        res.status(500).json({ msg: 'Server error' });
      }
    });

    // PATCH /reschedule/:id
    router.patch('/reschedule/:id', async (req, res) => {
      try {
        const { phone, newDate, newTime, reason, transactionNumber } = req.body;

        if (!newDate || !newTime) {
          return res.status(400).json({ msg: 'New date and time are required' });
        }

        // Reason is now REQUIRED
        if (!reason || reason.trim().length < 10) {
          return res.status(400).json({
            msg: 'Please provide a valid reason for rescheduling (at least 10 characters).'
          });
        }

        const booking = await Booking.findById(req.params.id)
          .populate('service', 'name');

        if (!booking) {
          return res.status(404).json({ msg: 'Booking not found' });
        }

        // Identity verification
        const phoneMatches = phone && booking.guestPhone === phone;
        const txnMatches   = transactionNumber &&
          booking.transactionNumber === transactionNumber.toUpperCase();

        if (!phoneMatches && !txnMatches) {
          return res.status(403).json({
            msg: 'Could not verify booking identity. Please provide matching phone or transaction number.'
          });
        }

        if (booking.status === 'cancelled') {
          return res.status(400).json({ msg: 'Cannot reschedule a cancelled booking' });
        }
        if (booking.status === 'completed') {
          return res.status(400).json({ msg: 'Cannot reschedule a completed booking' });
        }
        if (booking.status === 'pending_reschedule') {
          return res.status(400).json({ msg: 'A reschedule request is already pending admin approval.' });
        }
        if (booking.status === 'pending_cancellation') {
          return res.status(400).json({ msg: 'A cancellation request is pending. Please wait for admin review.' });
        }

        const newBookingDate = new Date(newDate);
        if (newBookingDate < new Date().setHours(0, 0, 0, 0)) {
          return res.status(400).json({ msg: 'Cannot reschedule to a past date' });
        }

        // Store pending reschedule details; don't move the booking yet
        booking.previousStatus          = booking.status;
        booking.status                  = 'pending_reschedule';
        booking.rescheduleReason        = reason.trim();
        booking.rescheduleRequestedAt   = new Date();
        booking.pendingRescheduleDate   = newBookingDate;
        booking.pendingRescheduleTime   = newTime;

        await booking.save();

        const io = req.app.get('socketio');
        if (io) {
          io.emit('rescheduleRequested', {
            message: `Reschedule requested for booking ${booking.transactionNumber}`,
            booking
          });
        }

        res.json({
          msg: 'Reschedule request submitted. An admin will review it shortly.',
          booking
        });

      } catch (err) {
        console.error('❌ Reschedule request error:', err);
        res.status(500).json({ msg: 'Server error' });
      }
    });

    router.patch('/cancel/:id/approve', auth, roles(['admin']), async (req, res) => {
      try {
        const booking = await Booking.findById(req.params.id)
          .populate('service', 'name');

        if (!booking) {
          return res.status(404).json({ msg: 'Booking not found' });
        }
        if (booking.status !== 'pending_cancellation') {
          return res.status(400).json({ msg: 'No pending cancellation request for this booking' });
        }

        booking.status      = 'cancelled';
        booking.cancelledAt = new Date();

        await booking.save();

        const io = req.app.get('socketio');
        if (io) {
          io.emit('bookingCancelled', { bookingId: booking._id, booking });
          if (booking.therapist) {
            io.to(booking.therapist.toString()).emit('appointmentCancelled', {
              message: 'An appointment was cancelled by admin',
              booking
            });
          }
        }

        res.json({ msg: 'Cancellation approved. Booking has been cancelled.', booking });

      } catch (err) {
        console.error('❌ Approve cancel error:', err);
        res.status(500).json({ msg: 'Server error' });
      }
    });


    // PATCH /cancel/:id/reject  — ADMIN rejects cancellation request
    router.patch('/cancel/:id/reject', auth, roles(['admin']), async (req, res) => {
      try {
        const { adminNote } = req.body;

        const booking = await Booking.findById(req.params.id)
          .populate('service', 'name');

        if (!booking) {
          return res.status(404).json({ msg: 'Booking not found' });
        }
        if (booking.status !== 'pending_cancellation') {
          return res.status(400).json({ msg: 'No pending cancellation request for this booking' });
        }

        // Restore to previous status (confirmed / pending)
        booking.status            = booking.previousStatus || 'confirmed';
        booking.adminRejectionNote = adminNote || 'Cancellation request was not approved.';
        booking.cancellationReason = null; // Clear the pending reason
        booking.previousStatus    = null;

        await booking.save();

        const io = req.app.get('socketio');
        if (io) {
          io.emit('cancellationRejected', { bookingId: booking._id, booking });
        }

        res.json({ msg: 'Cancellation request rejected. Booking remains active.', booking });

      } catch (err) {
        console.error('❌ Reject cancel error:', err);
        res.status(500).json({ msg: 'Server error' });
      }
    });


    // PATCH /reschedule/:id/approve  — ADMIN approves reschedule request
    router.patch('/reschedule/:id/approve', auth, roles(['admin']), async (req, res) => {
      try {
        const booking = await Booking.findById(req.params.id)
          .populate('service', 'name');

        if (!booking) {
          return res.status(404).json({ msg: 'Booking not found' });
        }
        if (booking.status !== 'pending_reschedule') {
          return res.status(400).json({ msg: 'No pending reschedule request for this booking' });
        }

        const newBookingDate = new Date(booking.pendingRescheduleDate);
        const newTime        = booking.pendingRescheduleTime;

        // Check therapist availability at the new slot
        if (booking.therapist) {
          const isAvailable = await isTherapistAvailable(
            booking.therapist, newBookingDate, newTime, booking.durationMinutes
          );
          if (!isAvailable) {
            return res.status(400).json({
              msg: 'The requested therapist is not available at the new time. Reject and notify the client to choose another slot.'
            });
          }
        }

        const { endTime: calculatedEndTime, availableAfter: availableAfterTime } =
          await calculateEndTimes(newTime, booking.durationMinutes);

        const endTimeDate        = convertTimeToDate(newBookingDate, calculatedEndTime);
        const availableAfterDate = convertTimeToDate(newBookingDate, availableAfterTime);

        const oldDate = booking.date;
        const oldTime = booking.time;

        booking.date              = newBookingDate;
        booking.time              = newTime;
        booking.endTime           = endTimeDate;
        booking.availableAfter    = availableAfterDate;
        booking.rescheduledFrom   = { date: oldDate, time: oldTime, rescheduledAt: new Date() };
        booking.status            = booking.previousStatus || 'confirmed';
        booking.previousStatus    = null;
        booking.pendingRescheduleDate = null;
        booking.pendingRescheduleTime = null;
        booking.rescheduleReason  = null;

        await booking.save();

        const io = req.app.get('socketio');
        if (io) {
          io.emit('bookingRescheduled', { booking });
          if (booking.therapist) {
            io.to(booking.therapist.toString()).emit('appointmentRescheduled', {
              message: 'An appointment was rescheduled',
              booking
            });
          }
        }

        res.json({ msg: 'Reschedule approved. Booking has been moved to the new date/time.', booking });

      } catch (err) {
        console.error('❌ Approve reschedule error:', err);
        res.status(500).json({ msg: 'Server error' });
      }
    });


    // PATCH /reschedule/:id/reject  — ADMIN rejects reschedule request
    router.patch('/reschedule/:id/reject', auth, roles(['admin']), async (req, res) => {
      try {
        const { adminNote } = req.body;

        const booking = await Booking.findById(req.params.id)
          .populate('service', 'name');

        if (!booking) {
          return res.status(404).json({ msg: 'Booking not found' });
        }
        if (booking.status !== 'pending_reschedule') {
          return res.status(400).json({ msg: 'No pending reschedule request for this booking' });
        }

        booking.status              = booking.previousStatus || 'confirmed';
        booking.adminRejectionNote  = adminNote || 'Reschedule request was not approved.';
        booking.previousStatus      = null;
        booking.pendingRescheduleDate = null;
        booking.pendingRescheduleTime = null;
        booking.rescheduleReason    = null;

        await booking.save();

        const io = req.app.get('socketio');
        if (io) {
          io.emit('rescheduleRejected', { bookingId: booking._id, booking });
        }

        res.json({ msg: 'Reschedule request rejected. Booking remains at original date/time.', booking });

      } catch (err) {
        console.error('❌ Reject reschedule error:', err);
        res.status(500).json({ msg: 'Server error' });
      }
    });

    router.get('/therapist-status', async (req, res) => {
      try {
        const now = new Date();
        const currentTime = now.getHours() * 60 + now.getMinutes();
        const currentDay = now.toLocaleDateString('en-US', { weekday: 'long' });
        
        console.log('🔍 Checking therapist status for:', currentDay, 'at', now.toLocaleTimeString());
        
        // ✅ CORRECTED: Use "Settings" (plural) to match your model
        let postServiceRestMinutes = 60;
        try {
          const Settings = require('../models/Settings'); // ✅ Changed from Setting to Settings
          const postServiceRestSetting = await Settings.findOne({ key: 'postServiceRest' });
          if (postServiceRestSetting && postServiceRestSetting.value) {
            postServiceRestMinutes = postServiceRestSetting.value;
          }
          console.log(`⏰ Post-service rest period: ${postServiceRestMinutes} minutes`);
        } catch (settingErr) {
          console.warn('⚠️ Could not load Settings, using default 60 minutes:', settingErr.message);
        }
        
        // Load grace periods
        let todayGracePeriods = null;
        try {
          const GracePeriod = require('../models/GracePeriod');
          todayGracePeriods = await GracePeriod.findOne({ 
            dayOfWeek: currentDay, 
            isActive: true 
          });
          console.log(`📋 Grace periods for ${currentDay}:`, todayGracePeriods?.periods?.length || 0);
        } catch (graceErr) {
          console.warn('⚠️ Could not load GracePeriod model:', graceErr.message);
        }
        
        // Get all active therapists
        const therapists = await User.find({ 
          role: 'therapist', 
          isActive: true 
        }).select('name weeklySchedule dateOverrides');
        
        console.log(`📊 Found ${therapists.length} active therapists`);
        
        // Get all bookings for today
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        
        const todaysBookings = await Booking.find({
          date: {
            $gte: todayStart,
            $lte: todayEnd
          },
          status: { $nin: ['cancelled'] }
        }).populate('therapist service', 'name');
        
        console.log(`📅 Found ${todaysBookings.length} bookings today`);
        
        // Calculate status for each therapist
        const statusData = await Promise.all(therapists.map(async (therapist) => {
          try {
            console.log(`\n👤 Checking ${therapist.name}:`);
            
            // Check schedule
            if (!therapist.weeklySchedule || therapist.weeklySchedule.length === 0) {
              console.log(`   ⚠️ No weeklySchedule defined`);
              return {
                name: therapist.name,
                status: 'off',
                statusMessage: 'Schedule not configured',
                currentBooking: null,
                breakUntil: null,
                nextAvailable: 'Schedule not available'
              };
            }
            
            const todaySchedule = therapist.weeklySchedule.find(
              schedule => schedule.dayOfWeek === currentDay && schedule.isWorking
            );
            
            if (!todaySchedule) {
              console.log(`   ❌ No schedule for ${currentDay}`);
              const nextWorkDay = getNextWorkDay(therapist.weeklySchedule, currentDay);
              return {
                name: therapist.name,
                status: 'off',
                statusMessage: 'Off Duty',
                currentBooking: null,
                breakUntil: null,
                nextAvailable: nextWorkDay
              };
            }
            
            console.log(`   ✅ Has schedule for ${currentDay}`);
            
            const shifts = todaySchedule.shifts || [];
            if (shifts.length === 0) {
              console.log(`   ⚠️ Schedule exists but no shifts defined`);
              return {
                name: therapist.name,
                status: 'off',
                statusMessage: 'Schedule incomplete',
                currentBooking: null,
                breakUntil: null,
                nextAvailable: 'Schedule not configured'
              };
            }
            
            // Check if within ANY shift
            let isWithinWorkHours = false;
            
            for (const shift of shifts) {
              const workStart = parseTimeToMinutes(shift.startTime);
              const workEnd = parseTimeToMinutes(shift.endTime);
              
              if (currentTime >= workStart && currentTime < workEnd) {
                isWithinWorkHours = true;
                console.log(`   ✅ Within working hours (${shift.startTime} - ${shift.endTime})`);
                break;
              }
            }
            
            if (!isWithinWorkHours) {
              console.log(`   ❌ Outside working hours`);
              const firstShift = shifts[0];
              
              let nextAvailable;
              if (currentTime < parseTimeToMinutes(firstShift.startTime)) {
                nextAvailable = `today at ${firstShift.startTime}`;
              } else {
                nextAvailable = getNextWorkDay(therapist.weeklySchedule, currentDay);
              }
              
              return {
                name: therapist.name,
                status: 'off',
                statusMessage: 'Off Duty',
                currentBooking: null,
                breakUntil: null,
                nextAvailable
              };
            }
            
            // Check if in active booking
            const activeBooking = todaysBookings.find(booking => {
  if (booking.status === 'completed') return false;

  const tid = therapist._id.toString();
  const assignedSingle = booking.therapist && booking.therapist._id.toString() === tid;
  const assignedMulti  = Array.isArray(booking.therapists) &&
    booking.therapists.some(t => t.toString() === tid);

  if (!assignedSingle && !assignedMulti) return false;

  const bookingStartMinutes = parseTimeToMinutes(booking.time);
  const bookingEnd = bookingStartMinutes + booking.durationMinutes;
  return currentTime >= bookingStartMinutes && currentTime < bookingEnd;
});
            
            if (activeBooking) {
              console.log(`   🔴 In session: ${activeBooking.service?.name || 'Service'}`);
              
              const bookingStartMinutes = parseTimeToMinutes(activeBooking.time);
              const sessionEndMinutes = bookingStartMinutes + activeBooking.durationMinutes;
              const sessionEndTime = formatTimeFromMinutes(sessionEndMinutes);
              
              const availableAfterMinutes = sessionEndMinutes + postServiceRestMinutes;
              const availableAfterTime = formatTimeFromMinutes(availableAfterMinutes);
              
              return {
                name: therapist.name,
                status: 'busy',
                statusMessage: 'In Session',
                currentBooking: {
                  service: activeBooking.service,
                  endTime: sessionEndTime,
                  availableAfter: availableAfterTime
                },
                breakUntil: null,
                nextAvailable: null
              };
            }
            
            // Check post-service grace period
            const recentlyCompletedBooking = todaysBookings.find(booking => {
  if (booking.status !== 'completed') return false;

  const tid = therapist._id.toString();
  const assignedSingle = booking.therapist && booking.therapist._id.toString() === tid;
  const assignedMulti  = Array.isArray(booking.therapists) &&
    booking.therapists.some(t => t.toString() === tid);

  if (!assignedSingle && !assignedMulti) return false;

  const bookingStartMinutes = parseTimeToMinutes(booking.time);
  const sessionEndMinutes = bookingStartMinutes + booking.durationMinutes;
  const gracePeriodEndMinutes = sessionEndMinutes + postServiceRestMinutes;
  return currentTime >= sessionEndMinutes && currentTime < gracePeriodEndMinutes;
});
            
            if (recentlyCompletedBooking) {
              const bookingStartMinutes = parseTimeToMinutes(recentlyCompletedBooking.time);
              const sessionEndMinutes = bookingStartMinutes + recentlyCompletedBooking.durationMinutes;
              const gracePeriodEndMinutes = sessionEndMinutes + postServiceRestMinutes;
              const gracePeriodEndTime = formatTimeFromMinutes(gracePeriodEndMinutes);
              
              console.log(`   💆 In post-service rest until ${gracePeriodEndTime}`);
              
              return {
                name: therapist.name,
                status: 'break',
                statusMessage: 'Post-Service Rest',
                currentBooking: null,
                breakUntil: gracePeriodEndTime,
                nextAvailable: null
              };
            }
            
            // Check scheduled breaks
            if (todaySchedule.breaks && todaySchedule.breaks.length > 0) {
              const currentBreak = todaySchedule.breaks.find(breakTime => {
                const breakStart = parseTimeToMinutes(breakTime.startTime);
                const breakEnd = parseTimeToMinutes(breakTime.endTime);
                
                return currentTime >= breakStart && currentTime < breakEnd;
              });
              
              if (currentBreak) {
                console.log(`   🟡 On scheduled break until ${currentBreak.endTime}`);
                
                return {
                  name: therapist.name,
                  status: 'break',
                  statusMessage: currentBreak.label || 'Scheduled Break',
                  currentBooking: null,
                  breakUntil: currentBreak.endTime,
                  nextAvailable: null
                };
              }
            }
            
            // Check global grace periods
            if (todayGracePeriods && todayGracePeriods.periods && todayGracePeriods.periods.length > 0) {
              const globalGracePeriod = todayGracePeriods.periods.find(period => {
                const periodStart = parseTimeToMinutes(period.startTime);
                const periodEnd = parseTimeToMinutes(period.endTime);
                
                return currentTime >= periodStart && currentTime < periodEnd;
              });
              
              if (globalGracePeriod) {
                console.log(`   🌍 In global grace period until ${globalGracePeriod.endTime}`);
                
                return {
                  name: therapist.name,
                  status: 'break',
                  statusMessage: globalGracePeriod.label || 'Rest Period',
                  currentBooking: null,
                  breakUntil: globalGracePeriod.endTime,
                  nextAvailable: null
                };
              }
            }
            
            // Available
            console.log(`   🟢 Available`);
            return {
              name: therapist.name,
              status: 'available',
              statusMessage: 'Available Now',
              currentBooking: null,
              breakUntil: null,
              nextAvailable: null
            };
            
          } catch (therapistErr) {
            console.error(`   ❌ Error processing ${therapist.name}:`, therapistErr.message);
            return {
              name: therapist.name,
              status: 'off',
              statusMessage: 'Error loading status',
              currentBooking: null,
              breakUntil: null,
              nextAvailable: 'Unable to determine'
            };
          }
        }));
        
        // Sort by status
        const sortOrder = { available: 0, busy: 1, break: 2, off: 3 };
        statusData.sort((a, b) => sortOrder[a.status] - sortOrder[b.status]);
        
        console.log('\n📊 Status Summary:');
        const summary = statusData.reduce((acc, t) => {
          acc[t.status] = (acc[t.status] || 0) + 1;
          return acc;
        }, {});
        console.log(summary);
        
        res.json(statusData);
        
      } catch (error) {
        console.error('❌ CRITICAL Error in therapist-status endpoint:', error);
        console.error('Stack trace:', error.stack);
        res.status(500).json({ 
          msg: 'Server error', 
          error: error.message,
          stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
      }
    });

    // Helper functions
    function parseTimeToMinutes(timeString) {
      try {
        const [time, period] = timeString.split(' ');
        let [hours, minutes] = time.split(':').map(Number);
        
        if (period === 'PM' && hours !== 12) hours += 12;
        if (period === 'AM' && hours === 12) hours = 0;
        
        return hours * 60 + minutes;
      } catch (err) {
        console.error('❌ Error parsing time:', timeString, err);
        return 0;
      }
    }

    function formatTimeFromMinutes(totalMinutes) {
      try {
        const hours24 = Math.floor(totalMinutes / 60) % 24;
        const minutes = totalMinutes % 60;
        
        const period = hours24 >= 12 ? 'PM' : 'AM';
        const hours12 = hours24 > 12 ? hours24 - 12 : (hours24 === 0 ? 12 : hours24);
        
        return `${hours12}:${String(minutes).padStart(2, '0')} ${period}`;
      } catch (err) {
        console.error('❌ Error formatting time:', totalMinutes, err);
        return 'Unknown';
      }
    }

    function getNextWorkDay(weeklySchedule, currentDay) {
      try {
        if (!weeklySchedule || weeklySchedule.length === 0) return 'Schedule not available';
        
        const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const currentIndex = days.indexOf(currentDay);
        
        for (let i = 1; i <= 7; i++) {
          const nextIndex = (currentIndex + i) % 7;
          const nextDay = days[nextIndex];
          
          const schedule = weeklySchedule.find(s => s.dayOfWeek === nextDay && s.isWorking);
          
          if (schedule && schedule.shifts && schedule.shifts.length > 0) {
            const firstShift = schedule.shifts[0];
            return i === 1 
              ? `tomorrow at ${firstShift.startTime}` 
              : `${nextDay} at ${firstShift.startTime}`;
          }
        }
        
        return 'Schedule not available';
      } catch (err) {
        console.error('❌ Error getting next work day:', err);
        return 'Unable to determine';
      }
    }

    // Count unique clients for trust indicators
    router.get('/count', async (req, res) => {
      try {
        const completedBookings = await Booking.find({
          status: { $in: ['confirmed', 'completed'] }
        }).select('guestPhone');
        
        const uniquePhones = new Set();
        completedBookings.forEach(booking => {
          if (booking.guestPhone) {
            uniquePhones.add(booking.guestPhone);
          }
        });
        
        res.json({
          uniqueClients: uniquePhones.size,
          totalBookings: completedBookings.length
        });
        
      } catch (err) {
        console.error('Error counting clients:', err);
        res.json({ uniqueClients: 0, totalBookings: 0 });
      }
    });

    // Admin: Assign therapist with optional note (used by admin dashboard)
router.put('/:id/assign-therapist', auth, roles(['admin']), async (req, res) => {
  try {
    const { therapistId, therapist: therapistName, assignNote } = req.body;

    const booking = await Booking.findById(req.params.id).populate('service');
    if (!booking) {
      return res.status(404).json({ msg: 'Booking not found' });
    }

    const oldTherapist = booking.therapist;

    if (therapistId) {
      // Assigning a specific therapist
      const therapist = await User.findOne({ _id: therapistId, role: 'therapist', isActive: true });
      if (!therapist) {
        return res.status(404).json({ msg: 'Therapist not found or inactive' });
      }

      booking.therapist  = therapist._id;
      booking.therapists = [therapist._id];
    } else {
      // Resetting to "Any available"
      booking.therapist  = null;
      booking.therapists = [];
    }

    // Save optional admin note
    if (assignNote && assignNote.trim()) {
      booking.assignNote = assignNote.trim();
    }

    await booking.save();
    await booking.populate('service therapist therapists');

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
          booking
        });
      }
      io.emit('bookingUpdated', { booking });
    }

    res.json({ msg: 'Therapist assigned successfully', booking });
  } catch (err) {
    console.error('❌ Assign therapist error:', err);
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});

// ── GET /api/bookings/service-stats ──────────────────────────────────────────
// Returns booking count + avg approved rating per service CATEGORY.
// Used by the homepage to drive "Most Booked" badges and star ratings.
router.get('/service-stats', async (req, res) => {
  try {
    // 1. Booking counts grouped by service category (completed only)
    const bookingCounts = await Booking.aggregate([
      { $match: { status: 'completed' } },
      {
        $lookup: {
          from: 'services',
          localField: 'service',
          foreignField: '_id',
          as: 'serviceDoc',
        },
      },
      { $unwind: '$serviceDoc' },
      {
        $group: {
          _id: '$serviceDoc.category',
          bookingCount: { $sum: 1 },
          // keep one sample service name per category
          sampleServiceName: { $first: '$serviceDoc.name' },
        },
      },
      { $sort: { bookingCount: -1 } },
    ]);

    // 2. Avg approved rating grouped by service category
    const ratingsByCategory = await Review.aggregate([
      { $match: { status: 'approved', hidden: { $ne: true } } },
      {
        $lookup: {
          from: 'services',
          localField: 'service',
          foreignField: '_id',
          as: 'serviceDoc',
        },
      },
      { $unwind: '$serviceDoc' },
      {
        $group: {
          _id: '$serviceDoc.category',
          averageRating: { $avg: '$rating' },
          reviewCount:   { $sum: 1 },
        },
      },
    ]);

    // 3. Merge
    const ratingsMap = {};
    ratingsByCategory.forEach(r => {
      ratingsMap[r._id] = {
        averageRating: parseFloat(r.averageRating.toFixed(1)),
        reviewCount:   r.reviewCount,
      };
    });

    // Find max recent bookings (last 30 days) for "Trending" badge
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentCounts = await Booking.aggregate([
      { $match: { status: { $in: ['completed', 'confirmed'] }, date: { $gte: thirtyDaysAgo } } },
      {
        $lookup: {
          from: 'services',
          localField: 'service',
          foreignField: '_id',
          as: 'serviceDoc',
        },
      },
      { $unwind: '$serviceDoc' },
      {
        $group: {
          _id: '$serviceDoc.category',
          recentCount: { $sum: 1 },
        },
      },
    ]);

    const recentMap = {};
    recentCounts.forEach(r => { recentMap[r._id] = r.recentCount; });

    // Identify the single most-booked category
    const maxBookings = bookingCounts.length > 0 ? bookingCounts[0].bookingCount : 0;
    // Identify the single most-trending category
    const maxRecent = Math.max(...Object.values(recentMap), 0);

    const result = bookingCounts.map(cat => ({
      category:      cat._id,
      bookingCount:  cat.bookingCount,
      recentCount:   recentMap[cat._id] || 0,
      isMostBooked:  cat.bookingCount === maxBookings,
      isTrending:    (recentMap[cat._id] || 0) === maxRecent && maxRecent > 0,
      averageRating: ratingsMap[cat._id]?.averageRating || null,
      reviewCount:   ratingsMap[cat._id]?.reviewCount   || 0,
    }));

    res.json(result);
  } catch (err) {
    console.error('service-stats error:', err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ── GET /api/bookings/homepage-stats ─────────────────────────────────────────
// Returns aggregate numbers for the counter section of the homepage.
router.get('/homepage-stats', async (req, res) => {
  try {
    const [totalBookings, uniqueClientsResult, ratingResult] = await Promise.all([
      // Total completed bookings
      Booking.countDocuments({ status: 'completed' }),

      // Sum numberOfClients across all completed bookings = total people served
      Booking.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, total: { $sum: { $ifNull: ['$numberOfClients', 1] } } } },
      ]),

      // Average rating from approved reviews
      Review.aggregate([
        { $match: { status: 'approved', hidden: { $ne: true } } },
        { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
      ]),
    ]);

    const uniqueClients  = uniqueClientsResult[0]?.total  || 0;
    const averageRating  = ratingResult[0]
      ? parseFloat(ratingResult[0].avg.toFixed(1))
      : 4.9;

    res.json({
      totalBookings,
      totalClients:  uniqueClients,
      yearsExperience: 15,            // static — business age
      averageRating,
    });
  } catch (err) {
    console.error('homepage-stats error:', err);
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