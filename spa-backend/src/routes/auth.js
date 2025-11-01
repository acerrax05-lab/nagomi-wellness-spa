// src/routes/auth.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const auth = require('../middleware/auth');
const roles = require('../middleware/roles');


const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';

// Register (Sign up)
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    // Basic validation
    if (!name || !email || !password) {
      return res.status(400).json({ msg: 'Please fill all fields' });
    }

    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ msg: 'Email already used' });

    const hash = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      passwordHash: hash,
      role: role || 'client'
    });

    const token = jwt.sign({ id: user._id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

    res.json({ msg: 'User registered successfully', token, user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// Login
// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ msg: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) return res.status(400).json({ msg: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});


// List all users (admin only)
router.get('/users', auth, roles(['admin']), async (req, res) => {
  const users = await User.find({}, 'name email role');
  res.json(users);
});

// Add these routes to src/routes/auth.js

// ✅ Get all therapists (public - for booking form)
router.get('/therapists', async (req, res) => {
  try {
    const therapists = await User.find({ role: 'therapist' }, 'name email phone')
      .sort({ name: 1 });
    res.json(therapists);
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ✅ Get user statistics (admin only)
router.get('/stats', auth, roles(['admin']), async (req, res) => {
  try {
    const totalClients = await User.countDocuments({ role: 'client' });
    const totalTherapists = await User.countDocuments({ role: 'therapist' });
    const totalAdmins = await User.countDocuments({ role: 'admin' });

    res.json({
      clients: totalClients,
      therapists: totalTherapists,
      admins: totalAdmins,
      total: totalClients + totalTherapists + totalAdmins
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

router.put('/users/:id', auth, roles(['admin']), async (req, res) => {
  try {
    const { name, email, phone, role } = req.body;
    
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }
    
    // Update fields
    if (name) user.name = name;
    if (email) user.email = email;
    if (phone) user.phone = phone;
    if (role) user.role = role;
    
    await user.save();
    
    res.json({ msg: 'User updated', user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

// ✅ Delete user (Admin only)
router.delete('/users/:id', auth, roles(['admin']), async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    
    if (!user) {
      return res.status(404).json({ msg: 'User not found' });
    }
    
    res.json({ msg: 'User deleted' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ msg: 'Server error' });
  }
});

module.exports = router;
