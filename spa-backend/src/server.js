// src/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/db');

const app = express();
connectDB(process.env.MONGODB_URI);
app.use(cors());
app.use(express.json());
app.use('/api/auth', require('./routes/auth'));
app.use('/api/services', require('./routes/services'));
app.use('/api/bookings', require('./routes/bookings'));



// test route
app.get('/', (req, res) => {
  res.send('Spa backend running');
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
