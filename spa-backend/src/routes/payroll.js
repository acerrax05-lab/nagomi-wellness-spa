// src/routes/payroll.js
// ─────────────────────────────────────────────────────────────────────────
// Mount in server.js:  app.use('/api/payroll', require('./routes/payroll'));
//
// Endpoints:
//   GET  /api/payroll/my-summary          → therapist's own commission summary
//   GET  /api/payroll/my-history          → therapist's pay period breakdown
//   GET  /api/payroll/all                 → admin: all therapists payroll
//   PUT  /api/payroll/settings/:userId    → admin: update pay schedule / commission rate
// ─────────────────────────────────────────────────────────────────────────
const express    = require('express');
const router     = express.Router();
const mongoose   = require('mongoose');
const User       = require('../models/User');
const Booking    = require('../models/Booking');
const authMiddleware = require('../middleware/auth');   // your existing JWT middleware

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Returns the start and end of the current pay period for a therapist.
 * semi-monthly: either the 1st–15th or 16th–end-of-month
 * weekly:       Monday–Sunday of the current week
 */
function getCurrentPayPeriod(paySchedule) {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth();
  const day   = now.getDate();

  if (paySchedule === 'weekly') {
    // Find Monday of current week
    const monday = new Date(now);
    monday.setDate(day - ((now.getDay() + 6) % 7));   // JS: 0=Sun, 1=Mon...
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { start: monday, end: sunday };
  }

  // semi-monthly
  let start, end;
  if (day <= 15) {
    start = new Date(year, month, 1, 0, 0, 0);
    end   = new Date(year, month, 15, 23, 59, 59);
  } else {
    start = new Date(year, month, 16, 0, 0, 0);
    end   = new Date(year, month + 1, 0, 23, 59, 59);  // last day of month
  }
  return { start, end };
}

/**
 * Returns the date of the next pay day.
 */
function getNextPayDate(paySchedule) {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth();
  const day   = now.getDate();

  if (paySchedule === 'weekly') {
    // Next Friday
    const daysUntilFriday = (5 - now.getDay() + 7) % 7 || 7;
    const nextFriday = new Date(now);
    nextFriday.setDate(day + daysUntilFriday);
    nextFriday.setHours(0, 0, 0, 0);
    return nextFriday;
  }

  // semi-monthly: if before the 15th → pay on the 15th; else → last day of month
  if (day < 15) {
    return new Date(year, month, 15);
  } else if (day === 15) {
    return new Date(year, month, 15);  // today is pay day
  } else {
    return new Date(year, month + 1, 0);   // last day of this month
  }
}

/**
 * Summarise completed bookings for a therapist in a date range.
 */
async function getEarningsInPeriod(therapistId, start, end, commissionRate) {
  const bookings = await Booking.find({
    $or: [{ therapist: therapistId }, { therapists: therapistId }],
    status: 'completed',
    date:   { $gte: start, $lte: end },
  })
  .populate('service', 'name category')
  .lean();

  const totalRevenue   = bookings.reduce((sum, b) => sum + (b.price || 0), 0);
  const commissionEarned = Math.round(totalRevenue * (commissionRate / 100));

  return { bookings, totalRevenue, commissionEarned, count: bookings.length };
}

