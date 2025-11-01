// checkUsers.js - in spa-backend root
const mongoose = require('mongoose');
require('dotenv').config();

const User = require('./src/models/User');

async function checkUsers() {
  try {
    const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/spa_db';
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const users = await User.find();
    
    if (users.length === 0) {
      console.log('❌ No users found in database!\n');
    } else {
      console.log(`✅ Found ${users.length} users:\n`);
      users.forEach((u, index) => {
        console.log(`${index + 1}. Name: ${u.name}`);
        console.log(`   Email: ${u.email}`);
        console.log(`   Role: ${u.role}`);
        console.log(`   Password Hash: ${u.passwordHash ? 'EXISTS' : 'MISSING'}`);
        console.log(`   Password Hash (first 20 chars): ${u.passwordHash ? u.passwordHash.substring(0, 20) : 'N/A'}`);
        console.log('');
      });
    }

    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

checkUsers();
