// bulkCreateServices.js - Place this in your spa-backend root folder
const mongoose = require('mongoose');
require('dotenv').config();

async function createServices() {
  try {
    const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/spa_db';
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Define the schema inline to avoid import issues
    const ServiceSchema = new mongoose.Schema({
      name: { type: String, required: true },
      description: String,
      durationMinutes: Number,
      price: Number,
      pricing: {
        type: Map,
        of: Number,
        default: {}
      },
      active: { type: Boolean, default: true }
    });

    const Service = mongoose.model('Service', ServiceSchema);

    const services = [
      {
        name: "Nagomi Massage",
        description: "Traditional Japanese massage therapy combining gentle stretches and pressure points",
        durationMinutes: 60,
        price: 1199,
        pricing: new Map([["60", 1199], ["90", 1499], ["120", 1799]]),
        active: true
      },
      {
        name: "Ventosa or Cupping Therapy",
        description: "Ancient healing technique using suction cups to improve blood flow",
        durationMinutes: 60,
        price: 999,
        pricing: new Map([["60", 999], ["90", 1299], ["120", 1599]]),
        active: true
      },
      {
        name: "Shiatsu Massage",
        description: "Japanese bodywork using finger pressure on specific points",
        durationMinutes: 60,
        price: 1099,
        pricing: new Map([["60", 1099], ["90", 1399], ["120", 1699]]),
        active: true
      },
      {
        name: "Aromatherapy Massage",
        description: "A soothing massage using essential oils to enhance relaxation",
        durationMinutes: 60,
        price: 1299,
        pricing: new Map([["60", 1299], ["90", 1599], ["120", 1899]]),
        active: true
      },
      {
        name: "Combination Massage",
        description: "Blend of multiple massage techniques customized to your needs",
        durationMinutes: 60,
        price: 1399,
        pricing: new Map([["60", 1399], ["90", 1699], ["120", 1999]]),
        active: true
      },
      {
        name: "Ayurvedic Massage",
        description: "Traditional Indian healing massage using warm herbal oils",
        durationMinutes: 60,
        price: 1499,
        pricing: new Map([["60", 1499], ["90", 1799], ["120", 2099]]),
        active: true
      },
      {
        name: "Deep Tissue Massage",
        description: "Focused pressure technique targeting deeper layers of muscle",
        durationMinutes: 60,
        price: 1299,
        pricing: new Map([["60", 1299], ["90", 1599], ["120", 1899]]),
        active: true
      },
      {
        name: "Mandara Massage",
        description: "Luxurious spa treatment inspired by ancient Indonesian healing",
        durationMinutes: 60,
        price: 1399,
        pricing: new Map([["60", 1399], ["90", 1699], ["120", 1999]]),
        active: true
      },
      {
        name: "Pre Natal Massage",
        description: "Gentle massage specially designed for expectant mothers",
        durationMinutes: 60,
        price: 1199,
        pricing: new Map([["60", 1199], ["90", 1499], ["120", 1799]]),
        active: true
      },
      {
        name: "Jade and Lavastone",
        description: "Hot stone therapy using jade and volcanic stones",
        durationMinutes: 60,
        price: 1499,
        pricing: new Map([["60", 1499], ["90", 1799], ["120", 2099]]),
        active: true
      },
      {
        name: "Swedish Massage",
        description: "Classic massage using long, flowing strokes",
        durationMinutes: 60,
        price: 1099,
        pricing: new Map([["60", 1099], ["90", 1399], ["120", 1699]]),
        active: true
      },
      {
        name: "Thai Massage",
        description: "Ancient Thai healing art combining acupressure and stretching",
        durationMinutes: 60,
        price: 1199,
        pricing: new Map([["60", 1199], ["90", 1499], ["120", 1799]]),
        active: true
      }
    ];

    // Clear existing services first (optional)
    await Service.deleteMany({});
    console.log('🗑️  Cleared existing services\n');

    // Insert all services at once
    const result = await Service.insertMany(services);
    
    console.log(`✅ Successfully created ${result.length} services!\n`);
    
    result.forEach((s, i) => {
      console.log(`${i + 1}. ${s.name}`);
      console.log(`   60 min: ₱${s.pricing.get('60')}`);
      console.log(`   90 min: ₱${s.pricing.get('90')}`);
      console.log(`   120 min: ₱${s.pricing.get('120')}`);
      console.log('');
    });

    console.log('🎉 All done!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

createServices();