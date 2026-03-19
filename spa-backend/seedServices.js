// seeds/seedServices.js
// Run with: node seeds/seedServices.js
// Seeds ALL services from the Nagomi Wellness Spa menu

const mongoose = require('mongoose');
require('dotenv').config();

const ServiceSchema = new mongoose.Schema({
  name:             { type: String, required: true },
  description:      { type: String },
  category:         { type: String, required: true },
  price:            { type: Number },
  pricing:          { type: Map, of: Number },   // { "60": 679, "90": 979, "120": 1279 }
  allowedDurations: [Number],
  fixedDuration:    { type: Number },             // e.g. 60 for fixed-price services
  active:           { type: Boolean, default: true },
  bookingCount:     { type: Number, default: 0 },
  averageRating:    { type: Number, default: 0 },
  isPackage:        { type: Boolean, default: false },
  isCouplePkg:      { type: Boolean, default: false },
}, { timestamps: true });

ServiceSchema.methods.incrementBookingCount = async function () {
  this.bookingCount += 1;
  return this.save();
};

const Service = mongoose.models.Service || mongoose.model('Service', ServiceSchema);

const SERVICES = [
  // ─── MASSAGE SERVICES ────────────────────────────────────────────────────────
  {
    name: 'Nagomi Massage',
    description: 'A specialized treatment that combines a unique technique to fully relax your body and mind.',
    category: 'Massage Services',
    pricing: { 90: 949, 120: 1259 },
    allowedDurations: [90, 120],
  },
  {
    name: 'Deep Tissue Massage',
    description: 'This concentrates on the deep layer of muscles and fascia in the body.',
    category: 'Massage Services',
    pricing: { 60: 679, 90: 979, 120: 1279 },
    allowedDurations: [60, 90, 120],
  },
  {
    name: 'Aromatherapy Massage',
    description: 'Makes use of essential oils for deep relaxation and rejuvenation.',
    category: 'Massage Services',
    pricing: { 60: 659, 90: 959, 120: 1269 },
    allowedDurations: [60, 90, 120],
  },
  {
    name: 'Jade and Lavastone',
    description: 'Makes use of protective stones to heal stressed organs and discharge toxins.',
    category: 'Massage Services',
    pricing: { 60: 999, 90: 1299, 120: 1699 },
    allowedDurations: [60, 90, 120],
  },
  {
    name: 'Ventosa or Cupping Therapy',
    description: 'An alternative medicine that improves blood flow and overall health.',
    category: 'Massage Services',
    pricing: { 60: 999, 90: 1299, 120: 1699 },
    allowedDurations: [60, 90, 120],
  },
  {
    name: 'Ayurvedic Massage',
    description: 'Uses natural coconut oil for prevention of diseases, strong muscles and natural smooth skin.',
    category: 'Massage Services',
    pricing: { 60: 659, 90: 949, 120: 1259 },
    allowedDurations: [60, 90, 120],
  },
  {
    name: 'Shiatsu Massage',
    description: 'Reduces tension and re-energizes the body. It uses acupressure to release tension and brings balance to the body.',
    category: 'Massage Services',
    pricing: { 60: 669, 90: 969, 120: 1259 },
    allowedDurations: [60, 90, 120],
  },
  {
    name: 'Combination Massage',
    description: 'A combination of effleurage technique and pressure points to release the soreness.',
    category: 'Massage Services',
    pricing: { 60: 649, 90: 949, 120: 1249 },
    allowedDurations: [60, 90, 120],
  },
  {
    name: 'Pre Natal Massage',
    description: 'An essential massage designed to care for pregnant women as you lay on your side supported by a pillow. Gentle techniques and stretches help relieve tension and fatigue.',
    category: 'Massage Services',
    pricing: { 60: 699, 90: 999, 120: 1299 },
    allowedDurations: [60, 90, 120],
  },
  {
    name: 'Mandara Massage',
    description: 'Helps eliminate stress and fatigue from work, sports or travel (four-handed massage).',
    category: 'Massage Services',
    pricing: { 60: 1299, 90: 1849, 120: 2499 },
    allowedDurations: [60, 90, 120],
  },
  {
    name: 'Swedish Massage',
    description: 'Uses light and firm touch, tapping, kneading, and friction to relax the muscles and increase bloodflow.',
    category: 'Massage Services',
    pricing: { 60: 639, 90: 939, 120: 1249 },
    allowedDurations: [60, 90, 120],
  },
  {
    name: 'Thai Massage',
    description: 'Uses light and firm touch, tapping, kneading, and friction to relax the muscles and increase bloodflow.',
    category: 'Massage Services',
    pricing: { 60: 729, 90: 1099, 120: 1399 },
    allowedDurations: [60, 90, 120],
  },

  // ─── SPOT MASSAGE ────────────────────────────────────────────────────────────
  {
    name: 'Back Massage',
    description: 'Focused massage targeting back muscles for tension relief.',
    category: 'Spot Massage',
    pricing: { 30: 350, 60: 699 },
    allowedDurations: [30, 60],
  },
  {
    name: 'Facial Massage',
    description: 'Relaxing facial massage for tension relief and improved circulation.',
    category: 'Spot Massage',
    pricing: { 30: 350, 60: 699 },
    allowedDurations: [30, 60],
  },
  {
    name: 'Head Massage',
    description: 'Soothing head massage to relieve stress and tension.',
    category: 'Spot Massage',
    pricing: { 30: 350, 60: 699 },
    allowedDurations: [30, 60],
  },
  {
    name: 'Head and Neck Massage',
    description: 'Combined head and neck massage for complete upper-body tension relief.',
    category: 'Spot Massage',
    pricing: { 30: 350, 60: 699 },
    allowedDurations: [30, 60],
  },
  {
    name: 'Foot and Hand Massage',
    description: 'Reflexology foot and hand massage for full relaxation.',
    category: 'Spot Massage',
    pricing: { 30: 350, 60: 699 },
    allowedDurations: [30, 60],
  },

  // ─── FOOT TREATMENT ──────────────────────────────────────────────────────────
  {
    name: 'Foot Spa',
    description: 'Soothing foot spa treatment for tired and aching feet.',
    category: 'Foot & Hand Treatment',
    price: 499,
    fixedDuration: 60,
    allowedDurations: [60],
  },
  {
    name: 'Foot Spa w/ Paraffin',
    description: 'Foot spa treatment with nourishing paraffin wax for extra moisturization.',
    category: 'Foot & Hand Treatment',
    price: 799,
    fixedDuration: 60,
    allowedDurations: [60],
  },
  {
    name: 'Hands Spa',
    description: 'Relaxing hands spa treatment for soft, smooth hands.',
    category: 'Foot & Hand Treatment',
    price: 499,
    fixedDuration: 60,
    allowedDurations: [60],
  },
  {
    name: 'Hands Spa w/ Paraffin',
    description: 'Hands spa with paraffin wax for intense moisturization.',
    category: 'Foot & Hand Treatment',
    price: 799,
    fixedDuration: 60,
    allowedDurations: [60],
  },

  // ─── BODY SCRUB ──────────────────────────────────────────────────────────────
  {
    name: 'Coconut Body Scrub',
    description: 'Natural coconut body scrub for smooth, radiant skin.',
    category: 'Body Scrub',
    price: 799,
    fixedDuration: 60,
    allowedDurations: [60],
  },
  {
    name: 'Apricot Body Scrub',
    description: 'Gentle apricot exfoliating scrub for a refreshed glow.',
    category: 'Body Scrub',
    price: 999,
    fixedDuration: 60,
    allowedDurations: [60],
  },
  {
    name: 'Whitening Body Scrub',
    description: 'Brightening whitening scrub treatment for even skin tone.',
    category: 'Body Scrub',
    price: 899,
    fixedDuration: 60,
    allowedDurations: [60],
  },
  {
    name: 'Whitening w/ Milk Massage',
    description: 'Whitening scrub combined with luxurious milk massage.',
    category: 'Body Scrub',
    price: 1199,
    fixedDuration: 60,
    allowedDurations: [60],
  },
  {
    name: "Vegie's Body Scrub",
    description: 'Vegetable-based natural body scrub treatment.',
    category: 'Body Scrub',
    price: 899,
    fixedDuration: 60,
    allowedDurations: [60],
  },
  {
    name: 'Strawberry Body Scrub',
    description: 'Sweet and refreshing strawberry exfoliating scrub.',
    category: 'Body Scrub',
    price: 799,
    fixedDuration: 60,
    allowedDurations: [60],
  },
  {
    name: 'Coffee Body Scrub',
    description: 'Energizing coffee body scrub for smooth, toned skin.',
    category: 'Body Scrub',
    price: 799,
    fixedDuration: 60,
    allowedDurations: [60],
  },
  {
    name: 'Dead Sea Salt Body Scrub',
    description: 'Mineral-rich Dead Sea salt exfoliation for deep cleansing.',
    category: 'Body Scrub',
    price: 899,
    fixedDuration: 60,
    allowedDurations: [60],
  },
  {
    name: 'Oatmeal Body Scrub',
    description: 'Gentle nourishing oatmeal scrub for sensitive skin.',
    category: 'Body Scrub',
    price: 799,
    fixedDuration: 60,
    allowedDurations: [60],
  },
  {
    name: 'Chocolate Body Scrub',
    description: 'Antioxidant-rich indulgent chocolate scrub for glowing skin.',
    category: 'Body Scrub',
    price: 999,
    fixedDuration: 60,
    allowedDurations: [60],
  },

  // ─── FACIAL TREATMENT ────────────────────────────────────────────────────────
  {
    name: 'Nagomi Facial',
    description: 'Our signature comprehensive facial treatment for deep cleansing and rejuvenation.',
    category: 'Facial Treatment',
    price: 999,
    fixedDuration: 60,
    allowedDurations: [60],
  },
  {
    name: 'Rejuvenate Facial',
    description: 'Revitalizing facial to restore a youthful, radiant glow.',
    category: 'Facial Treatment',
    price: 899,
    fixedDuration: 60,
    allowedDurations: [60],
  },
  {
    name: 'Age Defying Facial',
    description: 'Anti-aging facial for firmer, younger-looking skin.',
    category: 'Facial Treatment',
    price: 899,
    fixedDuration: 60,
    allowedDurations: [60],
  },
  {
    name: 'Basic Facial',
    description: 'Essential cleansing and rejuvenating facial for all skin types.',
    category: 'Facial Treatment',
    price: 499,
    fixedDuration: 60,
    allowedDurations: [60],
  },
  {
    name: 'Teen Age Facial',
    description: 'Specially designed facial for teenage skin concerns.',
    category: 'Facial Treatment',
    price: 799,
    fixedDuration: 60,
    allowedDurations: [60],
  },
  {
    name: 'Diamond Peel',
    description: 'Advanced diamond-tip microdermabrasion treatment for skin resurfacing.',
    category: 'Facial Treatment',
    price: 1099,
    fixedDuration: 60,
    allowedDurations: [60],
  },
  {
    name: 'Facial w/ Lazer',
    description: 'Facial combined with laser treatment for enhanced results.',
    category: 'Facial Treatment',
    price: 949,
    fixedDuration: 60,
    allowedDurations: [60],
  },
  {
    name: 'Warts Removal',
    description: 'Professional warts removal treatment. Price varies — please inquire at the spa.',
    category: 'Facial Treatment',
    price: 0,
    fixedDuration: 60,
    allowedDurations: [60],
  },

  // ─── PACKAGES ────────────────────────────────────────────────────────────────
  {
    name: 'Refreshing Mask + Massage',
    description: 'Refreshing mask treatment combined with a full 60-minute massage.',
    category: 'Packages',
    price: 799,
    fixedDuration: 60,
    allowedDurations: [60],
    isPackage: true,
  },
  {
    name: 'Ear Candle + Massage',
    description: 'Soothing ear candle treatment paired with a relaxing 60-minute massage.',
    category: 'Packages',
    price: 899,
    fixedDuration: 60,
    allowedDurations: [60],
    isPackage: true,
  },
  {
    name: 'Basic Facial + Massage',
    description: 'Classic basic facial combined with a full body massage.',
    category: 'Packages',
    price: 999,
    fixedDuration: 60,
    allowedDurations: [60],
    isPackage: true,
  },
  {
    name: 'Foot Spa + Basic Facial',
    description: 'Foot spa treatment and basic facial for a complete refresh.',
    category: 'Packages',
    price: 999,
    fixedDuration: 60,
    allowedDurations: [60],
    isPackage: true,
  },
  {
    name: 'Foot Spa + Massage',
    description: 'Relaxing foot spa followed by a full 60-minute body massage.',
    category: 'Packages',
    price: 1099,
    fixedDuration: 60,
    allowedDurations: [60],
    isPackage: true,
  },
  {
    name: 'Coffee or Coconut Scrub + Massage',
    description: 'Exfoliating coffee or coconut body scrub combined with a massage.',
    category: 'Packages',
    price: 1299,
    fixedDuration: 60,
    allowedDurations: [60],
    isPackage: true,
  },
  {
    name: 'Tummy Wrap + Backpack + Refreshing Mask + Massage',
    description: 'Full detox and relaxation package including tummy wrap, backpack, refreshing mask, and massage.',
    category: 'Packages',
    price: 1399,
    fixedDuration: 60,
    allowedDurations: [60],
    isPackage: true,
  },
  {
    name: 'Oatmeal/Dead Sea Salt Scrub + Massage',
    description: 'Nourishing oatmeal or Dead Sea salt scrub treatment with a full massage.',
    category: 'Packages',
    price: 1429,
    fixedDuration: 60,
    allowedDurations: [60],
    isPackage: true,
  },
  {
    name: 'Whitening Scrub + Massage',
    description: 'Brightening whitening scrub combined with a relaxing body massage.',
    category: 'Packages',
    price: 1529,
    fixedDuration: 60,
    allowedDurations: [60],
    isPackage: true,
  },
  {
    name: 'Scrub + Massage',
    description: 'Full body exfoliating scrub and massage combination for total rejuvenation.',
    category: 'Packages',
    price: 1749,
    fixedDuration: 60,
    allowedDurations: [60],
    isPackage: true,
  },
  {
    name: 'Body Scrub + Basic Facial + Massage',
    description: 'Body scrub, basic facial, and massage — the ultimate triple combination.',
    category: 'Packages',
    price: 1899,
    fixedDuration: 60,
    allowedDurations: [60],
    isPackage: true,
  },
  {
    name: 'Body Scrub + Foot Spa + Massage',
    description: 'Body scrub, foot spa, and massage for full-body pampering.',
    category: 'Packages',
    price: 2099,
    fixedDuration: 60,
    allowedDurations: [60],
    isPackage: true,
  },
  {
    name: 'Body Scrub + Foot Spa + Basic Facial + Massage',
    description: 'Complete pampering package combining all four premium treatments.',
    category: 'Packages',
    price: 2399,
    fixedDuration: 60,
    allowedDurations: [60],
    isPackage: true,
  },
  {
    name: 'Stone Massage + Body Scrub + Foot Spa + Basic Facial',
    description: 'Ultimate luxury package featuring stone massage, body scrub, foot spa, and basic facial.',
    category: 'Packages',
    price: 2699,
    fixedDuration: 60,
    allowedDurations: [60],
    isPackage: true,
  },

  // ─── COUPLE PACKAGES ─────────────────────────────────────────────────────────
  {
    name: 'Bronze Couple Package',
    description: 'For 2: Ear Candle + Basic Facial + 23-in-1 Herbs Juice + Massage. A wonderful intro couple experience.',
    category: 'Couple Packages',
    price: 2799,
    fixedDuration: 60,
    allowedDurations: [60],
    isPackage: true,
    isCouplePkg: true,
  },
  {
    name: 'Silver Couple Package',
    description: 'For 2: Backpack + Ear Candle + 23-in-1 Herbs Juice + Massage. Perfect for a relaxing couple day.',
    category: 'Couple Packages',
    price: 2899,
    fixedDuration: 60,
    allowedDurations: [60],
    isPackage: true,
    isCouplePkg: true,
  },
  {
    name: 'Gold Couple Package',
    description: 'For 2: Tummy Wrap + Refreshing Mask + 23-in-1 Herbs Juice + Massage. Premium couple relaxation.',
    category: 'Couple Packages',
    price: 2999,
    fixedDuration: 60,
    allowedDurations: [60],
    isPackage: true,
    isCouplePkg: true,
  },
  {
    name: 'Harmony Couple Package',
    description: 'For 2: Body Scrub + Refreshing Mask + 23-in-1 Herbs Juice + Massage. Harmony for two.',
    category: 'Couple Packages',
    price: 3599,
    fixedDuration: 60,
    allowedDurations: [60],
    isPackage: true,
    isCouplePkg: true,
  },
  {
    name: 'Restorative Day Couple Package',
    description: 'For 2: Body Scrub + Basic Facial + 23-in-1 Herbs Juice + Massage. A full restorative day for couples.',
    category: 'Couple Packages',
    price: 3799,
    fixedDuration: 60,
    allowedDurations: [60],
    isPackage: true,
    isCouplePkg: true,
  },
  {
    name: 'Couples Retreat Package',
    description: 'For 2: Body Scrub + Foot Spa + 23-in-1 Herbs Juice + Massage. The ultimate couples retreat experience.',
    category: 'Couple Packages',
    price: 3899,
    fixedDuration: 60,
    allowedDurations: [60],
    isPackage: true,
    isCouplePkg: true,
  },
];