// ── GET /api/payroll/my-summary  (therapist auth required) ───────────────
router.get('/my-summary', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'therapist') {
      return res.status(403).json({ msg: 'Therapists only' });
    }

    const therapist = await User.findById(req.user.id).lean();
    if (!therapist) return res.status(404).json({ msg: 'User not found' });

    const { start, end } = getCurrentPayPeriod(therapist.paySchedule);
    const nextPayDate     = getNextPayDate(therapist.paySchedule);
    const earnings        = await getEarningsInPeriod(
      therapist._id, start, end, therapist.commissionRate
    );

    // Also compute this month's total
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const monthEnd   = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0, 23, 59, 59);
    const monthlyEarnings = await getEarningsInPeriod(
      therapist._id, monthStart, monthEnd, therapist.commissionRate
    );

    res.json({
      therapist: {
        name:           therapist.name,
        commissionRate: therapist.commissionRate,
        paySchedule:    therapist.paySchedule,
        payrollNotes:   therapist.payrollNotes,
      },
      currentPeriod: {
        start,
        end,
        nextPayDate,
        ...earnings,
      },
      thisMonth: {
        start: monthStart,
        end:   monthEnd,
        ...monthlyEarnings,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});

// ── GET /api/payroll/my-history  (therapist auth required) ───────────────
// Returns last 6 pay periods with earnings
router.get('/my-history', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'therapist') {
      return res.status(403).json({ msg: 'Therapists only' });
    }

    const therapist = await User.findById(req.user.id).lean();
    if (!therapist) return res.status(404).json({ msg: 'User not found' });

    const periods = [];
    const now     = new Date();

    if (therapist.paySchedule === 'weekly') {
      // Last 8 weeks
      for (let w = 0; w < 8; w++) {
        const monday = new Date(now);
        monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) - (w * 7));
        monday.setHours(0, 0, 0, 0);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        sunday.setHours(23, 59, 59, 999);
        periods.push({ start: monday, end: sunday, label: `Week of ${monday.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}` });
      }
    } else {
      // Last 6 semi-monthly periods
      for (let p = 0; p < 6; p++) {
        const offsetMonths = Math.floor(p / 2);
        const isFirstHalf  = (p % 2) === 0;
        const y = now.getMonth() - offsetMonths < 0
          ? now.getFullYear() - 1
          : now.getFullYear();
        const m = ((now.getMonth() - offsetMonths) + 12) % 12;

        let start, end, label;
        if (isFirstHalf) {
          start = new Date(y, m, 1);
          end   = new Date(y, m, 15, 23, 59, 59);
          label = `${start.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' })} (1–15)`;
        } else {
          start = new Date(y, m, 16);
          end   = new Date(y, m + 1, 0, 23, 59, 59);
          label = `${start.toLocaleDateString('en-PH', { month: 'short', year: 'numeric' })} (16–end)`;
        }
        periods.push({ start, end, label });
      }
    }

    const history = await Promise.all(
      periods.map(async ({ start, end, label }) => {
        const earnings = await getEarningsInPeriod(therapist._id, start, end, therapist.commissionRate);
        return { label, start, end, ...earnings };
      })
    );

    res.json({
      paySchedule:    therapist.paySchedule,
      commissionRate: therapist.commissionRate,
      history,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});

// ── GET /api/payroll/all  (admin only) ────────────────────────────────────
router.get('/all', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ msg: 'Admin only' });
    }

    const therapists = await User.find({ role: 'therapist', isActive: true }).lean();

    const results = await Promise.all(therapists.map(async t => {
      const { start, end } = getCurrentPayPeriod(t.paySchedule);
      const nextPayDate     = getNextPayDate(t.paySchedule);
      const earnings        = await getEarningsInPeriod(t._id, start, end, t.commissionRate);
      return {
        _id:            t._id,
        name:           t.name,
        email:          t.email,
        paySchedule:    t.paySchedule,
        commissionRate: t.commissionRate,
        payrollNotes:   t.payrollNotes,
        nextPayDate,
        currentPeriod:  { start, end, ...earnings },
      };
    }));

    res.json(results);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});

// ── PUT /api/payroll/settings/:userId  (admin only) ───────────────────────
router.put('/settings/:userId', authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ msg: 'Admin only' });
    }

    const { paySchedule, commissionRate, payrollNotes } = req.body;
    const updates = {};
    if (paySchedule)    updates.paySchedule    = paySchedule;
    if (commissionRate !== undefined) updates.commissionRate = commissionRate;
    if (payrollNotes !== undefined)   updates.payrollNotes   = payrollNotes;

    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { $set: updates },
      { new: true, select: 'name email paySchedule commissionRate payrollNotes' }
    );

    if (!user) return res.status(404).json({ msg: 'User not found' });

    res.json({ msg: 'Pay settings updated', user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error', error: err.message });
  }
});

module.exports = router;