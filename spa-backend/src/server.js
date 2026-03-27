// src/server.js
require('dotenv').config();
const express    = require('express');
const http       = require('http');
const socketIO   = require('socket.io');
const cors       = require('cors');
const path       = require('path');
const https      = require('https');
const { spawn }  = require('child_process');
const connectDB  = require('./config/db');
const reviewsRouter = require('./routes/reviews');

const app    = express();
const server = http.createServer(app);

const io = socketIO(server, {
  cors: {
    origin:  "*",
    methods: ["GET", "POST", "PATCH", "DELETE", "PUT"]
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SARIMA MICROSERVICE — AUTO START
// ─────────────────────────────────────────────────────────────────────────────

const SARIMA_PORT    = process.env.SARIMA_PORT || 5001;
const SARIMA_HOST    = process.env.SARIMA_HOST || 'localhost';
const SARIMA_SCRIPT  = path.join(__dirname, '..', 'sarima_service.py');

let sarimaProcess     = null;
let sarimaRestarts    = 0;
const MAX_RESTARTS    = 5;
const RESTART_DELAY   = 5000;

function startSarimaService() {
  const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

  console.log(`\n🐍 Starting SARIMA microservice...`);
  console.log(`   Script : ${SARIMA_SCRIPT}`);
  console.log(`   Port   : ${SARIMA_PORT}`);
  console.log(`   Python : ${pythonCmd}\n`);

  sarimaProcess = spawn(pythonCmd, [SARIMA_SCRIPT], {
    env: {
      ...process.env,
      SARIMA_PORT: String(SARIMA_PORT),
      MONGO_URI:   process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/spa_db',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  sarimaProcess.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim()) console.log(`[SARIMA] ${line}`);
    });
  });

  sarimaProcess.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim() && !line.includes('ConvergenceWarning') && !line.includes('UserWarning')) {
        console.error(`[SARIMA ERR] ${line}`);
      }
    });
  });

  sarimaProcess.on('exit', (code, signal) => {
    if (signal === 'SIGTERM' || signal === 'SIGINT') {
      console.log('🛑 SARIMA service stopped (intentional shutdown)');
      return;
    }
    console.warn(`⚠️  SARIMA service exited (code=${code})`);
    if (sarimaRestarts < MAX_RESTARTS) {
      sarimaRestarts++;
      console.log(`🔄 Restarting SARIMA in ${RESTART_DELAY / 1000}s... (attempt ${sarimaRestarts}/${MAX_RESTARTS})`);
      setTimeout(startSarimaService, RESTART_DELAY);
    } else {
      console.error(`❌ SARIMA service failed ${MAX_RESTARTS} times. Not restarting.`);
      console.error(`   Dashboard will use JS Hybrid Ensemble fallback.`);
      console.error(`   Fix: check sarima_service.py and run: pip install flask pymongo statsmodels pandas numpy`);
    }
  });

  sarimaProcess.on('error', (err) => {
    if (err.code === 'ENOENT') {
      console.error(`❌ Python not found. Install Python 3 and add it to PATH.`);
      console.error(`   Dashboard will use JS Hybrid Ensemble fallback.`);
    } else {
      console.error(`❌ SARIMA process error: ${err.message}`);
    }
  });
}

function pingSarimaHealth(retries = 8) {
  const options = {
    hostname: SARIMA_HOST,
    port:     SARIMA_PORT,
    path:     '/health',
    method:   'GET',
    timeout:  3000,
  };

  const req = http.request(options, (res) => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => {
      try {
        const data = JSON.parse(body);
        if (data.sarima_available) {
          console.log(`✅ SARIMA microservice ready — SARIMA model enabled`);
          console.log(`   Bookings in DB: ${data.total_bookings}`);
        } else {
          console.warn(`⚠️  SARIMA service up but statsmodels not installed.`);
          console.warn(`   Run: pip install statsmodels`);
        }
        sarimaRestarts = 0;
      } catch {
        console.log('✅ SARIMA microservice is responding');
      }
    });
  });

  req.on('error', () => {
    if (retries > 0) {
      setTimeout(() => pingSarimaHealth(retries - 1), 2000);
    } else {
      console.warn('⚠️  SARIMA service did not respond after startup. Dashboard will use JS fallback.');
    }
  });

  req.on('timeout', () => req.destroy());
  req.end();
}

