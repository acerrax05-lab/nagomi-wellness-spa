const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); // or 'bcrypt'

mongoose.connect('mongodb://localhost:27017/nagomi-spa');

const UserSchema = new mongoose.Schema({}, { strict: false });
const User = mongoose.model('User', UserSchema, 'users');

async function run() {
  const users = await User.find({});
  for (const u of users) {
    const pwd = u.role === 'admin' ? 'admin123' : 'therapist123';
    const hash = await bcrypt.hash(pwd, 10);
    await User.updateOne({ _id: u._id }, { $set: { passwordHash: hash } });
    console.log(`✅ Reset: ${u.email} → ${pwd}`);
  }
  mongoose.disconnect();
}

run().catch(console.error);