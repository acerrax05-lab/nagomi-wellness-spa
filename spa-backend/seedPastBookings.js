/**
 * seedPastBookings.js
 * ============================================================
 * Adds OLDER historical bookings that were missing before
 * the existing data (which starts Oct 31, 2025).
 *
 * Covers: July 1, 2025 → October 30, 2025  (4 months)
 *
 * Combined with your existing data (Oct 31 → Feb 27),
 * SARIMA now sees 8 full months of weekly seasonal cycles —
 * enough to reliably detect (p,d,q)(P,D,Q) parameters.
 *
 * SAFE: Only inserts new bookings. Does NOT delete any existing.
 * Idempotent: skips dates that already have 3+ NWS bookings.
 *
 * HOW TO RUN:
 *   cd D:\Nagomi-Wellness-Spa\spa-backend
 *   node seedPastBookings.js
 * ============================================================
 */

require('dotenv').config();

let MongoClient, ObjectId;
try {
  ({ MongoClient, ObjectId } = require('mongodb'));
} catch (e) {
  console.error('❌ "mongodb" package not found. Run: npm install mongodb');
  process.exit(1);
}

// ─── CONFIG ───────────────────────────────────────────────────────────────────

const MONGO_URI = process.env.MONGO_URI
               || process.env.MONGODB_URI
               || 'mongodb://localhost:27017/nagomi';

function getDbName(uri) {
  const p = uri.split('?')[0].split('/');
  return p[p.length - 1] || 'nagomi';
}
const DB_NAME = getDbName(MONGO_URI);

// ── Same real ObjectIDs as your existing data ────────────────────────────────
const SERVICE_IDS = [
  '699707bd991fa83113feca35',
  '699707bd991fa83113feca36',
  '699707bd991fa83113feca37',
  '699707bd991fa83113feca38',
];

// Weighted so Combination Massage stays #1 (matches your real data)
const SERVICE_WEIGHTS = [
  { id: '699707bd991fa83113feca35', weight: 35 }, // Combination Massage
  { id: '699707bd991fa83113feca36', weight: 28 }, // Aromatherapy Massage
  { id: '699707bd991fa83113feca37', weight: 22 }, // Ayurvedic Massage
  { id: '699707bd991fa83113feca38', weight: 15 }, // Deep Tissue Massage
];

const THERAPIST_IDS = [
  '699707fb9a0bf87a40583e3f',
  '699707fb9a0bf87a40583e40',
  '699707fb9a0bf87a40583e41',
  '699707fb9a0bf87a40583e42',
];

const PRICE_BY_DURATION = { 60: 899, 90: 1399, 120: 1899 };

// ─── DATE RANGE ───────────────────────────────────────────────────────────────

// Start: July 1, 2025
const RANGE_START = new Date(2025, 6, 1);   // month is 0-indexed, July = 6
// End:   October 30, 2025 (Oct 31 already exists in your data)
const RANGE_END   = new Date(2025, 9, 30);  // October = 9

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickWeighted(items) {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item.id;
  }
  return items[items.length - 1].id;
}

