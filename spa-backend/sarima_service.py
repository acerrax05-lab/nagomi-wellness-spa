import os
import sys
import json
import logging
import warnings
from datetime import datetime, timedelta
from collections import defaultdict

import numpy as np
import pandas as pd
from flask import Flask, jsonify, request
from pymongo import MongoClient
from bson import ObjectId

# Suppress SARIMA convergence warnings in production
warnings.filterwarnings('ignore')
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
log = logging.getLogger(__name__)

# ── Try importing statsmodels (SARIMA) ────────────────────────────────────────
try:
    from statsmodels.tsa.statespace.sarimax import SARIMAX
    from statsmodels.tsa.stattools import adfuller
    SARIMA_AVAILABLE = True
    log.info("✅ statsmodels available — SARIMA enabled")
except ImportError:
    SARIMA_AVAILABLE = False
    log.warning("⚠️  statsmodels not found — falling back to moving average")

app = Flask(__name__)

# ── CONFIG ────────────────────────────────────────────────────────────────────
MONGO_URI  = os.getenv('MONGO_URI',  'mongodb://localhost:27017/spa_db')
DB_NAME    = os.getenv('DB_NAME',    'spa_db')
PORT       = int(os.getenv('SARIMA_PORT', 5001))

SEASONAL_PERIOD = 7
MIN_DATA_POINTS = 30

# ── DATABASE ──────────────────────────────────────────────────────────────────
def get_db():
    client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
    return client[DB_NAME]

# ── DATA FETCHING ─────────────────────────────────────────────────────────────
def fetch_time_series(lookback_days: int = 120) -> pd.DataFrame:
    db  = get_db()
    col = db['bookings']
    cutoff = datetime.utcnow() - timedelta(days=lookback_days)

    pipeline = [
        {
            '$match': {
                'date': {'$gte': cutoff},
                'status': {'$in': ['completed', 'confirmed', 'cancelled', 'pending']}
            }
        },
        {
            '$group': {
                '_id': {
                    '$dateToString': {
                        'format': '%Y-%m-%d',
                        'date': '$date'
                    }
                },
                'bookings': {'$sum': 1},
                'revenue': {
                    '$sum': {
                        '$cond': [
                            {'$eq': ['$status', 'completed']},
                            '$price',
                            0
                        ]
                    }
                }
            }
        },
        {'$sort': {'_id': 1}}
    ]

    results = list(col.aggregate(pipeline))

    if not results:
        log.warning("No data returned from MongoDB")
        return pd.DataFrame(columns=['bookings', 'revenue'])

    df = pd.DataFrame(results)
    df.rename(columns={'_id': 'date'}, inplace=True)
    df['date'] = pd.to_datetime(df['date'])
    df.set_index('date', inplace=True)

    full_idx = pd.date_range(df.index.min(), df.index.max(), freq='D')
    df = df.reindex(full_idx, fill_value=0)
    df.index.name = 'date'

    log.info(f"📊 Fetched {len(df)} days of data "
             f"({df.index.min().date()} → {df.index.max().date()})")
    log.info(f"   Total bookings: {df['bookings'].sum()}, "
             f"Total revenue: ₱{df['revenue'].sum():,.0f}")

    return df

# ── SARIMA MODEL ──────────────────────────────────────────────────────────────
def check_stationarity(series: pd.Series) -> bool:
    if len(series) < 20:
        return False
    try:
        result = adfuller(series.dropna(), autolag='AIC')
        return result[1] < 0.05
    except Exception:
        return False

