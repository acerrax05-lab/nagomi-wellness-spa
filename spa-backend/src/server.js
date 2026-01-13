// src/server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const connectDB = require('./config/db');

const app = express();
const server = http.createServer(app);

const io = socketIO(server, {
  cors: {
    origin: "*", 
    methods: ["GET", "POST", "PATCH", "DELETE", "PUT"]
  }
});

// Connect to MongoDB
connectDB(process.env.MONGODB_URI);

// IMPORT MODELS (This fixes the MissingSchemaError)
require('./models/User');
require('./models/Service');
require('./models/Booking');
require('./models/GracePeriod');
require('./models/Settings');

// Middleware
app.use(cors());
app.use(express.json());
app.set('socketio', io);
// Error handling middleware (add at the end of your middleware chain)
app.use((err, req, res, next) => {
  console.error('💥 Unhandled error:');
  console.error('Message:', err.message);
  console.error('Stack:', err.stack);
  
  res.status(500).json({
    msg: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/services', require('./routes/services'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/analytics', require('./routes/analytics'));
app.use('/api/therapists', require('./routes/therapists'));
app.use('/api/grace-periods', require('./routes/gracePeriods'));
app.use('/api/settings', require('./routes/settings'));


// Socket.IO
io.on('connection', (socket) => {
  console.log('✅ New client connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });

  socket.on('join', (data) => {
    const { userId, role } = data;
    socket.join(role); 
    socket.join(userId); 
    console.log(`👤 User ${userId} joined ${role} room`);
  });
});

app.get('/', (req, res) => {
  res.send('Spa backend running with Socket.IO');
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT}`);
  console.log(`🔌 Socket.IO ready for real-time updates`);
});