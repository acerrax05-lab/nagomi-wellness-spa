/**
 * Nagomi Wellness Spa — Booking Data Generator
 * Generates Jan 1 2025 → Mar 20 2026 bookings
 * Run: node generate_bookings.js
 * Requires: MONGODB_URI in .env or pass as env var
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/spa_db';

// ── Therapist IDs (from your DB) ──────────────────────────────────────────────
const THERAPISTS = [
  { id: '699707e39a0bf87a40583e38', name: 'Troy Dela Cruz',      gender: 'male',   dayOff: 3 }, // Wed=3
  { id: '6997081d9a0bf87a40583e4a', name: 'Ian Charles',         gender: 'male',   dayOff: 4 }, // Thu=4
  { id: '699707e39a0bf87a40583e39', name: 'Josie Bautista',      gender: 'female', dayOff: 1 }, // Mon
  { id: '699707e39a0bf87a40583e40', name: 'Rowena Aguilar',      gender: 'female', dayOff: 2 }, // Tue
  { id: '699707e39a0bf87a40583e41', name: 'Frances Navarro',     gender: 'female', dayOff: 5 }, // Fri
  { id: '5682ee6c9376cd6738828bbc', name: 'Aldrina Manalo',      gender: 'female', dayOff: null },
  { id: '699707e39a0bf87a40583e43', name: 'Ara Magno',           gender: 'female', dayOff: 6 }, // Sat
  { id: '699707e39a0bf87a40583e44', name: 'Kendra Sophia',       gender: 'female', dayOff: 0 }, // Sun
  { id: '699707e39a0bf87a40583e45', name: 'Marites Evangelista', gender: 'female', dayOff: 3 }, // Wed
  { id: '699707e39a0bf87a40583e46', name: 'Rosario Dela Peña',   gender: 'female', dayOff: 1 }, // Mon
  { id: '699707e39a0bf87a40583e47', name: 'Cynthia Lim',         gender: 'female', dayOff: null },
  { id: '699707e39a0bf87a40583e48', name: 'Gina Soriano',        gender: 'female', dayOff: 2 }, // Tue
  { id: '699707e39a0bf87a40583e49', name: 'Sheryl Castillo',     gender: 'female', dayOff: 4 }, // Thu
];

const TIMES = ['9:00 AM','9:30 AM','10:00 AM','10:30 AM','11:00 AM','11:30 AM',
               '1:00 PM','1:30 PM','2:00 PM','2:30 PM','3:00 PM','3:30 PM','4:00 PM'];

const FIRST_NAMES = ['Maria','Ana','Jose','Juan','Rosa','Elena','Carlo','Liza','Mark',
                     'Grace','Ryan','Joyce','Kevin','Jasmine','Patrick','Sheena','Dennis',
                     'Camille','Ronald','Kristine','Angelo','Maribel','Francis','Liezel'];
const LAST_NAMES  = ['Santos','Reyes','Cruz','Garcia','Torres','Dela Cruz','Mendoza',
                     'Villanueva','Ramos','Aquino','Lopez','Bautista','Flores','Castillo',
                     'Hernandez','Gonzales','Lim','Chan','Uy','Tan','Sy','Co','Go'];

const PAYMENT_METHODS = ['Cash','GCash','Maya','Credit Card'];
const STATUSES_PAST   = ['completed','completed','completed','cancelled'];
const STATUSES_RECENT = ['confirmed','confirmed','pending','completed'];

function rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randName() { return `${rand(FIRST_NAMES)} ${rand(LAST_NAMES)}`; }
function randPhone() { return `09${randInt(10,99)}${randInt(1000000,9999999)}`; }

function addMinutes(timeStr, mins) {
  const [time, period] = timeStr.split(' ');
  let [h, m] = time.split(':').map(Number);
  if (period === 'PM' && h !== 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;
  const total = h * 60 + m + mins;
  let nh = Math.floor(total / 60) % 24;
  const nm = total % 60;
  const np = nh >= 12 ? 'PM' : 'AM';
  if (nh > 12) nh -= 12;
  if (nh === 0) nh = 12;
  return `${nh}:${String(nm).padStart(2,'0')} ${np}`;
}

function txnNumber(date) {
  const d = new Date(date);
  const ymd = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const code = Math.random().toString(36).substring(2,8).toUpperCase();
  return `NWS${ymd}-${code}`;
}

async function main() {
  console.log('🔌 Connecting to MongoDB...');
  await mongoose.connect(MONGO_URI);
  console.log('✅ Connected!\n');

  const db = mongoose.connection.db;

  // Fetch real service IDs + pricing from DB
  const services = await db.collection('services').find({}, {
    projection: { _id: 1, name: 1, price: 1, pricing: 1, allowedDurations: 1, category: 1 }
  }).toArray();

  if (services.length === 0) {
    console.error('❌ No services found in DB. Please add services first.');
    process.exit(1);
  }
  console.log(`📋 Found ${services.length} services\n`);

  // Check existing bookings count
  const existing = await db.collection('bookings').countDocuments();
  console.log(`📊 Existing bookings: ${existing}`);

  // Date range: Jan 1 2025 → Mar 20 2026
  const START = new Date('2025-01-01T00:00:00.000Z');
  const END   = new Date('2026-03-20T23:59:59.000Z');
  const TODAY = new Date();

  const bookings = [];
  let current = new Date(START);

  while (current <= END) {
    const dow = current.getDay(); // 0=Sun
    const isPast = current < TODAY;
    const isToday = current.toDateString() === TODAY.toDateString();

    // Weekend = more bookings (5-10), weekday = 3-7
    const isWeekend = dow === 0 || dow === 6;
    const bookingsPerDay = isWeekend ? randInt(4, 9) : randInt(2, 6);

    // Available therapists today
    const availableTherapists = THERAPISTS.filter(t => t.dayOff !== dow);

    for (let b = 0; b < bookingsPerDay; b++) {
      const svc     = rand(services);
      const durations = svc.allowedDurations || [60];
      const duration  = rand(durations);

      // Get price from pricing map or flat price
      let price = svc.price || 500;
      if (svc.pricing) {
        const pObj = typeof svc.pricing === 'object' ? svc.pricing : {};
        price = pObj[duration] || pObj[String(duration)] || svc.price || 500;
      }

      const time    = rand(TIMES);
      const endTime = addMinutes(time, duration);
      const therapist = rand(availableTherapists);
      const clients   = randInt(1, 2);
      const femaleC   = therapist.gender === 'female' ? clients : 0;
      const maleC     = therapist.gender === 'male'   ? clients : 0;

      // Status based on date
      let status;
      if (isPast)      status = rand(STATUSES_PAST);
      else if (isToday) status = rand(STATUSES_RECENT);
      else              status = rand(['confirmed','pending']);

      const bookingDate = new Date(current);
      bookingDate.setHours(8, 0, 0, 0);

      const availAfterMins = duration + 60; // +60 post-service rest
      const availAfterTime = addMinutes(time, availAfterMins);
      const availAfterDate = new Date(bookingDate);
      const [t2, p2] = availAfterTime.split(' ');
      let [ah, am]   = t2.split(':').map(Number);
      if (p2 === 'PM' && ah !== 12) ah += 12;
      if (p2 === 'AM' && ah === 12) ah = 0;
      availAfterDate.setHours(ah, am, 0, 0);

      bookings.push({
        service:           new mongoose.Types.ObjectId(svc._id),
        durationMinutes:   duration,
        date:              bookingDate,
        time,
        endTime,
        availableAfter:    availAfterDate,
        therapists:        [new mongoose.Types.ObjectId(therapist.id)],
        therapist:         new mongoose.Types.ObjectId(therapist.id),
        numberOfClients:   clients,
        femaleClients:     femaleC,
        maleClients:       maleC,
        name:              randName(),
        phone:             randPhone(),
        price:             price * clients,
        paymentMethod:     rand(PAYMENT_METHODS),
        bookingType:       Math.random() > 0.3 ? 'online' : 'walk-in',
        status,
        transactionNumber: txnNumber(bookingDate),
        termsAccepted:     true,
        notes:             '',
        createdAt:         bookingDate,
        updatedAt:         bookingDate,
      });
    }

    current.setDate(current.getDate() + 1);
  }

  console.log(`\n📦 Generated ${bookings.length} bookings`);
  console.log(`📅 Range: Jan 1 2025 → Mar 20 2026\n`);

  // Insert in batches of 500
  const BATCH = 500;
  let inserted = 0;
  for (let i = 0; i < bookings.length; i += BATCH) {
    const batch = bookings.slice(i, i + BATCH);
    await db.collection('bookings').insertMany(batch, { ordered: false });
    inserted += batch.length;
    process.stdout.write(`\r💾 Inserted: ${inserted}/${bookings.length}`);
  }

  const total = await db.collection('bookings').countDocuments();
  console.log(`\n\n✅ Done! Total bookings in DB: ${total}`);
  await mongoose.disconnect();
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});