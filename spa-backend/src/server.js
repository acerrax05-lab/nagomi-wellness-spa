// src/server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const cors = require('cors');
const connectDB = require('./config/db');

const app = express();
const server = http.createServer(app);

// Socket.IO setup with CORS
const io = socketIO(server, {
  cors: {
    origin: "*", // In production, specify your frontend domain
    methods: ["GET", "POST", "PATCH", "DELETE"]
  }
});

// Connect to MongoDB
connectDB(process.env.MONGODB_URI);

// Middleware
app.use(cors());
app.use(express.json());

// Make io accessible to routes
app.set('socketio', io);

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/services', require('./routes/services'));
app.use('/api/bookings', require('./routes/bookings'));

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('✅ New client connected:', socket.id);

  socket.on('disconnect', () => {
    console.log('❌ Client disconnected:', socket.id);
  });

  // Join room based on user role
  socket.on('join', (data) => {
    const { userId, role } = data;
    socket.join(role); // Join role-based room (admin, therapist, client)
    socket.join(userId); // Join user-specific room
    console.log(`👤 User ${userId} joined ${role} room`);
  });
});

// Test route
app.get('/', (req, res) => {
  res.send('Spa backend running with Socket.IO');
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`🚀 Server started on port ${PORT}`);
  console.log(`🔌 Socket.IO ready for real-time updates`);
});

app.use('/api/analytics', require('./routes/analytics'));