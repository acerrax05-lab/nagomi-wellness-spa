// createAdmin.js - Run this script once to create your admin user
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// Import your User model (update path based on your structure)
const User = require('./src/models/User');

// Your MongoDB connection string - check your src/config/db.js for the correct URI
const MONGODB_URI = 'mongodb://localhost:27017/nagomi-wellness'; // Update this if needed

// Admin credentials - CHANGE THESE!
const ADMIN_DATA = {
  name: 'Admin',
  email: 'admin@nagomiwellness.com',
  password: 'Admin123!', // Change this to a secure password
  role: 'admin'
};

async function createAdmin() {
  try {
    // Connect to MongoDB
    await mongoose.connect(MONGODB_URI);
    console.log('Connected to MongoDB');

    // Check if admin already exists
    const existingAdmin = await User.findOne({ 
      email: ADMIN_DATA.email 
    });

    if (existingAdmin) {
      console.log('⚠️  Admin user already exists with this email!');
      console.log('Email:', existingAdmin.email);
      console.log('Name:', existingAdmin.name);
      console.log('\nDeleting old admin and creating new one...');
      await User.deleteOne({ email: ADMIN_DATA.email });
    }

    // Hash the password
    const hashedPassword = await bcrypt.hash(ADMIN_DATA.password, 10);

    // Create admin user
    const admin = new User({
      name: ADMIN_DATA.name,
      email: ADMIN_DATA.email,
      passwordHash: hashedPassword,
      role: ADMIN_DATA.role
    });

    await admin.save();

    console.log('✅ Admin user created successfully!');
    console.log('-----------------------------------');
    console.log('Email:', ADMIN_DATA.email);
    console.log('Password:', ADMIN_DATA.password);
    console.log('-----------------------------------');
    console.log('⚠️  Please change your password after first login!');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating admin:', error.message);
    process.exit(1);
  }
}

// Run the script
createAdmin();