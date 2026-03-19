// src/utils/availability.js
const Booking = require('../models/Booking');
const User = require('../models/User');
const GracePeriod = require('../models/GracePeriod');
const Settings = require('../models/Settings');

/**
 * Get post-service rest duration from settings
 */
async function getPostServiceRest() {
  try {
    const setting = await Settings.findOne({ key: 'postServiceRest' });
    return setting ? parseInt(setting.value) : 60; // Default 60 minutes
  } catch (err) {
    console.error('Error fetching post-service rest setting:', err);
    return 60; // Fallback to 60 minutes
  }
}

/**
 * Convert "9:00 AM" to minutes since midnight
 */
function timeToMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') {
    console.error('❌ Invalid time string:', timeStr);
    return 0;
  }
  
  const parts = timeStr.split(' ');
  if (parts.length !== 2) {
    console.error('❌ Invalid time format (expected "HH:MM AM/PM"):', timeStr);
    return 0;
  }
  
  const [time, period] = parts;
  const timeParts = time.split(':');
  
  if (timeParts.length !== 2) {
    console.error('❌ Invalid time format (expected "HH:MM"):', time);
    return 0;
  }
  
  let [hours, minutes] = timeParts.map(Number);
  
  if (isNaN(hours) || isNaN(minutes)) {
    console.error('❌ Invalid hours or minutes:', { hours, minutes });
    return 0;
  }
  
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  
  return hours * 60 + minutes;
}

/**
 * Convert Date object to minutes since midnight
 */
function dateToMinutes(dateObj) {
  if (!dateObj || !(dateObj instanceof Date)) {
    console.error('❌ Invalid Date object:', dateObj);
    return 0;
  }
  return dateObj.getHours() * 60 + dateObj.getMinutes();
}

/**
 * Convert minutes since midnight back to "9:00 AM" format
 */
function minutesToTime(totalMinutes) {
  let hours = Math.floor(totalMinutes / 60);
  let minutes = totalMinutes % 60;
  
  const period = hours >= 12 ? 'PM' : 'AM';
  if (hours > 12) hours -= 12;
  if (hours === 0) hours = 12;
  
  return `${hours}:${minutes.toString().padStart(2, '0')} ${period}`;
}

/**
 * Calculate end time with configurable grace period
 */
async function calculateEndTimes(startTime, durationMinutes, customGracePeriod = null) {
  const gracePeriodMinutes = customGracePeriod !== null ? customGracePeriod : await getPostServiceRest();
  
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = startMinutes + durationMinutes;
  const availableMinutes = endMinutes + gracePeriodMinutes;
  
  return {
    endTime: minutesToTime(endMinutes),
    availableAfter: minutesToTime(availableMinutes),
    gracePeriodUsed: gracePeriodMinutes
  };
}

/**
 * Check if time conflicts with global grace periods
 */
async function isInGlobalGracePeriod(date, requestedTime, durationMinutes) {
  const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' });
  
  const gracePeriod = await GracePeriod.findOne({ 
    dayOfWeek, 
    isActive: true 
  });
  
  if (!gracePeriod || !gracePeriod.periods || gracePeriod.periods.length === 0) {
    return false;
  }
  
  const requestedStart = timeToMinutes(requestedTime);
  const requestedEnd = requestedStart + durationMinutes;
  
  console.log(`  🔍 Checking global grace periods for ${dayOfWeek} at ${requestedTime}`);
  
  for (const period of gracePeriod.periods) {
    const graceStart = timeToMinutes(period.startTime);
    const graceEnd = timeToMinutes(period.endTime);
    
    console.log(`    Grace: ${period.label || 'Rest Period'} ${period.startTime}-${period.endTime}`);
    
    if (requestedStart < graceEnd && requestedEnd > graceStart) {
      console.log(`    ❌ CONFLICT! Booking overlaps with grace period`);
      return true;
    }
  }
  
  console.log(`  ✅ No global grace period conflicts`);
  return false;
}

/**
 * Check if time slot conflicts with any breaks
 */
function isInBreakTime(breaks, requestedTime, durationMinutes) {
  if (!breaks || breaks.length === 0) return false;
  
  const requestedStart = timeToMinutes(requestedTime);
  const requestedEnd = requestedStart + durationMinutes;
  
  console.log(`    🔍 Checking ${breaks.length} break(s) for ${requestedTime} (${durationMinutes} min)`);
  
  for (const breakTime of breaks) {
    const breakStart = timeToMinutes(breakTime.startTime);
    const breakEnd = timeToMinutes(breakTime.endTime);
    
    console.log(`      Break: ${breakTime.startTime}-${breakTime.endTime} (${breakStart}-${breakEnd} min)`);
    console.log(`      Request: ${requestedTime} (${requestedStart}-${requestedEnd} min)`);
    
    if (requestedStart < breakEnd && requestedEnd > breakStart) {
      console.log(`      ❌ CONFLICT! Booking overlaps with break`);
      return true;
    }
    console.log(`      ✅ No conflict with this break`);
  }
  
  return false;
}