function stopSarimaService() {
  if (sarimaProcess && !sarimaProcess.killed) {
    console.log('🛑 Stopping SARIMA microservice...');
    sarimaProcess.kill('SIGTERM');
    sarimaProcess = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DATABASE
// ─────────────────────────────────────────────────────────────────────────────

connectDB(process.env.MONGODB_URI);

require('./models/User');
require('./models/Service');
require('./models/Booking');
require('./models/GracePeriod');
require('./models/Settings');

// ─────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────────────────────────────────────

// ✅ BULLETPROOF CORS — set headers on every single response
app.use((req, res, next) => {
  const origin = req.headers.origin;
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, ngrok-skip-browser-warning');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json());
app.set('socketio', io);

// ── Serve spa-frontend static files ───────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../../spa-frontend')));

// ─────────────────────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────────────────────

app.use('/api/auth',          require('./routes/auth'));
app.use('/api/services',      require('./routes/services'));
app.use('/api/bookings',      require('./routes/bookings'));
app.use('/api/analytics',     require('./routes/analytics'));
app.use('/api/therapists',    require('./routes/therapists'));
app.use('/api/grace-periods', require('./routes/gracePeriods'));
app.use('/api/settings',      require('./routes/settings'));
app.use('/api/reviews',       reviewsRouter);
app.use('/api/payroll',       require('./routes/payroll'));

app.get('/', (req, res) => {
  res.send('Nagomi Wellness Spa backend running');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─────────────────────────────────────────────────────────────────────────────
// ERROR HANDLER
// ─────────────────────────────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('💥 Unhandled error:', err.message);
  console.error(err.stack);
  res.status(500).json({
    msg:   'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SOCKET.IO
// ─────────────────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log('✅ New client connected:', socket.id);
  socket.on('disconnect', () => console.log('❌ Client disconnected:', socket.id));
  socket.on('join', ({ userId, role }) => {
    socket.join(role);
    socket.join(userId);
    console.log(`👤 User ${userId} joined ${role} room`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-ARCHIVE + START SERVER
// ─────────────────────────────────────────────────────────────────────────────

const Booking  = require('./models/Booking');
const mongoose = require('mongoose');

function scheduleArchive() {
  const now     = new Date();
  const next2AM = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 2, 0, 0);
  setTimeout(async () => {
    try {
      const cutoff = new Date();
      cutoff.setFullYear(cutoff.getFullYear() - 2);
      const old = await Booking.find({ date: { $lt: cutoff } }).lean();
      if (old.length > 0) {
        await mongoose.connection.db.collection('archivedBookings').insertMany(old);
        await Booking.deleteMany({ date: { $lt: cutoff } });
        console.log(`✅ Auto-archive: moved ${old.length} bookings → archivedBookings`);
      }
    } catch (err) { console.error('❌ Auto-archive error:', err.message); }
    scheduleArchive();
  }, next2AM - now);
}

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`\n🚀 Server started on port ${PORT}`);
  console.log(`🔌 Socket.IO ready for real-time updates`);
  console.log(`📁 Serving spa-frontend static files`);

  startSarimaService();
  setTimeout(() => pingSarimaHealth(), 5000);
  scheduleArchive();

  if (process.env.NODE_ENV === 'production') {
    const SELF_URL = process.env.RENDER_EXTERNAL_URL || 'https://nagomi-backend.onrender.com';
    setInterval(() => {
      https.get(`${SELF_URL}/health`, (res) => {
        console.log(`🏓 Keep-alive ping → ${res.statusCode}`);
      }).on('error', (err) => {
        console.warn(`⚠️  Keep-alive ping failed: ${err.message}`);
      });
    }, 5 * 60 * 1000);
    console.log(`🏓 Keep-alive enabled`);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────────────────────────────────────

function gracefulShutdown(signal) {
  console.log(`\n📴 ${signal} received — shutting down gracefully...`);
  stopSarimaService();
  server.close(() => {
    console.log('✅ HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('⏰ Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  console.error('💥 Unhandled Promise Rejection:', reason);
});