async function seedServices() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/nagomi-spa');
    console.log('✅ Connected to MongoDB');

    // Optional: clear existing services first
    const existing = await Service.countDocuments();
    if (existing > 0) {
      console.log(`⚠️  Found ${existing} existing services. Skipping duplicates...`);
    }

    let added = 0;
    for (const svc of SERVICES) {
      const exists = await Service.findOne({ name: svc.name });
      if (!exists) {
        await Service.create(svc);
        console.log(`  ✅ Added: ${svc.name}`);
        added++;
      } else {
        // Update existing service with new fields (isPackage, isCouplePkg, etc.)
        await Service.findByIdAndUpdate(exists._id, {
          $set: {
            description: svc.description,
            category: svc.category,
            price: svc.price,
            pricing: svc.pricing,
            allowedDurations: svc.allowedDurations,
            fixedDuration: svc.fixedDuration,
            isPackage: svc.isPackage || false,
            isCouplePkg: svc.isCouplePkg || false,
          }
        });
        console.log(`  🔄 Updated: ${svc.name}`);
      }
    }

    console.log(`\n🎉 Seeding complete! Added ${added} new services.`);
    console.log(`📊 Total services: ${await Service.countDocuments()}`);
    
    // Show breakdown by category
    const cats = await Service.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { _id: 1 } }
    ]);
    console.log('\n📋 Services by category:');
    cats.forEach(c => console.log(`   ${c._id}: ${c.count}`));

    process.exit(0);
  } catch (err) {
    console.error('❌ Seed error:', err);
    process.exit(1);
  }
}

seedServices();