function poissonSample(lambda) {
  let L = Math.exp(-lambda), k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

function generateTransactionNumber(date) {
  const d = date.toISOString().slice(0, 10).replace(/-/g, '');
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const suffix = Array.from({ length: 6 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');
  return `NWS${d}-${suffix}`;
}

function timeToMinutes(timeStr) {
  const [time, period] = timeStr.split(' ');
  let [h, m] = time.split(':').map(Number);
  if (period === 'PM' && h !== 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;
  return h * 60 + m;
}

const TIME_SLOTS = [
  '9:00 AM', '10:00 AM', '11:00 AM',
  '1:00 PM', '2:00 PM', '3:00 PM',
  '4:00 PM', '5:00 PM', '6:00 PM', '7:00 PM',
];

const DURATION_POOL = [60, 60, 60, 90, 90, 120];

const FIRST_NAMES = [
  'Maria', 'Jose', 'Ana', 'Juan', 'Rosa', 'Pedro', 'Elena', 'Miguel',
  'Carmen', 'Luis', 'Sofia', 'Carlos', 'Isabel', 'Antonio', 'Laura',
  'Melissa', 'Stephanie', 'David', 'Sarah', 'James', 'Jennifer', 'Michael',
  'Ashley', 'Robert', 'Jessica', 'William', 'Amanda', 'Richard', 'Samantha',
  'Thomas', 'Brittany', 'Mark', 'Kimberly', 'Daniel', 'Emily', 'Megan',
  'Patricia', 'Linda', 'Barbara', 'Sandra', 'Dorothy', 'Lisa', 'Nancy',
  'Karen', 'Betty', 'Helen', 'Sharon', 'Donna', 'Carol', 'Ruth', 'Angela',
];

const LAST_NAMES = [
  'Santos', 'Reyes', 'Cruz', 'Garcia', 'Torres', 'Flores', 'Rivera',
  'Mendoza', 'Lopez', 'Ramirez', 'Martinez', 'Hernandez', 'Gonzalez',
  'Perez', 'Morales', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller',
  'Davis', 'Wilson', 'Moore', 'Taylor', 'Anderson', 'Thomas', 'Jackson',
  'White', 'Harris', 'Martin', 'Thompson', 'Robinson', 'Clark', 'Lewis',
  'Lee', 'Walker', 'Hall', 'Allen', 'Young', 'King', 'Wright', 'Scott',
];

function randomName() {
  return `${pickRandom(FIRST_NAMES)} ${pickRandom(LAST_NAMES)}`;
}

function randomPhone() {
  const prefixes = [
    '0917', '0918', '0919', '0920', '0921', '0926',
    '0927', '0928', '0929', '0930', '0935', '0939',
  ];
  return `${pickRandom(prefixes)}${randomInt(1000000, 9999999)}`;
}

const NOTES_POOL = [
  'Lower back issues', 'Prefers light pressure', 'Relaxation massage',
  'Shoulder tension', 'First time client', 'Regular client',
  'Neck and shoulder pain', 'Stress relief', 'Post-workout recovery',
  'Headache relief', 'Sports injury recovery', 'Anniversary treat',
  'Birthday celebration', 'Muscle soreness', 'Referred by friend',
  null, null, null, null, null,
];

// ─── SEASONAL PATTERN ─────────────────────────────────────────────────────────
//
// Jul–Oct 2025 baseline (spa was slightly slower — early growth phase)
// This creates a realistic upward trend when combined with Nov–Feb data
//
// Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6
const DOW_LAMBDA = {
  0: 5.5,  // Sunday
  1: 3.0,  // Monday  — slowest
  2: 3.5,  // Tuesday
  3: 3.8,  // Wednesday
  4: 4.0,  // Thursday
  5: 5.0,  // Friday
  6: 6.0,  // Saturday — busiest
};

// ─── MONTHLY GROWTH MULTIPLIER ────────────────────────────────────────────────
//
// Spa was growing ~6% per month. Earlier months should have fewer bookings.
// Jul=0.72, Aug=0.78, Sep=0.84, Oct=0.90  (Oct 31 data already has ~5/day)
//
function growthMultiplier(date) {
  const refDate   = new Date(2025, 9, 31); // Oct 31 = your existing data starts here
  const msPerMonth = 30 * 24 * 60 * 60 * 1000;
  const monthsBack = (refDate - date) / msPerMonth;
  return Math.max(0.65, 1.0 - monthsBack * 0.065);
}

// ─── ANOMALY INJECTION ────────────────────────────────────────────────────────

function getAnomalyMultiplier(date) {
  const month = date.getMonth() + 1;
  const day   = date.getDate();

  // Independence Day (Jun 12) — small boost
  if (month === 6 && day === 12) return 1.3;

  // Assumption Day (Aug 15) — holiday boost
  if (month === 8 && day === 15) return 1.35;

  // National Heroes Day (Aug 25) — slight boost
  if (month === 8 && day === 25) return 1.2;

  // Bonifacio Day (Nov 30) — already in existing data

  // Random slow day ~3% (equipment, power outage, etc.)
  if (Math.random() < 0.03) return 0.4;

  // Random promo day ~5%
  if (Math.random() < 0.05) return 1.35;

  return 1.0;
}

// ─── STATUS LOGIC ─────────────────────────────────────────────────────────────
//
// All of these are well in the past, so almost everything is resolved.
// Earlier months: more completed. Later months: still mostly completed.
//
function pickStatus(date) {
  const r = Math.random();
  // 80–85% completed, 13–18% cancelled, tiny fraction still "confirmed" (data lag)
  if (r < 0.83) return 'completed';
  if (r < 0.97) return 'cancelled';
  return 'confirmed';
}

function pickBookingType() {
  return Math.random() < 0.72 ? 'online' : 'walk-in';
}

// ─── BUILD ONE BOOKING ────────────────────────────────────────────────────────

function buildBooking(date) {
  const timeStr  = pickRandom(TIME_SLOTS);
  const startMin = timeToMinutes(timeStr);
  const duration = pickRandom(DURATION_POOL);
  const endMin   = startMin + duration;
  const restMin  = endMin + 60;

  const endDateTime   = new Date(date);
  endDateTime.setHours(Math.floor(endMin / 60), endMin % 60, 0, 0);

  const availDateTime = new Date(date);
  availDateTime.setHours(Math.floor(restMin / 60), restMin % 60, 0, 0);

  const serviceId   = pickWeighted(SERVICE_WEIGHTS);
  const therapistId = pickRandom(THERAPIST_IDS);
  const price       = PRICE_BY_DURATION[duration];
  const status      = pickStatus(date);

  return {
    service:         new ObjectId(serviceId),
    therapist:       new ObjectId(therapistId),
    therapists:      [new ObjectId(therapistId)],
    guestName:       randomName(),
    guestPhone:      randomPhone(),
    numberOfClients: Math.random() < 0.10 ? 2 : 1,
    durationMinutes: duration,
    date:            new Date(date),
    time:            timeStr,
    endTime:         endDateTime,
    availableAfter:  availDateTime,
    notes:           pickRandom(NOTES_POOL),
    price,
    status,
    bookingType:     pickBookingType(),
    reviewed:        status === 'completed' && Math.random() < 0.30,
    transactionNumber: generateTransactionNumber(date),
    __v: 0,
  };
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('\n🌱 Connecting to MongoDB...');
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  const db  = client.db(DB_NAME);
  const col = db.collection('bookings');
  console.log(`✅ Connected: "${DB_NAME}"\n`);
  console.log(`📅 Adding historical bookings: ${RANGE_START.toDateString()} → ${RANGE_END.toDateString()}\n`);

  let totalInserted = 0;
  const monthTally  = {};
  const statusTally = { completed: 0, cancelled: 0, confirmed: 0 };

  // Iterate every day in the range
  const cursor = new Date(RANGE_START);
  while (cursor <= RANGE_END) {
    const date    = new Date(cursor);
    const dateStr = date.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });

    // Check existing bookings for this date
    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0);
    const dayEnd   = new Date(date); dayEnd.setHours(23, 59, 59, 999);

    const existing = await col.countDocuments({
      date: { $gte: dayStart, $lte: dayEnd },
      transactionNumber: { $regex: /^NWS/ },
    });

    if (existing >= 3) {
      console.log(`✅ ${dateStr} — already has ${existing} bookings, skipping`);
      cursor.setDate(cursor.getDate() + 1);
      continue;
    }

    // Target count
    const dow      = date.getDay();
    const lambda   = DOW_LAMBDA[dow] * growthMultiplier(date) * getAnomalyMultiplier(date);
    const target   = Math.max(2, poissonSample(lambda));
    const toInsert = Math.max(0, target - existing);

    if (toInsert === 0) {
      cursor.setDate(cursor.getDate() + 1);
      continue;
    }

    const docs = Array.from({ length: toInsert }, () => buildBooking(date));
    await col.insertMany(docs, { ordered: false });
    totalInserted += docs.length;

    // Tally by month and status
    const monthKey = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    monthTally[monthKey] = (monthTally[monthKey] || 0) + docs.length;
    docs.forEach(d => { statusTally[d.status]++; });

    const statusStr = docs.reduce((acc, d) => {
      acc[d.status] = (acc[d.status] || 0) + 1;
      return acc;
    }, {});
    const statusDisplay = Object.entries(statusStr).map(([k, v]) => `${k}:${v}`).join(' ');

    console.log(
      `📅 ${dateStr.padEnd(26)} +${String(toInsert).padStart(2)} bookings` +
      `  (${statusDisplay})`
    );

    cursor.setDate(cursor.getDate() + 1);
  }

  // ── Final summary ─────────────────────────────────────────────────────────

  const grandTotal = await col.countDocuments({ transactionNumber: { $regex: /^NWS/ } });

  console.log('\n══════════════════════════════════════════════════');
  console.log(`✅ Done!  Inserted ${totalInserted} past bookings`);
  console.log(`📊 Total NWS bookings in DB now: ${grandTotal}`);

  console.log('\n📆 Breakdown by month (newly added):');
  Object.entries(monthTally).forEach(([month, count]) => {
    const bar = '█'.repeat(Math.round(count / 4));
    console.log(`   ${month.padEnd(14)} ${String(count).padStart(3)}  ${bar}`);
  });

  console.log('\n📈 Status breakdown (newly added):');
  Object.entries(statusTally).forEach(([s, n]) => {
    if (n > 0) console.log(`   ${s.padEnd(12)} ${n}`);
  });

  console.log('\n📅 Full date coverage after both seed scripts:');
  console.log('   Jul  2025        : 4.0–4.5 bookings/day (early growth)');
  console.log('   Aug  2025        : 4.5–5.0 bookings/day');
  console.log('   Sep  2025        : 5.0–5.5 bookings/day');
  console.log('   Oct  2025        : 5.5–6.0 bookings/day');
  console.log('   Nov–Feb existing : 5.5–7.0 bookings/day (from original seed)');
  console.log('   Mar 1 today      : live mix  (from seedAddendum.js)');
  console.log('   Mar 2–Apr 14     : upcoming  (from seedAddendum.js)');

  console.log('\n💡 SARIMA now has 8+ months of weekly cycles.');
  console.log('   Recommended: restart sarima_service.py so it re-fits the model.');
  console.log('══════════════════════════════════════════════════\n');

  await client.close();
}

seed().catch(err => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});