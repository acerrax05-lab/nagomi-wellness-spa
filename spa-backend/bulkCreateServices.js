/**
 * bulkCreateServices.js
 * =====================================================================
 * Upserts ALL Nagomi Wellness Spa services into MongoDB.
 *
 * Covers:
 *   ✔ Massage Services     (12 services, duration-based pricing)
 *   ✔ Foot Treatment       (4 services, fixed price)
 *   ✔ Spot Massage         (5 services, 30 or 60 min pricing)
 *   ✔ Body Scrub           (10 services, fixed price)
 *   ✔ Facial Treatment     (8 services, fixed price)
 *   ✔ Packages             (14 packages, fixed price 60 min)
 *   ✔ Couples Packages     (6 packages, fixed price 60 min)
 *
 * HOW TO RUN:
 *   cd D:\Nagomi-Wellness-Spa\spa-backend
 *   node bulkCreateServices.js
 *
 * SAFE TO RE-RUN — uses upsert (updateOne + upsert:true) so it
 * will not duplicate existing entries, only update prices/fields.
 * =====================================================================
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI =
  process.env.MONGO_URI ||
  process.env.MONGODB_URI ||
  'mongodb://localhost:27017/nagomi';

// ─── SERVICE DEFINITIONS ─────────────────────────────────────────────────────

const ALL_SERVICES = [

  // ══════════════════════════════════════════════════════════════════
  //  MASSAGE SERVICES  (duration-based, 60 / 90 / 120 min)
  // ══════════════════════════════════════════════════════════════════
  {
    name: 'Deep Tissue Massage',
    description: 'Concentrates on the deep layer of muscles and fascia in the body.',
    category: 'Massage Services',
    isFixedPrice: false,
    allowedDurations: [60, 90, 120],
    pricing: { 60: 679, 90: 979, 120: 1279 },
    price: 679,
    durationMinutes: 60,
  },
  {
    name: 'Nagomi Massage',
    description: 'A specialized treatment that combines a unique technique to fully relax your body and mind.',
    category: 'Massage Services',
    isFixedPrice: false,
    allowedDurations: [90, 120],          // no 60-min option per menu
    pricing: { 90: 949, 120: 1259 },
    price: 949,
    durationMinutes: 90,
  },
  {
    name: 'Aromatherapy Massage',
    description: 'Makes use of essential oils to relax and rejuvenate the body.',
    category: 'Massage Services',
    isFixedPrice: false,
    allowedDurations: [60, 90, 120],
    pricing: { 60: 659, 90: 959, 120: 1269 },
    price: 659,
    durationMinutes: 60,
  },
  {
    name: 'Jade and Lavastone Massage',
    description: 'Makes use of protective stones to heal stressed organs and discharge toxins.',
    category: 'Massage Services',
    isFixedPrice: false,
    allowedDurations: [60, 90, 120],
    pricing: { 60: 999, 90: 1299, 120: 1699 },
    price: 999,
    durationMinutes: 60,
  },
  {
    name: 'Ventosa or Cupping Therapy',
    description: 'An alternative medicine that improves blood flow and overall health.',
    category: 'Massage Services',
    isFixedPrice: false,
    allowedDurations: [60, 90, 120],
    pricing: { 60: 999, 90: 1299, 120: 1699 },
    price: 999,
    durationMinutes: 60,
  },
  {
    name: 'Ayurvedic Massage',
    description: 'Use natural coconut oil for prevention of diseases, strong muscles and natural smooth skin.',
    category: 'Massage Services',
    isFixedPrice: false,
    allowedDurations: [60, 90, 120],
    pricing: { 60: 659, 90: 949, 120: 1259 },
    price: 659,
    durationMinutes: 60,
  },
  {
    name: 'Shiatsu Massage',
    description: 'Reduces tension and re-energizes the body. Uses acupressure to release tension and bring balance.',
    category: 'Massage Services',
    isFixedPrice: false,
    allowedDurations: [60, 90, 120],
    pricing: { 60: 669, 90: 969, 120: 1259 },
    price: 669,
    durationMinutes: 60,
  },
  {
    name: 'Combination Massage',
    description: 'A combination of effleurage technique and pressure points to release soreness.',
    category: 'Massage Services',
    isFixedPrice: false,
    allowedDurations: [60, 90, 120],
    pricing: { 60: 649, 90: 949, 120: 1249 },
    price: 649,
    durationMinutes: 60,
  },
  {
    name: 'Pre Natal Massage',
    description: 'An essential massage designed to care for pregnant women as you lay on your side supported by a pillow.',
    category: 'Massage Services',
    isFixedPrice: false,
    allowedDurations: [60, 90, 120],
    pricing: { 60: 699, 90: 999, 120: 1299 },
    price: 699,
    durationMinutes: 60,
  },
  {
    name: 'Mandara Massage',
    description: 'Helps eliminate stress and fatigue from work, sports or travel. Four-handed massage.',
    category: 'Massage Services',
    isFixedPrice: false,
    allowedDurations: [60, 90, 120],
    pricing: { 60: 1299, 90: 1849, 120: 2499 },
    price: 1299,
    durationMinutes: 60,
  },
  {
    name: 'Swedish Massage',
    description: 'Uses light and firm touch, tapping, kneading, and friction to relax the muscles and increase blood flow.',
    category: 'Massage Services',
    isFixedPrice: false,
    allowedDurations: [60, 90, 120],
    pricing: { 60: 639, 90: 939, 120: 1249 },
    price: 639,
    durationMinutes: 60,
  },
  {
    name: 'Thai Massage',
    description: 'Uses stretching and deep massage techniques along energy lines to relax the muscles and increase blood flow.',
    category: 'Massage Services',
    isFixedPrice: false,
    allowedDurations: [60, 90, 120],
    pricing: { 60: 729, 90: 1099, 120: 1399 },
    price: 729,
    durationMinutes: 60,
  },

  // ══════════════════════════════════════════════════════════════════
  //  FOOT TREATMENT  (fixed price)
  // ══════════════════════════════════════════════════════════════════
  {
    name: 'Foot Spa',
    description: 'Relaxing foot soak and massage treatment.',
    category: 'Foot Treatment',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 499 },
    price: 499,
    durationMinutes: 60,
  },
  {
    name: 'Foot Spa w/ Paraffin',
    description: 'Foot spa treatment with soothing paraffin wax application.',
    category: 'Foot Treatment',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 799 },
    price: 799,
    durationMinutes: 60,
  },
  {
    name: 'Hands Spa',
    description: 'Relaxing hand soak and massage treatment.',
    category: 'Foot Treatment',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 499 },
    price: 499,
    durationMinutes: 60,
  },
  {
    name: 'Hands Spa w/ Paraffin',
    description: 'Hand spa treatment with soothing paraffin wax application.',
    category: 'Foot Treatment',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 799 },
    price: 799,
    durationMinutes: 60,
  },

  // ══════════════════════════════════════════════════════════════════
  //  SPOT MASSAGE  (30 or 60 min pricing)
  // ══════════════════════════════════════════════════════════════════
  {
    name: 'Back Massage',
    description: 'Targeted back massage to relieve tension and soreness.',
    category: 'Spot Massage',
    isFixedPrice: false,
    allowedDurations: [30, 60],
    pricing: { 30: 350, 60: 699 },
    price: 350,
    durationMinutes: 30,
  },
  {
    name: 'Facial Massage',
    description: 'Relaxing targeted facial massage to ease tension and improve circulation.',
    category: 'Spot Massage',
    isFixedPrice: false,
    allowedDurations: [30, 60],
    pricing: { 30: 350, 60: 699 },
    price: 350,
    durationMinutes: 30,
  },
  {
    name: 'Head Massage',
    description: 'Targeted scalp and head massage to relieve headaches and stress.',
    category: 'Spot Massage',
    isFixedPrice: false,
    allowedDurations: [30, 60],
    pricing: { 30: 350, 60: 699 },
    price: 350,
    durationMinutes: 30,
  },
  {
    name: 'Head and Neck Massage',
    description: 'Targeted head and neck massage to relieve tension and stiffness.',
    category: 'Spot Massage',
    isFixedPrice: false,
    allowedDurations: [30, 60],
    pricing: { 30: 350, 60: 699 },
    price: 350,
    durationMinutes: 30,
  },
  {
    name: 'Foot and Hand Massage',
    description: 'Targeted foot and hand massage to improve circulation and relieve fatigue.',
    category: 'Spot Massage',
    isFixedPrice: false,
    allowedDurations: [30, 60],
    pricing: { 30: 350, 60: 699 },
    price: 350,
    durationMinutes: 30,
  },

  // ══════════════════════════════════════════════════════════════════
  //  BODY SCRUB  (fixed price)
  // ══════════════════════════════════════════════════════════════════
  {
    name: 'Coconut Scrub',
    description: 'Nourishing coconut body scrub for smooth and moisturized skin.',
    category: 'Body Scrub',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 799 },
    price: 799,
    durationMinutes: 60,
  },
  {
    name: 'Apricot Scrub',
    description: 'Gentle apricot exfoliating scrub for bright and refreshed skin.',
    category: 'Body Scrub',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 999 },
    price: 999,
    durationMinutes: 60,
  },
  {
    name: 'Whitening Scrub',
    description: 'Skin-brightening scrub treatment for a lighter and more radiant complexion.',
    category: 'Body Scrub',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 899 },
    price: 899,
    durationMinutes: 60,
  },
  {
    name: 'Whitening Scrub w/ Milk Massage',
    description: 'Whitening scrub combined with a nourishing milk massage for glowing skin.',
    category: 'Body Scrub',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 1199 },
    price: 1199,
    durationMinutes: 60,
  },
  {
    name: "Vegie's Scrub",
    description: 'Natural vegetable-based body scrub packed with vitamins and antioxidants.',
    category: 'Body Scrub',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 899 },
    price: 899,
    durationMinutes: 60,
  },
  {
    name: 'Strawberry Scrub',
    description: 'Sweet strawberry exfoliating scrub for smooth, fresh-smelling skin.',
    category: 'Body Scrub',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 799 },
    price: 799,
    durationMinutes: 60,
  },
  {
    name: 'Coffee Scrub',
    description: 'Energizing coffee scrub that reduces cellulite and leaves skin silky smooth.',
    category: 'Body Scrub',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 799 },
    price: 799,
    durationMinutes: 60,
  },
  {
    name: 'Dead Sea Salt Scrub',
    description: 'Mineral-rich Dead Sea salt scrub to detoxify and deeply cleanse the skin.',
    category: 'Body Scrub',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 899 },
    price: 899,
    durationMinutes: 60,
  },
  {
    name: 'Oatmeal Scrub',
    description: 'Soothing oatmeal scrub ideal for sensitive skin, leaving it soft and calm.',
    category: 'Body Scrub',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 799 },
    price: 799,
    durationMinutes: 60,
  },
  {
    name: 'Chocolate Scrub',
    description: 'Indulgent chocolate scrub rich in antioxidants for deeply nourished skin.',
    category: 'Body Scrub',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 999 },
    price: 999,
    durationMinutes: 60,
  },

  // ══════════════════════════════════════════════════════════════════
  //  FACIAL TREATMENT  (fixed price)
  // ══════════════════════════════════════════════════════════════════
  {
    name: 'Nagomi Facial',
    description: 'Our signature facial treatment for a deeply cleansed and radiant complexion.',
    category: 'Facial Treatment',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 999 },
    price: 999,
    durationMinutes: 60,
  },
  {
    name: 'Rejuvenate Facial',
    description: 'Revitalizing facial to restore youthfulness and skin elasticity.',
    category: 'Facial Treatment',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 899 },
    price: 899,
    durationMinutes: 60,
  },
  {
    name: 'Age Defying Facial',
    description: 'Anti-aging facial treatment targeting fine lines and wrinkles.',
    category: 'Facial Treatment',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 899 },
    price: 899,
    durationMinutes: 60,
  },
  {
    name: 'Basic Facial',
    description: 'Essential cleansing and moisturizing facial for all skin types.',
    category: 'Facial Treatment',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 499 },
    price: 499,
    durationMinutes: 60,
  },
  {
    name: 'Teen Age Facial',
    description: 'Gentle deep-cleansing facial specially formulated for teen skin.',
    category: 'Facial Treatment',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 799 },
    price: 799,
    durationMinutes: 60,
  },
  {
    name: 'Diamond Peel',
    description: 'Microdermabrasion treatment for smoother, brighter, and more even-toned skin.',
    category: 'Facial Treatment',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 1099 },
    price: 1099,
    durationMinutes: 60,
  },
  {
    name: 'Facial w/ Laser',
    description: 'Advanced facial treatment combined with laser technology for enhanced results.',
    category: 'Facial Treatment',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 949 },
    price: 949,
    durationMinutes: 60,
  },
  {
    name: 'Warts Removal',
    description: 'Professional warts removal treatment by our trained aestheticians.',
    category: 'Facial Treatment',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 500 },   // price not visible in menu photo — update as needed
    price: 500,
    durationMinutes: 60,
  },

  // ══════════════════════════════════════════════════════════════════
  //  PACKAGES  (single-person, fixed price, 60 min)
  // ══════════════════════════════════════════════════════════════════
  {
    name: 'Package 1: Refreshing Mask + Massage',
    description: 'Refreshing mask combined with a full 60-minute massage.',
    category: 'Packages',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 799 },
    price: 799,
    durationMinutes: 60,
  },
  {
    name: 'Package 2: Ear Candle + Massage',
    description: 'Ear candle therapy followed by a full 60-minute massage.',
    category: 'Packages',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 899 },
    price: 899,
    durationMinutes: 60,
  },
  {
    name: 'Package 3: Basic Facial + Massage',
    description: 'Basic facial cleansing combined with a full 60-minute massage.',
    category: 'Packages',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 999 },
    price: 999,
    durationMinutes: 60,
  },
  {
    name: 'Package 4: Foot Spa + Basic Facial',
    description: 'Relaxing foot spa paired with a basic facial treatment.',
    category: 'Packages',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 999 },
    price: 999,
    durationMinutes: 60,
  },
  {
    name: 'Package 5: Foot Spa + Massage',
    description: 'Foot spa treatment followed by a full 60-minute body massage.',
    category: 'Packages',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 1099 },
    price: 1099,
    durationMinutes: 60,
  },
  {
    name: 'Package 6: Coffee or Coconut Scrub + Massage',
    description: 'Choice of coffee or coconut body scrub combined with a 60-minute massage.',
    category: 'Packages',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 1299 },
    price: 1299,
    durationMinutes: 60,
  },
  {
    name: 'Package 7: Tummy Wrap + Backpack + Refreshing Mask + Massage',
    description: 'Tummy wrap, back pack treatment, and refreshing mask combined with a massage.',
    category: 'Packages',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 1399 },
    price: 1399,
    durationMinutes: 60,
  },
  {
    name: 'Package 8: Oatmeal/Dead Sea Salt Scrub + Massage',
    description: 'Choice of oatmeal or dead sea salt scrub paired with a full 60-minute massage.',
    category: 'Packages',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 1429 },
    price: 1429,
    durationMinutes: 60,
  },
  {
    name: 'Package 9: Whitening Scrub + Massage',
    description: 'Skin-brightening whitening scrub combined with a full 60-minute massage.',
    category: 'Packages',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 1529 },
    price: 1529,
    durationMinutes: 60,
  },
  {
    name: 'Package 10: Scrub + Massage',
    description: 'Premium full-body scrub treatment combined with a full 60-minute massage.',
    category: 'Packages',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 1749 },
    price: 1749,
    durationMinutes: 60,
  },
  {
    name: 'Package 11: Body Scrub + Basic Facial + Massage',
    description: 'Body scrub, basic facial, and a full 60-minute massage.',
    category: 'Packages',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 1899 },
    price: 1899,
    durationMinutes: 60,
  },
  {
    name: 'Package 12: Body Scrub + Foot Spa + Massage',
    description: 'Body scrub, foot spa, and a full 60-minute massage.',
    category: 'Packages',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 2099 },
    price: 2099,
    durationMinutes: 60,
  },
  {
    name: 'Package 13: Body Scrub + Foot Spa + Basic Facial + Massage',
    description: 'Complete treatment — body scrub, foot spa, basic facial, and a full massage.',
    category: 'Packages',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 2399 },
    price: 2399,
    durationMinutes: 60,
  },
  {
    name: 'Package 14: Stone Massage + Body Scrub + Foot Spa + Basic Facial',
    description: 'Ultimate indulgence — stone massage, body scrub, foot spa, and basic facial.',
    category: 'Packages',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 2699 },
    price: 2699,
    durationMinutes: 60,
  },

  // ══════════════════════════════════════════════════════════════════
  //  COUPLES PACKAGES  (for 2 guests, fixed price, 60 min)
  // ══════════════════════════════════════════════════════════════════
  {
    name: 'Bronze Couple Package: Ear Candle + Basic Facial + 23-in-1 Herbs Juice + Massage',
    description: 'Bronze couple package — ear candle, basic facial, 23-in-1 herbs juice, and massage for two.',
    category: 'Couples Packages',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 2799 },
    price: 2799,
    durationMinutes: 60,
  },
  {
    name: 'Silver Couple Package: Backpack + Ear Candle + 23-in-1 Herbs Juice + Massage',
    description: 'Silver couple package — back pack, ear candle, 23-in-1 herbs juice, and massage for two.',
    category: 'Couples Packages',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 2899 },
    price: 2899,
    durationMinutes: 60,
  },
  {
    name: 'Gold Couple Package: Tummy Wrap + Refreshing Mask + 23-in-1 Herbs Juice + Massage',
    description: 'Gold couple package — tummy wrap, refreshing mask, 23-in-1 herbs juice, and massage for two.',
    category: 'Couples Packages',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 2999 },
    price: 2999,
    durationMinutes: 60,
  },
  {
    name: 'Harmony Couple Package: Body Scrub + Refreshing Mask + 23-in-1 Herbs Juice + Massage',
    description: 'Harmony couple package — body scrub, refreshing mask, 23-in-1 herbs juice, and massage for two.',
    category: 'Couples Packages',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 3599 },
    price: 3599,
    durationMinutes: 60,
  },
  {
    name: 'Restorative Day Couple Package: Body Scrub + Basic Facial + 23-in-1 Herbs Juice + Massage',
    description: 'Restorative day couple package — body scrub, basic facial, 23-in-1 herbs juice, and massage for two.',
    category: 'Couples Packages',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 3799 },
    price: 3799,
    durationMinutes: 60,
  },
  {
    name: 'Couples Retreat Package: Body Scrub + Foot Spa + 23-in-1 Herbs Juice + Massage',
    description: 'Ultimate couple retreat — body scrub, foot spa, 23-in-1 herbs juice, and massage for two.',
    category: 'Couples Packages',
    isFixedPrice: true,
    allowedDurations: [60],
    pricing: { 60: 3899 },
    price: 3899,
    durationMinutes: 60,
  },
];

// ─── SEED LOGIC ──────────────────────────────────────────────────────────────

async function seed() {
  console.log('\n🌸  Nagomi Wellness Spa — Bulk Service Upsert');
  console.log('─────────────────────────────────────────────────────────────');
  console.log(`    Total services to upsert: ${ALL_SERVICES.length}`);
  console.log('─────────────────────────────────────────────────────────────\n');

  await mongoose.connect(MONGO_URI);
  console.log('✅  MongoDB connected\n');

  // Load the Service model
  const Service = require('./src/models/Service');

  let created = 0;
  let updated = 0;

  for (const svc of ALL_SERVICES) {
    const pricingMap = new Map(Object.entries(svc.pricing));

    const result = await Service.findOneAndUpdate(
      { name: svc.name },
      {
        $set: {
          description:     svc.description,
          category:        svc.category,
          isFixedPrice:    svc.isFixedPrice,
          allowedDurations: svc.allowedDurations,
          pricing:         pricingMap,
          price:           svc.price,
          durationMinutes: svc.durationMinutes,
          active:          true,
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const isNew = result.createdAt && (Date.now() - result.createdAt.getTime() < 5000);
    if (isNew) {
      created++;
      console.log(`  ✨ CREATED  [${svc.category.padEnd(20)}] ${svc.name}`);
    } else {
      updated++;
      console.log(`  🔄 UPDATED  [${svc.category.padEnd(20)}] ${svc.name}`);
    }
  }

  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  ✅  Done!  Created: ${created}  |  Updated: ${updated}  |  Total: ${ALL_SERVICES.length}`);
  console.log('║');
  console.log('║  Categories seeded:');
  console.log('║    💆 Massage Services   (12 services)');
  console.log('║    🦶 Foot Treatment     (4 services)');
  console.log('║    ✋ Spot Massage       (5 services)');
  console.log('║    🧖 Body Scrub         (10 services)');
  console.log('║    😊 Facial Treatment   (8 services)');
  console.log('║    🎁 Packages           (14 packages)');
  console.log('║    👫 Couples Packages   (6 packages)');
  console.log('║');
  console.log('║  💡 Restart your server to reflect model changes.');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  await mongoose.disconnect();
}

seed().catch(err => {
  console.error('❌  Seed failed:', err.message);
  process.exit(1);
});