/**
 * LINEAR REGRESSION - Foundation for trend analysis
 */
function linearRegression(data) {
  const n = data.length;
  
  if (n === 0) {
    return { slope: 0, intercept: 0, r2: 0 };
  }
  
  const x = Array.from({ length: n }, (_, i) => i);
  const y = data;
  
  const meanX = x.reduce((sum, val) => sum + val, 0) / n;
  const meanY = y.reduce((sum, val) => sum + val, 0) / n;
  
  let numerator = 0;
  let denominator = 0;
  
  for (let i = 0; i < n; i++) {
    numerator += (x[i] - meanX) * (y[i] - meanY);
    denominator += Math.pow(x[i] - meanX, 2);
  }
  
  const slope = denominator !== 0 ? numerator / denominator : 0;
  const intercept = meanY - slope * meanX;
  
  let ssRes = 0;
  let ssTot = 0;
  
  for (let i = 0; i < n; i++) {
    const predicted = slope * x[i] + intercept;
    ssRes += Math.pow(y[i] - predicted, 2);
    ssTot += Math.pow(y[i] - meanY, 2);
  }
  
  const r2 = ssTot !== 0 ? 1 - (ssRes / ssTot) : 0;
  
  return {
    slope,
    intercept,
    r2,
    predict: (futureX) => slope * futureX + intercept
  };
}

/**
 * EXPONENTIAL SMOOTHING - For stable trends
 */
function exponentialSmoothing(data, alpha = 0.3, periods = 7) {
  if (!data || data.length === 0) {
    return Array(periods).fill(0);
  }
  
  let smoothed = [data[0]];
  
  for (let i = 1; i < data.length; i++) {
    const newValue = alpha * data[i] + (1 - alpha) * smoothed[i - 1];
    smoothed.push(newValue);
  }
  
  const forecast = [];
  let lastSmoothed = smoothed[smoothed.length - 1];
  
  for (let i = 0; i < periods; i++) {
    forecast.push(Math.round(lastSmoothed));
  }
  
  return forecast;
}

/**
 * MOVING AVERAGE - Smooths noise
 */
function movingAverage(data, window = 7) {
  if (!data || data.length < window) {
    return data;
  }
  
  const result = [];
  
  for (let i = 0; i < data.length; i++) {
    if (i < window - 1) {
      result.push(data[i]);
    } else {
      const sum = data.slice(i - window + 1, i + 1).reduce((a, b) => a + b, 0);
      result.push(sum / window);
    }
  }
  
  return result;
}

/**
 * SEASONAL DECOMPOSITION - Extracts weekly patterns
 */
function calculateSeasonality(data, period = 7) {
  if (!data || data.length < period * 2) {
    return {
      hasSeasonality: false,
      pattern: []
    };
  }
  
  const pattern = Array(period).fill(0);
  const counts = Array(period).fill(0);
  
  data.forEach((value, index) => {
    const position = index % period;
    pattern[position] += value;
    counts[position]++;
  });
  
  for (let i = 0; i < period; i++) {
    pattern[i] = counts[i] > 0 ? pattern[i] / counts[i] : 0;
  }
  
  const mean = pattern.reduce((sum, val) => sum + val, 0) / period;
  const variance = pattern.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / period;
  
  const hasSeasonality = variance > mean * 0.1;
  
  return {
    hasSeasonality,
    pattern,
    strength: variance / (mean || 1)
  };
}

/**
 * HYBRID ENSEMBLE FORECASTING
 * Combines Linear Regression + Exponential Smoothing + Seasonality
 */
