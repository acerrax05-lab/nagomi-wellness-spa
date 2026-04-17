  const express  = require('express');
  const router   = express.Router();
  const http     = require('http');
  const Booking  = require('../models/Booking');
  const User     = require('../models/User');
  const Service  = require('../models/Service');
  const auth     = require('../middleware/auth');
  const roles    = require('../middleware/roles');
  const {
    hybridEnsembleForecast,
    calculateTrend,
    detectAnomalies,
    generateRecommendations,
  } = require('../utils/analyticsUtils');

  // ── SARIMA SERVICE CONFIG ─────────────────────────────────────────────────────
  const SARIMA_HOST = process.env.SARIMA_HOST || 'localhost';
  const SARIMA_PORT = parseInt(process.env.SARIMA_PORT) || 5001;
  const SARIMA_TIMEOUT_MS = 15000;  // 15 seconds (SARIMA fit can take a moment)

  //Call the Python SARIMA microservice.
   //Returns parsed JSON on success, or throws on error/timeout.
  function callSarimaService(path) {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: SARIMA_HOST,
        port:     SARIMA_PORT,
        path,
        method:   'GET',
        headers:  { 'Accept': 'application/json' },
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try {
            if (res.statusCode !== 200) {
              reject(new Error(`SARIMA service returned ${res.statusCode}`));
            } else {
              resolve(JSON.parse(data));
            }
          } catch (e) {
            reject(new Error('Failed to parse SARIMA response'));
          }
        });
      });

      req.setTimeout(SARIMA_TIMEOUT_MS, () => {
        req.destroy();
        reject(new Error(`SARIMA service timeout (${SARIMA_TIMEOUT_MS}ms)`));
      });

      req.on('error', reject);
      req.end();
    });
  }

  // ── PERIOD HELPERS ────────────────────────────────────────────────────────────
  function getForecastDays(period) {
    return { today: 7, week: 14, month: 30, year: 90 }[period] || 7;
  }

  function getLookbackDays(period) {
    return { today: 60, week: 90, month: 120, year: 180 }[period] || 60;
  }

  function getPeriodLabel(period) {
    return {
      today: 'Next 7 Days',
      week:  'Next 14 Days',
      month: 'Next 30 Days',
      year:  'Next Quarter (90 Days)',
    }[period] || 'Next 7 Days';
  }

  //Start the day
  function getPeriodStartDate(period) {
    const now = new Date();
    switch (period) {
      case 'today': return new Date(now.getFullYear(), now.getMonth(), now.getDate());
      case 'week':  { const d = new Date(now); d.setDate(d.getDate() - 7); return d; }
      case 'month': return new Date(now.getFullYear(), now.getMonth(), 1);
      case 'year':  return new Date(now.getFullYear(), 0, 1);
      default:      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }
  }

  // ── THERAPIST WORKING STATUS ──────────────────────────────────────────────────
  function isTherapistWorkingNow(therapist) {
    const now         = new Date();
    const currentDay  = now.toLocaleDateString('en-US', { weekday: 'long' });
    const currentTime = now.getHours() * 60 + now.getMinutes();

    const todaySchedule = therapist.weeklySchedule?.find(
      s => (s.day === currentDay || s.dayOfWeek === currentDay) && s.isWorking
    );

    if (!todaySchedule) return { working: false, reason: 'Day off' };

    const todayStr = now.toISOString().split('T')[0];
    const override = therapist.dateOverrides?.find(
      o => new Date(o.date).toISOString().split('T')[0] === todayStr
    );

    if (override && !override.isWorking) {
      return { working: false, reason: override.reason || 'Leave/Vacation' };
    }

    const shift = todaySchedule.shifts?.[0];
    if (!shift) return { working: false, reason: 'No shifts defined' };

    const parseTime = (t) => {
      const [time, period] = t.split(' ');
      let [h, m] = time.split(':').map(Number);
      if (period === 'PM' && h !== 12) h += 12;
      if (period === 'AM' && h === 12) h = 0;
      return h * 60 + m;
    };

    const workStart = parseTime(shift.startTime);
    const workEnd   = parseTime(shift.endTime);

    if (currentTime < workStart) return { working: false, reason: 'Before work hours', nextAvailable: shift.startTime };
    if (currentTime >= workEnd)  return { working: false, reason: 'After work hours' };

    for (const br of (todaySchedule.breaks || [])) {
      if (currentTime >= parseTime(br.startTime) && currentTime < parseTime(br.endTime)) {
        return { working: false, reason: 'On break', breakUntil: br.endTime };
      }
    }

    return { working: true };
  }


  // ROUTE: SARIMA STATUS CHECK

  router.get('/sarima-status', auth, roles(['admin']), async (req, res) => {
    try {
      const health = await callSarimaService('/health');
      res.json({
        available:        true,
        sarimaEnabled:    health.sarima_available,
        totalBookings:    health.total_bookings,
        message:          health.sarima_available
                            ? '✅ SARIMA service is running'
                            : '⚠️ Service running but statsmodels not installed',
      });
    } catch (err) {
      res.json({
        available:  false,
        message:    '❌ SARIMA service is offline — using JS hybrid ensemble fallback',
        error:      err.message,
      });
    }
  });


  // ROUTE: ENHANCED PREDICTIONS (SARIMA → JS fallback)

  router.get('/enhanced-predictions', auth, roles(['admin']), async (req, res) => {
    const { period = 'today' } = req.query;

    // ── Try SARIMA service first ───────────────────────────────────────────────
    try {
      console.log(`📡 Attempting SARIMA service for period: ${period}`);
      const sarimaResult = await callSarimaService(`/predict?period=${period}`);

      // Tag the response so the frontend knows SARIMA was used
      sarimaResult.engine = 'sarima';
      sarimaResult.engineLabel = '🔬 SARIMA Model';

      console.log(`✅ SARIMA: ${sarimaResult.totalPredictedBookings} bookings predicted`);
      return res.json(sarimaResult);

    } catch (sarimaErr) {
      console.warn(`⚠️  SARIMA unavailable: ${sarimaErr.message} — falling back to JS ensemble`);
    }

    // ── JS Hybrid Ensemble fallback ────────────────────────────────────────────
    try {
      const forecastDays  = getForecastDays(period);
      const lookbackDays  = getLookbackDays(period);
      const forecastLabel = getPeriodLabel(period);

      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - lookbackDays);

      const historicalBookings = await Booking.find({
        date:   { $gte: cutoff },
        status: { $in: ['completed', 'confirmed'] },
      }).populate('service', 'name');

      if (!historicalBookings.length) {
        return res.json(emptyPredictionResponse(forecastDays, forecastLabel));
      }

      // Build daily time series
      const dateGroups = {};
      const dayStats   = { Sunday:0, Monday:0, Tuesday:0, Wednesday:0, Thursday:0, Friday:0, Saturday:0 };

      historicalBookings.forEach(b => {
        const key     = new Date(b.date).toISOString().split('T')[0];
        const dayName = new Date(b.date).toLocaleDateString('en-US', { weekday: 'long' });

        if (!dateGroups[key]) dateGroups[key] = { count: 0, revenue: 0, services: {} };
        dateGroups[key].count++;

        if (b.status === 'completed') {
          dateGroups[key].revenue += b.price || 0;
        }

        const svcName = b.service?.name || 'Unknown';
        dateGroups[key].services[svcName] = (dateGroups[key].services[svcName] || 0) + 1;
      });

      const sorted      = Object.keys(dateGroups).sort();
      const dailyCounts = sorted.map(d => dateGroups[d].count);
      const dailyRevs   = sorted.map(d => dateGroups[d].revenue);

      const bookingForecast = hybridEnsembleForecast(dailyCounts, forecastDays);
      const revenueForecast = hybridEnsembleForecast(dailyRevs,   forecastDays);

      // Build predictions array
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(0, 0, 0, 0);

      const predictions = Array.from({ length: forecastDays }, (_, i) => {
        const date    = new Date(tomorrow);
        date.setDate(date.getDate() + i);
        const dayName = date.toLocaleDateString('en-US', { weekday: 'long' });

        return {
          date:              date.toISOString().split('T')[0],
          dayName,
          predictedBookings: Math.max(0, bookingForecast.predictions[i]),
          predictedRevenue:  Math.max(0, revenueForecast.predictions[i]),
          lowerBound:        Math.max(0, bookingForecast.confidence[i].lower),
          upperBound:        bookingForecast.confidence[i].upper,
          topServices:       [],
          peakHour:          'N/A',
          confidence:        bookingForecast.reliability,
          method:            'hybrid_ensemble',
        };
      });

      // Aggregate top services
      const allSvcs = {};
      Object.values(dateGroups).forEach(d => {
        Object.entries(d.services).forEach(([name, count]) => {
          allSvcs[name] = (allSvcs[name] || 0) + count;
        });
      });
      const overallTopServices = Object.entries(allSvcs)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => ({ name, count }));

      return res.json({
        predictions,
        forecastHorizon:          forecastLabel,
        forecastDays,
        lookbackDays,
        totalPredictedBookings:   predictions.reduce((s, p) => s + p.predictedBookings, 0),
        totalPredictedRevenue:    predictions.reduce((s, p) => s + p.predictedRevenue,  0),
        overallTopServices,
        method:                   'hybrid_ensemble',
        engine:                   'js_fallback',
        engineLabel:              '⚙️ JS Hybrid Ensemble (SARIMA offline)',
        modelQuality: {
          reliability:     bookingForecast.reliability,
          bookingsR2:      bookingForecast.r2,
          sarimaAvailable: false,
        },
        generatedAt: new Date().toISOString(),
      });

    } catch (err) {
      console.error('❌ Both SARIMA and JS fallback failed:', err);
      res.status(500).json({ msg: 'Prediction failed', error: err.message });
    }
  });


  // ROUTE: RAW TIME SERIES (debug / for charts)

  router.get('/timeseries', auth, roles(['admin']), async (req, res) => {
    try {
      const days   = parseInt(req.query.days) || 120;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);

      const bookings = await Booking.find({ date: { $gte: cutoff } })
        .select('date status price')
        .lean();

      const daily = {};
      bookings.forEach(b => {
        const key = new Date(b.date).toISOString().split('T')[0];
        if (!daily[key]) daily[key] = { date: key, bookings: 0, revenue: 0 };
        daily[key].bookings++;
        if (b.status === 'completed') daily[key].revenue += b.price || 0;
      });

      const data = Object.values(daily).sort((a, b) => a.date.localeCompare(b.date));
      const avgBookings = data.reduce((s, d) => s + d.bookings, 0) / (data.length || 1);
      const avgRevenue  = data.reduce((s, d) => s + d.revenue,  0) / (data.length || 1);

      res.json({
        data,
        totalDays:        data.length,
        avgDailyBookings: Math.round(avgBookings * 10) / 10,
        avgDailyRevenue:  Math.round(avgRevenue),
      });
    } catch (err) {
      res.status(500).json({ msg: 'Server error', error: err.message });
    }
  });


  // ROUTE: COMPREHENSIVE ANALYTICS (unchanged logic, minor SARIMA tag added)

  router.get('/comprehensive', auth, roles(['admin']), async (req, res) => {
    try {
      const { period = 'month' } = req.query;
      const startDate = getPeriodStartDate(period);

      const bookings   = await Booking.find({ date: { $gte: startDate } }).populate('service therapist');
      const services   = await Service.find();
      const therapists = await User.find({ role: 'therapist', isActive: true });

      // Time series
      const dailyCounts  = {};
      const dailyRevenue = {};
      bookings.forEach(b => {
        const k = new Date(b.date).toISOString().split('T')[0];
        dailyCounts[k]  = (dailyCounts[k]  || 0) + 1;
        if (b.status === 'completed') dailyRevenue[k] = (dailyRevenue[k] || 0) + (b.price || 0);
      });

      const sortedDates      = Object.keys(dailyCounts).sort();
      const bookingTimeSeries = sortedDates.map(d => dailyCounts[d]);
      const revenueTimeSeries = sortedDates.map(d => dailyRevenue[d] || 0);

      // Trends & anomalies
      const bookingTrend = calculateTrend(bookingTimeSeries);
      const revenueTrend = calculateTrend(revenueTimeSeries);
      const bookingAnomalies = detectAnomalies(bookingTimeSeries, 2);

      // Metrics
      const totalBookings     = bookings.length;
      const completedBookings = bookings.filter(b => b.status === 'completed').length;
      const cancelledBookings = bookings.filter(b => b.status === 'cancelled').length;
      const totalRevenue      = bookings.filter(b => b.status === 'completed').reduce((s, b) => s + (b.price || 0), 0);
      const cancellationRate  = totalBookings > 0 ? (cancelledBookings / totalBookings) * 100 : 0;

      // Service performance
      const servicePerformance = services.map(service => {
        const sb = bookings.filter(b => b.service?._id?.toString() === service._id.toString());
        return {
          name:     service.name,
          bookings: sb.length,
          revenue:  sb.filter(b => b.status === 'completed').reduce((s, b) => s + (b.price || 0), 0),
        };
      }).sort((a, b) => b.bookings - a.bookings);

      // Therapist utilization
      const therapistUtilization = therapists.map(t => {
        const tb        = bookings.filter(b => b.therapist?._id?.toString() === t._id.toString());
        const completed = tb.filter(b => b.status === 'completed').length;
        return { name: t.name, bookings: tb.length, completed, rate: tb.length ? (completed / tb.length) * 100 : 0 };
      }).sort((a, b) => b.rate - a.rate);

      // Peak hours
      const peakHours = Array(24).fill(0);
      bookings.forEach(b => {
        if (b.time) {
          const [t, p] = b.time.split(' ');
          let h = parseInt(t.split(':')[0]);
          if (p === 'PM' && h !== 12) h += 12;
          if (p === 'AM' && h === 12) h = 0;
          peakHours[h]++;
        }
      });

      const recommendations = generateRecommendations({
        bookingTrend, revenueTrend, cancellationRate, peakHours,
        lowPerformingServices: servicePerformance.filter(s => s.bookings < 3),
        topServices: servicePerformance.slice(0, 5),
        therapistUtilization,
        averageSuccessRate: totalBookings > 0 ? (completedBookings / totalBookings) * 100 : 0,
      });

      // Forecast (JS ensemble for this route — keeping it fast)
      const forecastDays = getForecastDays(period);
      const bForecast    = hybridEnsembleForecast(bookingTimeSeries, forecastDays);
      const rForecast    = hybridEnsembleForecast(revenueTimeSeries, forecastDays);

      const forecastDates = Array.from({ length: forecastDays }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() + i + 1);
        return d.toISOString().split('T')[0];
      });

      res.json({
        summary: {
          totalBookings, completedBookings, cancelledBookings,
          cancellationRate: cancellationRate.toFixed(1),
          totalRevenue,
          averageRevenuePerBooking: completedBookings > 0 ? Math.round(totalRevenue / completedBookings) : 0,
        },
        trends: {
          bookings: { direction: bookingTrend.direction, slope: bookingTrend.slope.toFixed(3), correlation: bookingTrend.correlation.toFixed(3) },
          revenue:  { direction: revenueTrend.direction,  slope: revenueTrend.slope.toFixed(3),  correlation: revenueTrend.correlation.toFixed(3) },
        },
        anomalies: bookingAnomalies.map(a => ({
          date:     sortedDates[a.index],
          value:    a.value,
          type:     a.type,
          zScore:   a.zScore.toFixed(2),
          severity: Math.abs(a.zScore) > 3 ? 'high' : 'medium',
        })),
        forecast: {
          bookings: { dates: forecastDates, values: bForecast.predictions, confidence: bForecast.confidence, reliability: bForecast.reliability },
          revenue:  { values: rForecast.predictions, confidence: rForecast.confidence, reliability: rForecast.reliability },
        },
        servicePerformance,
        therapistUtilization,
        recommendations,
        lastUpdated: new Date().toISOString(),
        method: 'hybrid_ensemble',
      });

    } catch (err) {
      console.error('Error in comprehensive analytics:', err);
      res.status(500).json({ msg: 'Server error', error: err.message });
    }
  });


  // ROUTE: THERAPIST PERFORMANCE (unchanged)

  router.get('/therapist-performance', auth, roles(['admin']), async (req, res) => {
    try {
      const { period = 'today' } = req.query;
      const startDate = getPeriodStartDate(period);
      const now       = new Date();

      const therapists = await User.find({ role: 'therapist', isActive: true })
        .select('name email weeklySchedule dateOverrides expertise');

      const bookings = await Booking.find({
        date:      { $gte: startDate, $lte: now },
        therapist: { $exists: true, $ne: null },
      }).populate('therapist', 'name');

      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

      const todaysBookings = await Booking.find({
        date:   { $gte: todayStart, $lte: todayEnd },
        status: { $nin: ['cancelled', 'completed'] },
      }).populate('therapist', 'name');

      const analytics = await Promise.all(therapists.map(async (therapist) => {
        const scheduleStatus = isTherapistWorkingNow(therapist);

        // Find active booking
        let currentBooking = null;
        const activeBooking = todaysBookings.find(b => {
          if (!b.therapist || b.therapist._id.toString() !== therapist._id.toString()) return false;
          const [t, p] = b.time.split(' ');
          let h = parseInt(t.split(':')[0]);
          if (p === 'PM' && h !== 12) h += 12;
          if (p === 'AM' && h === 12) h = 0;
          const start   = h * 60 + parseInt(t.split(':')[1]);
          const current = now.getHours() * 60 + now.getMinutes();
          return current >= start && current < start + b.durationMinutes;
        });

        if (activeBooking) {
          const [t, p] = activeBooking.time.split(' ');
          let h = parseInt(t.split(':')[0]);
          if (p === 'PM' && h !== 12) h += 12;
          if (p === 'AM' && h === 12) h = 0;
          const endMin   = h * 60 + parseInt(t.split(':')[1]) + activeBooking.durationMinutes;
          const endH     = Math.floor(endMin / 60);
          const endM     = endMin % 60;
          const endPd    = endH >= 12 ? 'PM' : 'AM';
          const displayH = endH > 12 ? endH - 12 : (endH === 0 ? 12 : endH);
          currentBooking = { service: activeBooking.service, endTime: `${displayH}:${String(endM).padStart(2,'0')} ${endPd}` };
        }

        const tBookings = bookings.filter(b => b.therapist?._id?.toString() === therapist._id.toString());
        const completed = tBookings.filter(b => b.status === 'completed');
        const totalRevenue  = completed.reduce((s, b) => s + (b.price || 0), 0);
        const successRate   = tBookings.length > 0 ? Math.round((completed.length / tBookings.length) * 100) : 0;

        let status = 'off', statusMessage = 'Off duty';
        if (!scheduleStatus.working) {
          if (scheduleStatus.breakUntil) { status = 'break'; statusMessage = `On break until ${scheduleStatus.breakUntil}`; }
          else { status = 'off'; statusMessage = scheduleStatus.nextAvailable ? `Off duty - Available at ${scheduleStatus.nextAvailable}` : (scheduleStatus.reason || 'Off duty'); }
        } else if (activeBooking) {
          status = 'busy'; statusMessage = `In session until ${currentBooking.endTime}`;
        } else {
          status = 'available'; statusMessage = 'Available now';
        }

        const todaySchedule = therapist.weeklySchedule?.find(
          s => (s.day === now.toLocaleDateString('en-US', {weekday:'long'}) ||
                s.dayOfWeek === now.toLocaleDateString('en-US', {weekday:'long'})) && s.isWorking
        );

        return {
          id: therapist._id, name: therapist.name, email: therapist.email,
          expertise: therapist.expertise || [],
          status, statusMessage, currentBooking,
          totalBookings:     tBookings.length,
          completedBookings: completed.length,
          totalRevenue, successRate,
          isWorkingToday: scheduleStatus.working,
          workingHours:   todaySchedule?.shifts?.[0],
        };
      }));

      const sortOrder = { available: 0, busy: 1, break: 2, off: 3 };
      analytics.sort((a, b) => sortOrder[a.status] - sortOrder[b.status]);

      res.json(analytics);
    } catch (err) {
      console.error('Error fetching therapist analytics:', err);
      res.status(500).json({ msg: 'Server error', error: err.message });
    }
  });

  // ── HELPERS ───────────────────────────────────────────────────────────────────
  function emptyPredictionResponse(forecastDays, forecastLabel) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    return {
      predictions: Array.from({ length: forecastDays }, (_, i) => {
        const d = new Date(tomorrow);
        d.setDate(d.getDate() + i);
        return {
          date: d.toISOString().split('T')[0],
          dayName: d.toLocaleDateString('en-US', { weekday: 'long' }),
          predictedBookings: 0, predictedRevenue: 0,
          lowerBound: 0, upperBound: 0,
          topServices: [], peakHour: 'N/A',
          confidence: 'No Data', method: 'insufficient_data',
        };
      }),
      forecastHorizon: forecastLabel, forecastDays,
      totalPredictedBookings: 0, totalPredictedRevenue: 0,
      overallTopServices: [], method: 'insufficient_data',
      warning: 'Not enough historical data.',
      generatedAt: new Date().toISOString(),
    };
  }

  module.exports = router;