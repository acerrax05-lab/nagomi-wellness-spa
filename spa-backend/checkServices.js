// checkServices.js
const mongoose = require('mongoose');
require('dotenv').config();

const Service = require('./src/models/Service');

async function checkServices() {
  try {
    const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/spa_db';
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    const services = await Service.find();
    
    if (services.length === 0) {
      console.log('❌ No services found in database!');
      console.log('   Run: node bulkCreateServices.js\n');
    } else {
      console.log(`✅ Found ${services.length} services:\n`);
      services.forEach((s, index) => {
        console.log(`${index + 1}. "${s.name}"`);
        console.log(`   ID: ${s._id}`);
        console.log(`   Active: ${s.active}`);
        if (s.pricing) {
          const pricing = s.pricing.toObject ? s.pricing.toObject() : s.pricing;
          console.log(`   Pricing: 60min=₱${pricing[60] || pricing['60']} | 90min=₱${pricing[90] || pricing['90']} | 120min=₱${pricing[120] || pricing['120']}`);
        }
        console.log('');
      });
    }

    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err);
    process.exit(1);
  }
}

checkServices();