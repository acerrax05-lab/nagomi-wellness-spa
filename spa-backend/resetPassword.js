// resetPassword.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const User = require('./src/models/User');

async function resetPassword() {
  try {
    await mongoose.connect('mongodb://localhost:27017/spa_db');
    console.log('✅ Connected to spa_db\n');

    const email = 'admin@nagomiwellness.com';
    const newPassword = 'admin123';

    

    const user = await User.findOne({ email });
    if (!user) {
      console.log('❌ User not found:', email);
      process.exit(1);
    }

    console.log('👤 Found user:', user.email);

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(newPassword, salt);
    
    console.log('🔐 New hash created:', passwordHash.substring(0, 30) + '...');
    
    user.passwordHash = passwordHash;
    await user.save();

    console.log('✅ Password reset successfully!\n');

    // Verify immediately
    const testMatch = await bcrypt.compare(newPassword, user.passwordHash);
    console.log('🧪 Password verification:', testMatch ? '✅ WORKS!' : '❌ FAILED');

    console.log(`\n📋 Login credentials:`);
    console.log(`   Email: ${email}`);
    console.log(`   Password: ${newPassword}\n`);

    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

resetPassword();