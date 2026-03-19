// createAdmin.js - Place this in your project root directory
require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// User Schema (inline to avoid import issues)
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  phone: String,
  role: { type: String, enum: ['client', 'therapist', 'admin'], default: 'client' },
  isActive: { type: Boolean, default: true },
  expertise: [String],
  weeklySchedule: [{
    day: String,
    isWorking: Boolean,
    shifts: [{
      startTime: String,
      endTime: String
    }],
    breaks: [{
      label: String,
      startTime: String,
      endTime: String
    }]
  }],
  dateOverrides: [{
    date: Date,
    isWorking: Boolean,
    reason: String,
    shifts: [{
      startTime: String,
      endTime: String
    }]
  }],
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);

async function createAdmin() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    console.log('URI:', process.env.MONGODB_URI);
    
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
    
    // Check if admin exists
    const existingAdmin = await User.findOne({ email: 'admin@nagomi.com' });
    
    if (existingAdmin) {
      console.log('\n⚠️  Admin user already exists!');
      console.log('Email:', existingAdmin.email);
      console.log('Role:', existingAdmin.role);
      console.log('\nIf you forgot the password, delete this user and run this script again.');
      await mongoose.disconnect();
      process.exit(0);
    }
    
    console.log('\n📝 Creating admin user...');
    
    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash('admin123', salt);
    
    // Create admin
    const admin = await User.create({
      name: 'Admin',
      email: 'admin@nagomi.com',
      passwordHash: hashedPassword,
      role: 'admin',
      isActive: true
    });
    
    console.log('\n✅ Admin user created successfully!\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📧 Email:    admin@nagomi.com');
    console.log('🔑 Password: admin123');
    console.log('👤 Role:     admin');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('⚠️  IMPORTANT: Change this password after first login!\n');
    
    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
    process.exit(0);
    
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    console.error('\nFull error:', err);
    await mongoose.disconnect();
    process.exit(1);
  }
}

console.log('🚀 Admin User Creation Script\n');
createAdmin();