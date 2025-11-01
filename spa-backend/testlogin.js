// testLogin.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const User = require('./src/models/User');

async function testLogin() {
  try {
    await mongoose.connect('mongodb://localhost:27017/spa_db');
    console.log('✅ Connected to spa_db\n');

    // Test with the admin user
    const email = 'admin@nagomi.com';
    const password = 'admin123'; // Try different passwords if this doesn't work

    const user = await User.findOne({ email });
    
    if (!user) {
      console.log('❌ User not found:', email);
      process.exit(1);
    }

    console.log('👤 User found:', user.email);
    console.log('🔑 Role:', user.role);
    console.log('📝 Password hash exists:', user.passwordHash ? 'YES' : 'NO');
    console.log('📝 Password hash length:', user.passwordHash ? user.passwordHash.length : 0);
    console.log('📝 First 30 chars:', user.passwordHash ? user.passwordHash.substring(0, 30) : 'N/A');
    console.log('\n🧪 Testing passwords...\n');

    // Test multiple possible passwords
    const testPasswords = ['admin123', 'Admin123', 'password', '123456', 'admin'];
    
    for (const testPass of testPasswords) {
      try {
        const isMatch = await bcrypt.compare(testPass, user.passwordHash);
        console.log(`   "${testPass}" → ${isMatch ? '✅ MATCH!' : '❌ No match'}`);
        if (isMatch) {
          console.log(`\n🎉 SUCCESS! Password is: "${testPass}"\n`);
        }
      } catch (err) {
        console.log(`   "${testPass}" → ❌ Error: ${err.message}`);
      }
    }

    console.log('\n💡 If none matched, the password might be different.');
    console.log('   Run: node resetPassword.js to set a new password\n');

    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

testLogin();