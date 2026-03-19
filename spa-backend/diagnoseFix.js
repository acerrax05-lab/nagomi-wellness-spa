/**
 * diagnoseFix.js
 * Run:  node diagnoseFix.js
 * 
 * 1. Shows what's actually in your MongoDB
 * 2. Fixes missing/broken passwordHash on all users
 */

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

// ── Try both common DB names ─────────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/spa_db';

const User = mongoose.model('User', new mongoose.Schema({}, {
  strict: false,
  collection: 'users'
}));

async function run() {
  console.log('🔌 Connecting to:', MONGO_URI);
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected\n');

  const users = await User.find({});
  console.log(`📦 Found ${users.length} user(s) in collection "users":\n`);

  if (users.length === 0) {
    console.log('❌ NO USERS FOUND in this database!');
    console.log('   Your server might be connecting to a different DB.');
    console.log('   Check your .env file for MONGO_URI and try running:');
    console.log('   mongosh --eval "show dbs"');
    await mongoose.disconnect();
    return;
  }

  // Show current state
  for (const u of users) {
    const hasHash = !!u.passwordHash && u.passwordHash.length > 10;
    console.log(`  ${hasHash ? '✅' : '❌'} ${(u.role||'?').padEnd(10)} | ${(u.email||'?').padEnd(32)} | hash: ${hasHash ? 'OK' : 'MISSING/BROKEN'}`);
  }

  // Fix all passwords
  console.log('\n🔧 Resetting all passwords...\n');
  for (const u of users) {
    const pwd = u.role === 'admin' ? 'admin123' : 'therapist123';
    const hash = await bcrypt.hash(pwd, 10);
    await User.updateOne({ _id: u._id }, { $set: { passwordHash: hash } });
    console.log(`  ✅ ${(u.email||'?').padEnd(32)} → "${pwd}"`);
  }

  console.log('\n🎉 Done! Try logging in now:');
  console.log('   admin@nagomi.com   →  admin123');
  console.log('   (any therapist)    →  therapist123');

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('\n❌ Failed:', err.message);
  if (err.message.includes('ECONNREFUSED')) {
    console.error('   MongoDB is not running. Start it with: mongod');
  }
  process.exit(1);
});