def fit_sarima(series: pd.Series, forecast_days: int) -> dict:
    series = series.astype(float)

    is_stationary = check_stationarity(series)
    d = 0 if is_stationary else 1

    if len(series) >= SEASONAL_PERIOD * 2:
        seasonal_diff = series.diff(SEASONAL_PERIOD).dropna()
        is_seasonal_stationary = check_stationarity(seasonal_diff)
        D = 0 if is_seasonal_stationary else 1
    else:
        D = 1

    log.info(f"   Stationarity: d={d}, D={D}")

    best_aic   = np.inf
    best_model = None
    best_params = None

    candidate_orders = [
        (1, d, 1, 1, D, 1),
        (2, d, 1, 1, D, 1),
        (1, d, 2, 1, D, 1),
        (2, d, 2, 1, D, 1),
        (1, d, 1, 0, D, 1),
        (1, d, 1, 1, D, 0),
        (0, d, 1, 1, D, 1),
        (1, d, 0, 1, D, 1),
    ]

    for p, d_, q, P, D_, Q in candidate_orders:
        try:
            model = SARIMAX(
                series,
                order=(p, d_, q),
                seasonal_order=(P, D_, Q, SEASONAL_PERIOD),
                enforce_stationarity=False,
                enforce_invertibility=False,
            )
            fit = model.fit(disp=False, maxiter=200)
            if fit.aic < best_aic:
                best_aic    = fit.aic
                best_model  = fit
                best_params = (p, d_, q, P, D_, Q)
        except Exception:
            continue

    if best_model is None:
        raise RuntimeError("All SARIMA configurations failed to converge")

    log.info(f"   Best SARIMA{best_params[:3]}×{best_params[3:]}_{SEASONAL_PERIOD} "
             f"(AIC={best_aic:.2f})")

    forecast = best_model.get_forecast(steps=forecast_days)
    mean     = forecast.predicted_mean
    ci       = forecast.conf_int(alpha=0.20)

    return {
        'predictions':    np.maximum(0, mean.values).tolist(),
        'lower_bounds':   np.maximum(0, ci.iloc[:, 0].values).tolist(),
        'upper_bounds':   np.maximum(0, ci.iloc[:, 1].values).tolist(),
        'aic':            round(best_aic, 2),
        'order':          best_params[:3],
        'seasonal_order': best_params[3:] + (SEASONAL_PERIOD,),
        'reliability':    _reliability(best_aic, len(series)),
    }

def _reliability(aic: float, n: int) -> str:
    if n >= 90 and aic < 300:
        return 'high'
    if n >= 60 and aic < 500:
        return 'medium'
    return 'low'

# ── MOVING AVERAGE FALLBACK ───────────────────────────────────────────────────
def moving_average_forecast(series: pd.Series, forecast_days: int) -> dict:
    if len(series) == 0:
        preds = [0.0] * forecast_days
        return {'predictions': preds, 'lower_bounds': preds, 'upper_bounds': preds,
                'reliability': 'none', 'method': 'zero_fallback'}

    window  = min(21, len(series))
    recent  = series.iloc[-window:].values.astype(float)
    weights = np.exp(np.linspace(0, 1, window))
    weights /= weights.sum()
    base = float(np.dot(weights, recent))
    std  = float(recent.std()) if len(recent) > 1 else base * 0.3

    preds  = [max(0, round(base)) for _ in range(forecast_days)]
    lowers = [max(0, round(base - 1.5 * std)) for _ in range(forecast_days)]
    uppers = [round(base + 1.5 * std) for _ in range(forecast_days)]

    return {'predictions': preds, 'lower_bounds': lowers, 'upper_bounds': uppers,
            'reliability': 'low', 'method': 'weighted_moving_average'}

# ── SERVICE BREAKDOWN ─────────────────────────────────────────────────────────
def fetch_service_patterns(lookback_days: int) -> list:
    db  = get_db()
    col = db['bookings']
    cutoff = datetime.utcnow() - timedelta(days=lookback_days)

    pipeline = [
        {
            '$match': {
                'date': {'$gte': cutoff},
                'status': {'$in': ['completed', 'confirmed']}
            }
        },
        {
            '$lookup': {
                'from': 'services',
                'localField': 'service',
                'foreignField': '_id',
                'as': 'serviceDoc'
            }
        },
        # ✅ FIXED: was 'preserveNullAndEmpty' (invalid) → 'preserveNullAndEmptyArrays'
        {
            '$unwind': {
                'path': '$serviceDoc',
                'preserveNullAndEmptyArrays': True
            }
        },
        {
            '$group': {
                '_id': '$serviceDoc.name',
                'count': {'$sum': 1}
            }
        },
        {'$sort': {'count': -1}}
    ]

    results = list(col.aggregate(pipeline))
    total   = sum(r['count'] for r in results) or 1

    return [
        {
            'name':  r['_id'] or 'Unknown',
            'count': r['count'],
            'share': round(r['count'] / total * 100, 1)
        }
        for r in results[:6]
    ]