/**
 * Check if therapist is working (includes global grace periods)
 */
async function isTherapistWorkingAt(therapist, date, time, durationMinutes = 60) {
  if (!date || !(date instanceof Date) || isNaN(date.getTime())) {
    console.error('❌ Invalid date passed to isTherapistWorkingAt:', date);
    return false;
  }
  
  if (!time || typeof time !== 'string') {
    console.error('❌ Invalid time passed to isTherapistWorkingAt:', time);
    return false;
  }
  
  // Check global grace periods first
  const inGlobalGrace = await isInGlobalGracePeriod(date, time, durationMinutes);
  if (inGlobalGrace) {
    console.log(`  ⏰ Time conflicts with global grace period`);
    return false;
  }
  
  const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' });
  const requestedMinutes = timeToMinutes(time);
  
  console.log(`\n🔍 Checking if ${therapist.name} works on ${dayOfWeek} at ${time}`);
  
  // Check date-specific overrides
  if (therapist.dateOverrides && therapist.dateOverrides.length > 0) {
    const override = therapist.dateOverrides.find(o => {
      const overrideDate = new Date(o.date);
      return overrideDate.toDateString() === date.toDateString();
    });
    
    if (override) {
      console.log(`  📅 Found date override: isWorking=${override.isWorking}`);
      
      if (!override.isWorking) {
        console.log(`  ❌ Not working on this date (override)`);
        return false;
      }
      
      if (isInBreakTime(override.breaks, time, durationMinutes)) {
        console.log(`  ⏰ In break time (override)`);
        return false;
      }
      
      if (override.shifts && override.shifts.length > 0) {
        const inShift = override.shifts.some(shift => {
          const shiftStart = timeToMinutes(shift.startTime);
          const shiftEnd = timeToMinutes(shift.endTime);
          return requestedMinutes >= shiftStart && requestedMinutes < shiftEnd;
        });
        console.log(`  ${inShift ? '✅' : '❌'} Override shift check`);
        return inShift;
      }
      
      console.log(`  ❌ No shifts defined in override`);
      return false;
    }
  }
  
  // Check weekly schedule
  if (therapist.weeklySchedule && therapist.weeklySchedule.length > 0) {
    const daySchedule = therapist.weeklySchedule.find(s => s.dayOfWeek === dayOfWeek);
    
    if (daySchedule) {
      console.log(`  📋 Found weekly schedule: isWorking=${daySchedule.isWorking}`);
      
      if (!daySchedule.isWorking) {
        console.log(`  ❌ Not working on ${dayOfWeek} (weekly schedule)`);
        return false;
      }
      
      if (isInBreakTime(daySchedule.breaks, time, durationMinutes)) {
        console.log(`  ⏰ In break time (${daySchedule.breaks.length} breaks set)`);
        return false;
      }
      
      if (daySchedule.shifts && daySchedule.shifts.length > 0) {
        const inShift = daySchedule.shifts.some(shift => {
          const shiftStart = timeToMinutes(shift.startTime);
          const shiftEnd = timeToMinutes(shift.endTime);
          const result = requestedMinutes >= shiftStart && requestedMinutes < shiftEnd;
          console.log(`    Shift ${shift.startTime}-${shift.endTime}: ${result}`);
          return result;
        });
        console.log(`  ${inShift ? '✅' : '❌'} Weekly shift check`);
        return inShift;
      }
      
      console.log(`  ⚠️ No shifts defined, falling back to default shift`);
    } else {
      console.log(`  ⚠️ No schedule for ${dayOfWeek}, using default shift`);
    }
  } else {
    console.log(`  ⚠️ No weekly schedule set, using default shift`);
  }
  
  // Fallback to default shift
  if (therapist.defaultShift) {
    const shiftStart = timeToMinutes(therapist.defaultShift.startTime);
    const shiftEnd = timeToMinutes(therapist.defaultShift.endTime);
    const result = requestedMinutes >= shiftStart && requestedMinutes < shiftEnd;
    console.log(`  🕐 Default shift ${therapist.defaultShift.startTime}-${therapist.defaultShift.endTime}: ${result}`);
    return result;
  }
  
  console.log(`  ✅ No default shift, assuming available`);
  return true;
}

/**
 * Check if therapist has expertise for a service
 */
function hasExpertise(therapist, serviceName) {
  if (!therapist.expertise || therapist.expertise.length === 0) {
    return true;
  }
  
  return therapist.expertise.some(exp => 
    exp.toLowerCase().trim() === serviceName.toLowerCase().trim()
  );
}

/**
 * Check if therapist is available (no booking conflicts)
 */