function hybridEnsembleForecast(historicalData, periods = 7) {
  if (!historicalData || historicalData.length === 0) {
    return {
      predictions: Array(periods).fill(0),
      confidence: Array(periods).fill({ lower: 0, upper: 0 }),
      method: 'insufficient_data',
      reliability: 'none',
      ensemble: { linear: 0, exponential: 0, seasonal: 0 }
    };
  }
  
  console.log('🔮 HYBRID ENSEMBLE FORECAST:');
  console.log(`   Data points: ${historicalData.length}`);
  console.log(`   Forecast periods: ${periods}`);
  
  // METHOD 1: Linear Regression (captures trend)
  const linearModel = linearRegression(historicalData);
  const linearPredictions = [];
  const startIndex = historicalData.length;
  
  for (let i = 0; i < periods; i++) {
    const predicted = linearModel.predict(startIndex + i);
    linearPredictions.push(Math.max(0, predicted));
  }
  
  console.log(`   📈 Linear R²: ${linearModel.r2.toFixed(3)}`);
  
  // METHOD 2: Exponential Smoothing (stable baseline)
  const expPredictions = exponentialSmoothing(historicalData, 0.3, periods);
  
  // METHOD 3: Seasonal Pattern (day-of-week effects)
  const seasonality = calculateSeasonality(historicalData, 7);
  const seasonalPredictions = [];
  
  if (seasonality.hasSeasonality) {
    console.log(`   🌊 Seasonality detected (strength: ${seasonality.strength.toFixed(2)})`);
    
    for (let i = 0; i < periods; i++) {
      const dayIndex = (historicalData.length + i) % 7;
      const seasonalValue = seasonality.pattern[dayIndex];
      seasonalPredictions.push(seasonalValue);
    }
  } else {
    console.log(`   🌊 No strong seasonality detected`);
    const avgValue = historicalData.reduce((sum, v) => sum + v, 0) / historicalData.length;
    seasonalPredictions.push(...Array(periods).fill(avgValue));
  }
  
  // ENSEMBLE WEIGHTS - Based on data quality
  let linearWeight = 0.4;
  let expWeight = 0.3;
  let seasonalWeight = 0.3;
  
  // Adjust weights based on R² (model fit quality)
  if (linearModel.r2 > 0.7) {
    // High confidence in linear trend
    linearWeight = 0.5;
    expWeight = 0.25;
    seasonalWeight = 0.25;
  } else if (linearModel.r2 < 0.3) {
    // Low confidence in trend, rely more on patterns
    linearWeight = 0.2;
    expWeight = 0.3;
    seasonalWeight = 0.5;
  }
  
  if (seasonality.hasSeasonality && seasonality.strength > 0.5) {
    // Strong seasonal pattern
    seasonalWeight = 0.5;
    linearWeight = 0.3;
    expWeight = 0.2;
  }
  
  console.log(`   ⚖️  Weights: Linear=${linearWeight}, Exp=${expWeight}, Seasonal=${seasonalWeight}`);
  
  // COMBINE PREDICTIONS (Weighted Average)
  const ensemblePredictions = [];
  
  for (let i = 0; i < periods; i++) {
    const combined = 
      (linearPredictions[i] * linearWeight) +
      (expPredictions[i] * expWeight) +
      (seasonalPredictions[i] * seasonalWeight);
    
    ensemblePredictions.push(Math.max(0, Math.round(combined)));
  }
  
  // CONFIDENCE INTERVALS (based on historical variance)
  const mean = historicalData.reduce((sum, val) => sum + val, 0) / historicalData.length;
  const variance = historicalData.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / historicalData.length;
  const stdDev = Math.sqrt(variance);
  
  // ✅ REALISTIC BOUNDS (±1.5 standard deviations)
  const confidence = ensemblePredictions.map(pred => ({
    lower: Math.max(0, Math.round(pred - 1.5 * stdDev)),
    upper: Math.round(pred + 1.5 * stdDev)
  }));
  
  // Determine reliability
  let reliability = 'low';
  if (linearModel.r2 > 0.7 && historicalData.length >= 14) {
    reliability = 'high';
  } else if (linearModel.r2 > 0.4 && historicalData.length >= 7) {
    reliability = 'medium';
  }
  
  console.log(`   ✅ Ensemble predictions: [${ensemblePredictions.slice(0, 3).join(', ')}...]`);
  console.log(`   📊 Reliability: ${reliability}`);
  
  return {
    predictions: ensemblePredictions,
    confidence,
    method: 'hybrid_ensemble',
    reliability,
    r2: linearModel.r2,
    ensemble: {
      linear: linearPredictions,
      exponential: expPredictions,
      seasonal: seasonalPredictions,
      weights: { linearWeight, expWeight, seasonalWeight }
    }
  };
}

/**
 * CALCULATE TREND
 */
function calculateTrend(data) {
  if (!data || data.length < 2) {
    return {
      slope: 0,
      intercept: 0,
      direction: 'stable',
      strength: 0,
      correlation: 0
    };
  }
  
  const regression = linearRegression(data);
  
  let direction = 'stable';
  if (regression.slope > 0.1) direction = 'increasing';
  else if (regression.slope < -0.1) direction = 'decreasing';
  
  return {
    slope: regression.slope,
    intercept: regression.intercept,
    direction,
    strength: Math.abs(regression.slope),
    correlation: Math.sqrt(regression.r2)
  };
}

/**
 * ANOMALY DETECTION
 */
function detectAnomalies(data, threshold = 2) {
  if (!data || data.length < 3) {
    return [];
  }
  
  const mean = data.reduce((sum, val) => sum + val, 0) / data.length;
  const squaredDiffs = data.map(val => Math.pow(val - mean, 2));
  const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / data.length;
  const stdDev = Math.sqrt(variance);
  
  if (stdDev === 0) {
    return [];
  }
  
  const anomalies = [];
  
  data.forEach((value, index) => {
    const zScore = (value - mean) / stdDev;
    
    if (Math.abs(zScore) > threshold) {
      anomalies.push({
        index,
        value,
        zScore,
        isAnomaly: true,
        type: zScore > 0 ? 'spike' : 'drop'
      });
    }
  });
  
  return anomalies;
}

/**
 * GENERATE RECOMMENDATIONS
 */