def fetch_peak_hours(lookback_days: int) -> dict:
    db  = get_db()
    col = db['bookings']
    cutoff = datetime.utcnow() - timedelta(days=lookback_days)

    bookings = list(col.find(
        {'date': {'$gte': cutoff}, 'time': {'$exists': True}},
        {'time': 1}
    ))

    hour_counts = defaultdict(int)
    for b in bookings:
        time_str = b.get('time', '')
        try:
            parts = time_str.split(' ')
            h = int(parts[0].split(':')[0])
            if parts[1] == 'PM' and h != 12:
                h += 12
            if parts[1] == 'AM' and h == 12:
                h = 0
            hour_counts[h] += 1
        except Exception:
            pass

    return dict(hour_counts)

# ── FORECAST PERIOD HELPERS ───────────────────────────────────────────────────
PERIOD_CONFIG = {
    'today': {'forecast_days': 7,  'lookback_days': 60,  'label': 'Next 7 Days'},
    'week':  {'forecast_days': 14, 'lookback_days': 90,  'label': 'Next 14 Days'},
    'month': {'forecast_days': 30, 'lookback_days': 120, 'label': 'Next 30 Days'},
    'year':  {'forecast_days': 90, 'lookback_days': 180, 'label': 'Next Quarter (90 Days)'},
}