async function isTherapistAvailable(therapistId, date, startTime, durationMinutes) {
  console.log(`\n🔍 Checking if therapist ${therapistId} is available:`);
  console.log(`   Date: ${date.toDateString()}`);
  console.log(`   Time: ${startTime}`);
  console.log(`   Duration: ${durationMinutes} min`);
  
  const requestedStart = timeToMinutes(startTime);
  const requestedEnd = requestedStart + durationMinutes;
  
  console.log(`   Requested slot: ${requestedStart}-${requestedEnd} minutes`);
  
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  
  const existingBookings = await Booking.find({
    $or: [
      { therapist: therapistId },
      { therapists: therapistId }
    ],
    date: {
      $gte: startOfDay,
      $lte: endOfDay
    },
    status: { $ne: 'cancelled' }
  }).sort({ time: 1 });
  
  console.log(`   Found ${existingBookings.length} existing booking(s)`);
  
  for (const booking of existingBookings) {
    const bookingStart = timeToMinutes(booking.time);
    
    let bookingEnd;
    
    if (booking.availableAfter && booking.availableAfter instanceof Date) {
      bookingEnd = dateToMinutes(booking.availableAfter);
      console.log(`   📅 Existing: ${booking.time} (ends at ${bookingEnd} min via availableAfter Date)`);
    } else if (booking.endTime && typeof booking.endTime === 'string') {
      bookingEnd = timeToMinutes(booking.endTime);
      console.log(`   📅 Existing: ${booking.time} - ${booking.endTime} (${bookingStart}-${bookingEnd} min)`);
    } else {
      const postServiceRest = await getPostServiceRest();
      bookingEnd = bookingStart + booking.durationMinutes + postServiceRest;
      console.log(`   📅 Existing: ${booking.time} (calculated end: ${bookingEnd} min with ${postServiceRest} min rest)`);
    }
    
    const hasOverlap = requestedStart < bookingEnd && requestedEnd > bookingStart;
    
    if (hasOverlap) {
      console.log(`   ❌ CONFLICT! Requested ${requestedStart}-${requestedEnd} overlaps with existing ${bookingStart}-${bookingEnd}`);
      return false;
    } else {
      console.log(`   ✅ No conflict with this booking`);
    }
  }
  
  console.log(`   ✅ Therapist is AVAILABLE - no booking conflicts`);
  return true;
}

/**
 * Get all available therapists
 */
async function getAvailableTherapists(serviceName, date, time, durationMinutes) {
  console.log('🔍 Checking availability:', { serviceName, date, time, durationMinutes });
  
  const allTherapists = await User.find({ 
    role: 'therapist', 
    isActive: true 
  });
  
  console.log(`👥 Active therapists: ${allTherapists.length}`);
  
  if (allTherapists.length === 0) {
    console.log('❌ NO ACTIVE THERAPISTS FOUND!');
    return [];
  }
  
  const available = [];
  
  for (const therapist of allTherapists) {
    console.log(`\n👤 Checking ${therapist.name}:`);
    
    if (!hasExpertise(therapist, serviceName)) {
      console.log(`  ❌ No expertise in ${serviceName}`);
      continue;
    }
    console.log(`  ✅ Has expertise`);
    
    const isWorking = await isTherapistWorkingAt(therapist, date, time, durationMinutes);
    if (!isWorking) {
      console.log(`  ❌ Not working at ${time} (schedule/break/grace period conflict)`);
      continue;
    }
    console.log(`  ✅ Is working (no conflicts)`);
    
    const isAvailable = await isTherapistAvailable(
      therapist._id,
      date,
      time,
      durationMinutes
    );
    
    if (!isAvailable) {
      console.log(`  ❌ Already booked`);
      continue;
    }
    console.log(`  ✅ No booking conflict`);
    
    available.push(therapist);
  }
  
  console.log(`\n✅ Total available: ${available.length}`);
  return available;
}

/**
 * Get all booked time slots for a specific date
 */
async function getBookedSlots(date) {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  
  const bookings = await Booking.find({
    date: {
      $gte: startOfDay,
      $lte: endOfDay
    },
    status: { $ne: 'cancelled' }
  }).populate('therapist therapists');
  
  const slots = {};
  
  bookings.forEach(booking => {
    if (!slots[booking.time]) {
      slots[booking.time] = {
        time: booking.time,
        therapistIds: []
      };
    }
    
    if (booking.therapist) {
      slots[booking.time].therapistIds.push(booking.therapist._id.toString());
    }
    if (booking.therapists) {
      booking.therapists.forEach(t => {
        if (!slots[booking.time].therapistIds.includes(t._id.toString())) {
          slots[booking.time].therapistIds.push(t._id.toString());
        }
      });
    }
  });
  
  return Object.values(slots);
}

module.exports = {
  timeToMinutes,
  dateToMinutes,
  minutesToTime,
  calculateEndTimes,
  getPostServiceRest,
  isInBreakTime,
  isInGlobalGracePeriod,
  isTherapistWorkingAt,
  hasExpertise,
  isTherapistAvailable,
  getAvailableTherapists,
  getBookedSlots
};