function generateRecommendations(analyticsData) {
  const recommendations = [];
  
  const {
    bookingTrend,
    revenueTrend,
    cancellationRate,
    peakHours,
    lowPerformingServices,
    topServices,
    therapistUtilization,
    averageSuccessRate
  } = analyticsData;
  
  // Booking trend recommendations
  if (bookingTrend && bookingTrend.direction === 'decreasing') {
    recommendations.push({
      type: 'critical',
      priority: 'high',
      icon: '📉',
      title: 'Declining Bookings Detected',
      message: 'Your booking rate is trending downward. Immediate action recommended.',
      impact: 'Could result in 20-30% revenue loss if trend continues',
      actions: [
        'Launch promotional campaign to attract new customers',
        'Offer loyalty discounts to existing clients',
        'Review and improve online booking experience',
        'Increase social media marketing efforts'
      ]
    });
  } else if (bookingTrend && bookingTrend.direction === 'increasing') {
    recommendations.push({
      type: 'success',
      priority: 'medium',
      icon: '📈',
      title: 'Strong Booking Growth',
      message: 'Your bookings are trending upward. Prepare for increased demand.',
      impact: 'Potential 15-25% revenue increase if sustained',
      actions: [
        'Consider hiring additional therapists',
        'Extend working hours during peak times',
        'Optimize therapist schedules for efficiency',
        'Stock up on supplies for increased demand'
      ]
    });
  }
  
  // Cancellation rate
  if (cancellationRate > 20) {
    recommendations.push({
      type: 'warning',
      priority: 'high',
      icon: '⚠️',
      title: 'High Cancellation Rate',
      message: `Your cancellation rate is ${cancellationRate.toFixed(1)}%, above the 15% healthy threshold.`,
      impact: 'Lost revenue and wasted therapist availability',
      actions: [
        'Implement cancellation fee policy',
        'Send appointment reminders 24 hours before',
        'Require deposits for bookings',
        'Follow up with clients to understand reasons'
      ]
    });
  }
  
  // Peak hours optimization
  if (peakHours && Array.isArray(peakHours)) {
    const maxBookings = Math.max(...peakHours);
    const peakHourIndex = peakHours.indexOf(maxBookings);
    
    if (maxBookings > 0) {
      const peakTime = peakHourIndex > 12 
        ? `${peakHourIndex - 12}:00 PM` 
        : peakHourIndex === 12 
          ? '12:00 PM'
          : `${peakHourIndex}:00 AM`;
      
      recommendations.push({
        type: 'info',
        priority: 'medium',
        icon: '⏰',
        title: 'Peak Hour Optimization',
        message: `Your busiest hour is ${peakTime} with ${maxBookings} bookings.`,
        impact: 'Optimize staffing to maximize revenue during peak times',
        actions: [
          `Ensure all therapists are available around ${peakTime}`,
          'Schedule breaks during off-peak hours',
          'Consider premium pricing during peak hours',
          'Promote off-peak hours with discounts'
        ]
      });
    }
  }
  
  // Low-performing services
  if (lowPerformingServices && lowPerformingServices.length > 0) {
    recommendations.push({
      type: 'warning',
      priority: 'low',
      icon: '💡',
      title: 'Underperforming Services',
      message: `${lowPerformingServices.length} service(s) have fewer than 3 bookings.`,
      impact: 'Wasted marketing and menu complexity',
      actions: [
        'Remove services with no demand',
        'Bundle low-demand services with popular ones',
        'Retrain staff or adjust service descriptions',
        'Run targeted promotions for underperforming services'
      ]
    });
  }
  
  // Therapist utilization
  if (therapistUtilization && Array.isArray(therapistUtilization)) {
    const lowUtilization = therapistUtilization.filter(t => t.rate < 60);
    
    if (lowUtilization.length > 0) {
      recommendations.push({
        type: 'info',
        priority: 'medium',
        icon: '👥',
        title: 'Therapist Utilization Alert',
        message: `${lowUtilization.length} therapist(s) have success rate below 60%.`,
        impact: 'Inefficient resource allocation',
        actions: [
          'Review therapist schedules and availability',
          'Provide additional training or support',
          'Adjust booking assignments for balance',
          'Consider performance improvement plans'
        ]
      });
    }
  }
  
  // Revenue trend
  if (revenueTrend && revenueTrend.direction === 'decreasing') {
    recommendations.push({
      type: 'critical',
      priority: 'high',
      icon: '💰',
      title: 'Revenue Decline Detected',
      message: 'Your revenue is trending downward despite stable bookings.',
      impact: 'Potential profit margin squeeze',
      actions: [
        'Review and adjust service pricing',
        'Promote higher-margin services',
        'Introduce premium add-ons',
        'Analyze cost structure for savings'
      ]
    });
  }
  
  // Success rate optimization
  if (averageSuccessRate < 70) {
    recommendations.push({
      type: 'warning',
      priority: 'high',
      icon: '✅',
      title: 'Low Booking Completion Rate',
      message: `Only ${averageSuccessRate.toFixed(1)}% of bookings are completed.`,
      impact: 'Revenue loss and customer satisfaction issues',
      actions: [
        'Investigate reasons for incomplete bookings',
        'Improve appointment reminder system',
        'Streamline check-in and service process',
        'Address customer satisfaction concerns'
      ]
    });
  }
  
  return recommendations;
}

module.exports = {
  linearRegression,
  exponentialSmoothing,
  movingAverage,
  calculateTrend,
  detectAnomalies,
  calculateSeasonality,
  hybridEnsembleForecast,
  generateRecommendations
};