# ── MAIN FORECAST ENDPOINT ────────────────────────────────────────────────────
@app.route('/predict', methods=['GET'])
def predict():
    period = request.args.get('period', 'today')
    cfg    = PERIOD_CONFIG.get(period, PERIOD_CONFIG['today'])

    forecast_days  = cfg['forecast_days']
    lookback_days  = cfg['lookback_days']
    forecast_label = cfg['label']

    log.info(f"🔮 Forecast request: period={period}, "
             f"forecast={forecast_days}d, lookback={lookback_days}d")

    try:
        df = fetch_time_series(lookback_days)

        if len(df) < MIN_DATA_POINTS:
            log.warning(f"Only {len(df)} days of data — using fallback")
            booking_result = moving_average_forecast(df['bookings'], forecast_days)
            revenue_result = moving_average_forecast(df['revenue'],  forecast_days)
            method = 'weighted_moving_average'
        elif SARIMA_AVAILABLE:
            log.info("📈 Fitting SARIMA for bookings...")
            booking_result = fit_sarima(df['bookings'], forecast_days)
            log.info("💰 Fitting SARIMA for revenue...")
            revenue_result = fit_sarima(df['revenue'], forecast_days)
            method = 'sarima'
        else:
            booking_result = moving_average_forecast(df['bookings'], forecast_days)
            revenue_result = moving_average_forecast(df['revenue'],  forecast_days)
            method = 'weighted_moving_average'

        service_patterns = fetch_service_patterns(lookback_days)

        day_names = ['Sunday','Monday','Tuesday','Wednesday',
                     'Thursday','Friday','Saturday']

        predictions = []
        base_date   = datetime.utcnow().date() + timedelta(days=1)

        for i in range(forecast_days):
            pred_date = base_date + timedelta(days=i)

            raw_bookings  = booking_result['predictions'][i]
            raw_revenue   = revenue_result['predictions'][i]
            pred_bookings = max(0, round(raw_bookings))
            pred_revenue  = max(0, round(raw_revenue))

            top_services = []
            remaining    = pred_bookings
            for j, svc in enumerate(service_patterns[:3]):
                if j == len(service_patterns[:3]) - 1:
                    count = remaining
                else:
                    count = max(0, round(pred_bookings * svc['share'] / 100))
                    remaining -= count
                if count > 0:
                    top_services.append({
                        'name':       svc['name'],
                        'count':      count,
                        'percentage': svc['share']
                    })

            predictions.append({
                'date':              pred_date.isoformat(),
                'dayName':           pred_date.strftime('%A'),
                'predictedBookings': pred_bookings,
                'predictedRevenue':  pred_revenue,
                'lowerBound':        max(0, round(booking_result['lower_bounds'][i])),
                'upperBound':        round(booking_result['upper_bounds'][i]),
                'topServices':       top_services,
                'peakHour':          'N/A',
                'confidence':        booking_result.get('reliability', 'medium').title(),
                'method':            method,
            })

        total_predicted_bookings = sum(p['predictedBookings'] for p in predictions)
        total_predicted_revenue  = sum(p['predictedRevenue']  for p in predictions)

        model_info = {}
        if method == 'sarima':
            model_info = {
                'bookings_order':          booking_result.get('order'),
                'bookings_seasonal_order': booking_result.get('seasonal_order'),
                'bookings_aic':            booking_result.get('aic'),
                'revenue_order':           revenue_result.get('order'),
                'revenue_seasonal_order':  revenue_result.get('seasonal_order'),
                'revenue_aic':             revenue_result.get('aic'),
                'seasonal_period':         SEASONAL_PERIOD,
            }

        response = {
            'predictions':            predictions,
            'forecastHorizon':        forecast_label,
            'forecastDays':           forecast_days,
            'lookbackDays':           lookback_days,
            'totalPredictedBookings': total_predicted_bookings,
            'totalPredictedRevenue':  total_predicted_revenue,
            'overallTopServices':     service_patterns,
            'method':                 method,
            'modelInfo':              model_info,
            'dataPoints':             len(df),
            'modelQuality': {
                'reliability':     booking_result.get('reliability', 'low'),
                'bookingsAIC':     booking_result.get('aic'),
                'revenueAIC':      revenue_result.get('aic'),
                'sarimaAvailable': SARIMA_AVAILABLE,
            },
            'generatedAt': datetime.utcnow().isoformat() + 'Z',
        }

        log.info(f"✅ Forecast complete: {total_predicted_bookings} bookings, "
                 f"₱{total_predicted_revenue:,.0f} revenue predicted")

        return jsonify(response)

    except Exception as e:
        log.error(f"❌ Forecast error: {e}", exc_info=True)
        return jsonify({'error': str(e), 'method': 'failed'}), 500

# ── HEALTH CHECK ──────────────────────────────────────────────────────────────
@app.route('/health', methods=['GET'])
def health():
    try:
        db    = get_db()
        count = db['bookings'].count_documents({})
        return jsonify({
            'status':           'ok',
            'sarima_available': SARIMA_AVAILABLE,
            'total_bookings':   count,
            'timestamp':        datetime.utcnow().isoformat() + 'Z',
        })
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

# ── TIME SERIES DEBUG ENDPOINT ────────────────────────────────────────────────
@app.route('/timeseries', methods=['GET'])
def timeseries():
    days = int(request.args.get('days', 120))
    try:
        df = fetch_time_series(days)
        records = df.reset_index().rename(columns={'index': 'date'})
        records['date'] = records['date'].dt.strftime('%Y-%m-%d')
        return jsonify({
            'data':                  records.to_dict(orient='records'),
            'total_days':            len(df),
            'avg_daily_bookings':    round(df['bookings'].mean(), 2),
            'avg_daily_revenue':     round(df['revenue'].mean(), 2),
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

# ── ENTRY POINT ───────────────────────────────────────────────────────────────
if __name__ == '__main__':
    log.info(f"🚀 Starting SARIMA microservice on port {PORT}")
    log.info(f"   MongoDB: {MONGO_URI}")
    log.info(f"   SARIMA:  {'enabled' if SARIMA_AVAILABLE else 'DISABLED — pip install statsmodels'}")
    app.run(host='0.0.0.0', port=PORT, debug=False)