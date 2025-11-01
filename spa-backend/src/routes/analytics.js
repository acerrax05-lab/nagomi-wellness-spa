const express = require('express');
const router = express.Router();
const Booking = require('../models/Booking');
const User = require('../models/User');
const auth = require('../middleware/auth');
const roles = require('../middleware/roles');

// ✅ Get analytics data for admin dashboard
router.get('/dashboard', auth, roles(['admin']), async (req, res) => {
  try {
    const { period = 'today' } = req.query;
    
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    let dateFilter = {};
    
    switch(period) {
      case 'today':
        dateFilter = { date: { $gte: today } };
        break;
      case 'week':
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        dateFilter = { date: { $gte: weekAgo } };
        break;
      case 'month':
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        dateFilter = { date: { $gte: monthStart } };
        break;
      case 'year':
        const yearStart = new Date(now.getFullYear(), 0, 1);
        dateFilter = { date: { $gte: yearStart } };
        break;
    }
    
    const bookings = await Booking.find(dateFilter)
      .populate('service', 'name price')
      .populate('client', 'name')
      .populate('therapist', 'name');
    
    // Calculate stats
    const stats = {
      totalBookings: bookings.length,
      completed: bookings.filter(b => b.status === 'completed').length,
      pending: bookings.filter(b => b.status === 'pending').length,
      cancelled: bookings.filter(b => b.status === 'cancelled').length,
      revenue: bookings
        .filter(b => b.status === 'completed')
        .reduce((sum, b) => sum + (b.price || 0), 0),
      loss: bookings
        .filter(b => b.status === 'cancelled')
        .reduce((sum, b) => sum + (b.price || 0), 0)
    };
    
    res.json({ stats, bookings });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;