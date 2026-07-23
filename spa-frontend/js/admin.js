// js/admin.js 
const apiBase = 'https://nagomi-backend.onrender.com/api';

// ─── Patch fetch with retry + "server waking up" toast ───────────────────────
(function () {
  const _nativeFetch = window.fetch.bind(window);
  const MAX_RETRIES    = 4;
  const RETRY_DELAY_MS = 4000;

  function _showWakeToast() {
    if (document.getElementById('_wakeToast')) return;
    const t = document.createElement('div');
    t.id = '_wakeToast';
    t.style.cssText = `
      position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
      background:#4b2e1e;color:#fff;padding:14px 24px;border-radius:10px;
      font-size:0.95rem;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,0.25);
      display:flex;align-items:center;gap:10px;pointer-events:none;`;
    t.innerHTML = `<span style="font-size:1.2rem;">⏳</span>
      <span>Server is waking up, please wait…</span>`;
    document.body.appendChild(t);
  }
  function _hideWakeToast() {
    const t = document.getElementById('_wakeToast');
    if (t) t.remove();
  }

  window.fetch = async function (url, options = {}) {
    // Only retry calls to our own backend
    if (typeof url !== 'string' || !url.includes('nagomi-backend.onrender.com')) {
      return _nativeFetch(url, options);
    }
    let lastErr;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await _nativeFetch(url, options);
        if ([502, 503, 504].includes(res.status) && attempt < MAX_RETRIES) {
          _showWakeToast();
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
          continue;
        }
        _hideWakeToast();
        return res;
      } catch (err) {
        lastErr = err;
        if (attempt < MAX_RETRIES) {
          _showWakeToast();
          await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        }
      }
    }
    _hideWakeToast();
    throw lastErr;
  };
})();
// ─────────────────────────────────────────────────────────────────────────────
  const token = localStorage.getItem("token");
  const user = JSON.parse(localStorage.getItem("user") || "{}");

  if (!token || user.role !== "admin") {
    window.location.replace("login.html");
  }

  const loader = document.getElementById("loader");
  let currentPeriod = 'today';
  let selectedDate = null;
  let activeBookingStatusFilter = 'all'; // 'all' | 'pending' | 'confirmed' | 'completed' | 'cancelled' | 'pending_reschedule' | 'pending_cancellation'

  // ── Booking status filter (called from HTML buttons) ──────────────────────
  window.setBookingFilter = function(status) {
    activeBookingStatusFilter = status;
    // Update button styles
    document.querySelectorAll('.bsf-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.status === status);
    });
    // Re-render current date with new filter
    if (selectedDate) loadBookingsForDate(selectedDate);
  };
  let allBookings = [];
  let currentChart = {};
  let filteredBookingsData = []; // Store filtered data for detail views
  let currentIncomePeriod = 'today';
  let currentCardPeriod   = 'today';
  let incomeRefreshInterval;
  let commissionSettings = {
    rate: 60, // 60% commission
    baseRate: 0 // Optional hourly base rate
  };
  let predictionsData = [];
  let comprehensiveAnalytics = null;
  let lastDataUpdate = null;
  let updateInterval = null;
  let forecastEnabled = true;
  let currentBookingsData = []; 
  let currentPeriodRange = {
    start: null,
    end: null,
    label: 'Today'
  };
  let searchTerm = '';
let assigningBookingId = null;
let holidayTargetDate = null;
let holidayIsRemoving = false;
let storeClosures = []; // [{ id, label, start, end }] — single days have start === end

  document.getElementById("adminName").textContent = user.name;

  const socket = io('https://nagomi-backend.onrender.com', {
    transports: ['websocket', 'polling']
  });

  socket.on('connect', () => {
    console.log(' Connected to server');
    socket.emit('join', { userId: user._id, role: user.role });
  });

  socket.on('newBooking', (data) => {
    showNotification('New booking received!', 'success');
    addNotif(` New booking: ${data?.guestName || 'Client'} — ${data?.service?.name || ''}`, 'booking', 'bookings');
    const activeTab = document.querySelector('.tab-content.active')?.id;
    if (activeTab === 'overview-tab') loadOverviewData();
    else if (activeTab === 'bookings-tab') loadBookingsCalendar();
  });

  socket.on('new-booking', (data) => {
    showNotification('New booking received!', 'success');
    addNotif(` New booking: ${data?.guestName || 'Client'} — ${data?.service?.name || ''}`, 'booking', 'bookings');
    const activeTab = document.querySelector('.tab-content.active')?.id;
    if (activeTab === 'overview-tab') loadOverviewData();
    else if (activeTab === 'bookings-tab') loadBookingsCalendar();
  });

  socket.on('bookingStatusUpdated', () => {
    const activeTab = document.querySelector('.tab-content.active')?.id;
    if (activeTab === 'overview-tab') loadOverviewData();
    else if (activeTab === 'bookings-tab') loadBookingsCalendar();
  });

  socket.on('booking-cancelled', (data) => {
    addNotif(` Cancellation request: ${data?.guestName || 'Client'} — ${data?.service?.name || ''}`, 'cancel', 'bookings');
  });

  socket.on('reschedule-request', (data) => {
    addNotif(` Reschedule request: ${data?.guestName || 'Client'} — ${data?.service?.name || ''}`, 'reschedule', 'bookings');
  });

  socket.on('leave-request', (data) => {
    addNotif(` Leave request from ${data?.therapistName || 'a therapist'}`, 'leave', 'leave-requests');
    const badge = document.getElementById('leaveSidebarBadge');
    if (badge) { badge.style.display = 'flex'; badge.textContent = (parseInt(badge.textContent)||0)+1; }
  });

  // Debounce helper — prevents search firing on every single keystroke
  let searchDebounceTimer = null;

  document.getElementById('bookingSearchInput')?.addEventListener('input', (e) => {
    searchTerm = e.target.value.toLowerCase().trim();
    const clearBtn = document.getElementById('clearSearchBtn');
    const infoDiv  = document.getElementById('searchResultsInfo');

    if (searchTerm) {
      clearBtn.style.display = 'block';
      // Show "searching…" immediately so the UI doesn't appear frozen
      if (infoDiv) infoDiv.innerHTML = `<span style="color:#999;font-size:0.9rem;"> Searching…</span>`;
      clearTimeout(searchDebounceTimer);
      // 500ms debounce — waits until user stops typing before filtering
      searchDebounceTimer = setTimeout(() => {
        performBookingSearch();
      }, 500);
    } else {
      clearTimeout(searchDebounceTimer);
      if (infoDiv) infoDiv.innerHTML = '';
      clearBookingSearch();
    }
  });

  function performBookingSearch() {
    const searchResults = allBookings.filter(booking => {
      const name = (booking.guestName || '').toLowerCase();
      const phone = (booking.guestPhone || '').toLowerCase();
      const service = (booking.service?.name || '').toLowerCase();
      const transactionNum = (booking.transactionNumber || '').toLowerCase();
      const status = (booking.status || '').toLowerCase();
      
      return name.includes(searchTerm) ||
            phone.includes(searchTerm) ||
            service.includes(searchTerm) ||
            transactionNum.includes(searchTerm) ||
            status.includes(searchTerm);
    });
    
    displaySearchResults(searchResults);
  }


  function displaySearchResults(results) {
  const tbody = document.querySelector('#bookingsTable tbody');
  const infoDiv = document.getElementById('searchResultsInfo');

  // ── Info banner ──────────────────────────────────────────────────
  if (results.length === 0) {
    infoDiv.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="color:#dc3545;font-weight:600;"> No bookings found matching "${searchTerm}"</span>
      </div>`;
  } else {
    infoDiv.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-weight:600;color:#2196f3;"> Found ${results.length} booking${results.length !== 1 ? 's' : ''}</span>
        <span style="color:#666;font-size:0.85rem;"> Click any booking to view its full details on the calendar</span>
      </div>`;
  }

  // ── Empty state ──────────────────────────────────────────────────
  if (results.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="8" style="text-align:center;padding:40px;color:#999;">
        <div style="font-size:3rem;margin-bottom:15px;"></div>
        <p style="font-size:1.1rem;margin-bottom:8px;">No bookings found</p>
        <p style="font-size:0.9rem;">Try: name, phone, transaction number, service, or status</p>
      </td></tr>`;
    return;
  }

  // ── Sort once, build ALL rows as one string, set innerHTML ONCE ──
  // This avoids the O(n) DOM re-parse that caused the lag/crash.
  const statusColors = { pending:'#ffc107', confirmed:'#2196f3', completed:'#28a745', cancelled:'#dc3545' };

  const sorted = results.slice().sort((a, b) => new Date(b.date) - new Date(a.date));

  const html = sorted.map((booking, index) => {
    const dateStr = new Date(booking.date).toLocaleDateString('en-US', {
      weekday:'short', month:'short', day:'numeric', year:'numeric'
    });
    const therapistDisplay = booking.therapists?.length
      ? booking.therapists.map(t => t.name).join(', ')
      : booking.therapist?.name || 'Unassigned';
    const statusColor = statusColors[booking.status] || '#6c757d';
    const genderHtml = (booking.femaleClients > 0 || booking.maleClients > 0)
      ? `<div style="margin-bottom:4px;">
           <span style="font-size:0.78rem;color:#be185d;font-weight:600;">${booking.femaleClients ?? 0}</span>
           <span style="font-size:0.78rem;color:#1d4ed8;font-weight:600;margin-left:4px;">${booking.maleClients ?? 0}</span>
         </div>`
      : '';

    return `
      <tr data-booking-id="${booking._id}"
          style="cursor:pointer;border-left:4px solid ${statusColor};${index === 0 ? 'background:#f0f7ff;' : ''}"
          onmouseover="this.style.background='#f5f1eb';this.style.transform='translateX(4px)';this.style.boxShadow='0 2px 8px rgba(0,0,0,0.1)';"
          onmouseout="this.style.background='${index === 0 ? '#f0f7ff' : ''}';this.style.transform='translateX(0)';this.style.boxShadow='none';"
          onclick="navigateToBookingDate('${booking._id}')">
        <td>
          <div style="font-weight:600;font-size:1rem;margin-bottom:4px;">${booking.guestName}</div>
          ${genderHtml}
          <div style="font-size:0.85rem;color:#666;"> ${booking.guestPhone || '—'}</div>
          <div style="font-size:0.85rem;color:#666;"> <span style="font-family:monospace;background:#f5f5f5;padding:2px 6px;border-radius:4px;">${booking.transactionNumber || '—'}</span></div>
        </td>
        <td>
          <div style="font-weight:600;color:#4b2e1e;">${dateStr}</div>
          <div style="font-size:0.85rem;color:#666;margin-top:2px;">${booking.time || '—'}</div>
        </td>
        <td>${booking.service?.name || 'N/A'}</td>
        <td>${therapistDisplay}</td>
        <td>${booking.durationMinutes} mins</td>
        <td style="font-weight:600;">₱${(booking.price || 0).toLocaleString()}</td>
        <td><span class="status-badge status-${booking.status}" style="background:${statusColor};color:white;">${booking.status}</span></td>
        <td><div style="display:flex;align-items:center;gap:6px;font-size:0.9rem;color:#2196f3;font-weight:600;"> View on Calendar →</div></td>
      </tr>`;
  }).join('');

  // Single DOM write — no looping innerHTML +=
  tbody.innerHTML = html;
}

  function navigateToBookingDate(bookingId) {
  console.log(' Navigating to booking:', bookingId);
  
  const booking = allBookings.find(b => b._id === bookingId);
  
  if (!booking) {
    showNotification('Booking not found', 'error');
    return;
  }
  
  const bookingDate = new Date(booking.date);
  console.log(' Booking date:', bookingDate);
  
  // Clear search first
  clearBookingSearch();
  
  // Update calendar to show booking's month
  currentMonth = bookingDate.getMonth();
  currentYear = bookingDate.getFullYear();
  
  console.log(' Setting calendar to:', currentYear, currentMonth);
  
  // Render calendar
  renderCalendar();
  
  // Wait for calendar to render, then select the date
  setTimeout(() => {
    const dateStr = bookingDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    console.log(' Selecting date:', dateStr);
    
    // Remove existing selections
    document.querySelectorAll('.calendar-day').forEach(day => {
      day.classList.remove('selected');
    });
    
    // Find and click the calendar day
    const calendarDays = document.querySelectorAll('.calendar-day');
    let foundDay = false;
    
    calendarDays.forEach(dayCell => {
      const cellText = dayCell.textContent.trim();
      const cellDay = parseInt(cellText);
      
      // Skip if not a valid day number
      if (isNaN(cellDay)) return;
      
      // Create date for this cell
      const cellDate = new Date(currentYear, currentMonth, cellDay);
      const cellDateStr = cellDate.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
      
      // Check if this is the target date
      if (cellDateStr === dateStr) {
        console.log(' Found matching day:', cellDay);
        foundDay = true;
        
        // Add selected class
        dayCell.classList.add('selected');
        
        // Set selected date globally
        selectedDate = dateStr;
        
        // Load bookings for this date
        loadBookingsForDate(dateStr);
        
        // Scroll to bookings table
        const bookingsTable = document.querySelector('#selectedDateTitle');
        if (bookingsTable) {
          bookingsTable.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'start' 
          });
        }
        
        // Highlight the specific booking row after a delay
        setTimeout(() => {
          highlightBookingRow(bookingId);
        }, 800);
      }
    });
    
    if (!foundDay) {
      console.warn('️ Could not find day in calendar for date:', dateStr);
      showNotification('Date found but not visible in calendar', 'warning');
    }
  }, 300);
}

  function highlightBookingRow(bookingId) {
  console.log(' Highlighting booking row:', bookingId);
  
  const rows = document.querySelectorAll('#bookingsTable tbody tr[data-booking-id]');
  console.log(' Found rows:', rows.length);
  
  let foundRow = false;
  
  rows.forEach(row => {
    if (row.dataset.bookingId === bookingId) {
      console.log(' Found target row');
      foundRow = true;
      
      // Add highlight animation
      row.style.animation = 'highlightPulse 2s ease-in-out';
      row.style.backgroundColor = '#fff8e1';
      row.style.border = '2px solid #ffc107';
      row.style.boxShadow = '0 4px 12px rgba(255, 193, 7, 0.4)';
      
      // Scroll row into view
      row.scrollIntoView({ 
        behavior: 'smooth', 
        block: 'center',
        inline: 'nearest'
      });
      
      // Remove highlight after 4 seconds
      setTimeout(() => {
        row.style.animation = '';
        row.style.backgroundColor = '';
        row.style.border = '';
        row.style.boxShadow = '';
      }, 4000);
    }
  });
  
  if (!foundRow) {
    console.warn('️ Could not find row with booking ID:', bookingId);
  }
}

  function getTherapistDisplay(booking) {
    if (booking.therapists && booking.therapists.length > 0) {
      return booking.therapists.map(t => t.name).join(', ');
    } else if (booking.therapist) {
      return booking.therapist.name;
    } else {
      return '<span style="color: #999; font-style: italic;">Unassigned</span>';
    }
  }


  function clearBookingSearch() {
  searchTerm = '';
  const searchInput = document.getElementById('bookingSearchInput');
  const clearBtn    = document.getElementById('clearSearchBtn');
  const infoDiv     = document.getElementById('searchResultsInfo');
  const mobileList  = document.getElementById('mobileBookingList');

  if (searchInput) searchInput.value = '';
  if (clearBtn)    clearBtn.style.display = 'none';
  if (infoDiv)     infoDiv.innerHTML = '';
  if (mobileList)  mobileList.innerHTML = '';

  // Reload current date or show placeholder
  if (selectedDate) {
    loadBookingsForDate(selectedDate);
  } else {
    const tbody = document.querySelector('#bookingsTable tbody');
    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align:center;padding:40px;color:#999;">
            <div style="font-size:3rem;margin-bottom:15px;"></div>
            <p style="font-size:1.1rem;">Select a date from the calendar to view bookings</p>
          </td>
        </tr>`;
    }
  }
}

function normalizeDate(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
}

  // TAB SWITCHING — with cache to avoid reloading on every click
  // Each tab only reloads if it hasn't been loaded yet, or if data is stale (>5 min)
  const TAB_CACHE_TTL       = 5 * 60 * 1000;  // 5 minutes for tabs
  const ANALYTICS_CACHE_TTL = 3 * 60 * 1000;  // 3 minutes for analytics
  const tabLastLoaded  = {};
  const analyticsCache = {}; // keyed by period

  function isTabStale(tabName) {
    const last = tabLastLoaded[tabName];
    if (!last) return true;
    return (Date.now() - last) > TAB_CACHE_TTL;
  }

  function markTabLoaded(tabName) { tabLastLoaded[tabName] = Date.now(); }

  function isAnalyticsCacheValid(period) {
    const c = analyticsCache[period];
    if (!c) return false;
    return (Date.now() - c.timestamp) < ANALYTICS_CACHE_TTL;
  }

  document.querySelectorAll('.sidebar .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      
      document.querySelectorAll('.sidebar .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      const tabEl = document.getElementById(`${tab}-tab`);
      if (tabEl) tabEl.classList.add('active');

      // Only reload if stale — prevents unnecessary re-fetching on tab switch
      if (!isTabStale(tab)) {
        console.log(` Tab "${tab}" cached — skipping reload`);
        return;
      }
      
      switch(tab) {
        case 'overview':
          loadOverviewData();
          markTabLoaded('overview');
          break;
        case 'bookings':
          loadBookingsCalendar();
          loadPendingRequests();
          markTabLoaded('bookings');
          break;
        case 'services':
          loadServices();
          markTabLoaded('services');
          break;
        case 'therapists':
          loadTherapistsWithAnalytics();
          markTabLoaded('therapists');
          break;
        case 'grace-periods':
          loadGracePeriods();
          markTabLoaded('grace-periods');
          break;
        case 'reviews':
          loadReviewsManagement();
          markTabLoaded('reviews');
          break;
        case 'income':
          loadCommissionSettings();
          loadIncomeData();
          markTabLoaded('income');
          break;
        case 'leave-requests':
          loadLeaveRequests();
          markTabLoaded('leave-requests');
          break;
      }
    });
  });


  //Load Therapist
  async function loadTherapistsWithAnalytics() {
    try {
      console.log(' Loading therapists tab with analytics...');
      
      // Load therapist cards first (most important — show immediately)
      await loadTherapists();

      // Load the rest in parallel — no need to wait for each one
      await Promise.allSettled([
        loadTherapistPerformance(),
        loadCommissionSettings(),
        loadIncomeData(),
      ]);
      
      // Start auto-refresh for status (every 30 seconds)
      startStatusAutoRefresh();
      
      console.log(' Therapists tab fully loaded');
      
    } catch (err) {
      console.error(' Error loading therapists tab:', err);
      showNotification('Failed to load therapist analytics', 'error');
    }
  }

// Set Today as active on initial load
const defaultBtn = document.querySelector('.filter-btn[data-period="today"]');
if (defaultBtn) defaultBtn.classList.add('active');

document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // Only handle overview period buttons — income/card buttons have data-income-period / data-card-period
    if (!btn.dataset.period) return;

    document.querySelectorAll('.filter-btn[data-period]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    currentPeriod = btn.dataset.period;
    console.log(' Period changed to:', currentPeriod);

    // Invalidate overview cache so it reloads with new period
    tabLastLoaded['overview'] = null;

    loadOverviewData();
    updateChartTitles();
  });
});

  // Add this function to admin.js
async function loadSarimaStatus() {
  const indicator = document.getElementById('sarimaStatusIndicator');
  if (!indicator) return;

  try {
    const res = await fetch(`${apiBase}/analytics/sarima-status`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();

    if (data.available && data.sarimaEnabled) {
      indicator.innerHTML = `
        <span style="color:#28a745;font-weight:600;font-size:0.85rem;">
           SARIMA Active
        </span>`;
    } else if (data.available && !data.sarimaEnabled) {
      indicator.innerHTML = `
        <span style="color:#ff9800;font-weight:600;font-size:0.85rem;">
          ️ Service up but statsmodels missing — run: pip install statsmodels
        </span>`;
    } else {
      indicator.innerHTML = `
        <span style="color:#dc3545;font-weight:600;font-size:0.85rem;">
          ️ JS Fallback (SARIMA offline — run: python sarima_service.py)
        </span>`;
    }
  } catch {
    indicator.innerHTML = `<span style="color:#dc3545;font-size:0.85rem;">️ JS Fallback active</span>`;
  }
}

// Only check SARIMA status for month/year — not needed for today/week
if (currentPeriod === 'month' || currentPeriod === 'year') {
  loadSarimaStatus();
}

  // UPDATE STAT CARD LABELS BASED ON PERIOD
  function updateStatLabels() {
    const labels = {
      today: {
        bookings: "Today's Bookings",
        completed: "Completed Today",
        revenue: "Today's Revenue",
        cancelled: "Cancelled Today",
        therapists: "Active Therapists Today"
      },
      week: {
        bookings: "This Week's Bookings",
        completed: "Completed This Week",
        revenue: "This Week's Revenue",
        cancelled: "Cancelled This Week",
        therapists: "Active Therapists This Week"
      },
      month: {
        bookings: "This Month's Bookings",
        completed: "Completed This Month",
        revenue: "This Month's Revenue",
        cancelled: "Cancelled This Month",
        therapists: "Active Therapists This Month"
      },
      year: {
        bookings: "This Year's Bookings",
        completed: "Completed This Year",
        revenue: "This Year's Revenue",
        cancelled: "Cancelled This Year",
        therapists: "Active Therapists This Year"
      }
    };
    
    // FIX: Add safety check
    const currentLabels = labels[currentPeriod];
    
    if (!currentLabels) {
      console.warn('️ Invalid period:', currentPeriod);
      return;
    }
    
    // FIX: Add null checks for each element
    const elements = {
      periodBookingsLabel: currentLabels.bookings,
      periodCompletedLabel: currentLabels.completed,
      periodRevenueLabel: currentLabels.revenue,
      periodCancelledLabel: currentLabels.cancelled,
      periodTherapistsLabel: currentLabels.therapists
    };
    
    // Update each element safely
    Object.keys(elements).forEach(id => {
      const element = document.getElementById(id);
      if (element) {
        element.textContent = elements[id];
      }
    });
  }


  //  Load comprehensive analytics
  async function loadComprehensiveAnalytics() {
    try {
      // Return cached data if still valid
      if (isAnalyticsCacheValid(currentPeriod)) {
        console.log(` Analytics cache hit for period: ${currentPeriod}`);
        comprehensiveAnalytics = analyticsCache[currentPeriod].data;
        return comprehensiveAnalytics;
      }

      console.log(' Loading comprehensive analytics...');
      
      const res = await fetch(`${apiBase}/analytics/comprehensive?period=${currentPeriod}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (!res.ok) throw new Error('Failed to load comprehensive analytics');
      
      comprehensiveAnalytics = await res.json();
      lastDataUpdate = new Date(comprehensiveAnalytics.lastUpdated);

      // Cache the result
      analyticsCache[currentPeriod] = { data: comprehensiveAnalytics, timestamp: Date.now() };
      
      console.log(' Comprehensive analytics loaded');
      updateLastUpdatedTimestamp();
      startDataRefreshTimer();
      return comprehensiveAnalytics;
      
    } catch (err) {
      console.error(' Error loading comprehensive analytics:', err);
      showNotification('Failed to load advanced analytics', 'error');
      return null;
    }
  }


  //  Update timestamp display
  function updateLastUpdatedTimestamp() {
    if (!lastDataUpdate) return;
    
    const now = new Date();
    const diff = Math.floor((now - lastDataUpdate) / 1000); // seconds
    
    let timeAgo = '';
    if (diff < 60) {
      timeAgo = `${diff} second${diff !== 1 ? 's' : ''} ago`;
    } else if (diff < 3600) {
      const mins = Math.floor(diff / 60);
      timeAgo = `${mins} minute${mins !== 1 ? 's' : ''} ago`;
    } else {
      const hours = Math.floor(diff / 3600);
      timeAgo = `${hours} hour${hours !== 1 ? 's' : ''} ago`;
    }
    
    const timestamp = lastDataUpdate.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Manila'
    });
    
    // Find all timestamp elements and update them
    document.querySelectorAll('.data-timestamp').forEach(el => {
      el.innerHTML = `<span style="color: #28a745;">●</span> Updated as of ${timestamp} PH Time (${timeAgo})`;
    });
  }

  // Returns how many days have actually elapsed in the selected period
function getElapsedDays(period) {
  const now = new Date();
  switch (period) {
    case 'today': return 1;
    case 'week': {
      const dow = now.getDay();
      return Math.max(1, dow === 0 ? 7 : dow);
    }
    case 'month':
      return Math.max(1, now.getDate());
    case 'year': {
      const yearStart = new Date(now.getFullYear(), 0, 1);
      return Math.max(1, Math.ceil((now - yearStart) / 86400000));
    }
    default: return 30;
  }
}

function clampPercent(raw) {
  const MAX = 99;
  if (raw > MAX)  return { value: MAX,  capped: true,  sign: '+' };
  if (raw < -MAX) return { value: -MAX, capped: true,  sign: '' };
  return           { value: raw,        capped: false, sign: raw >= 0 ? '+' : '' };
}

function dailyRateChange(actualTotal, actualDays, forecastTotal, forecastDays) {
  if (!actualDays || actualDays === 0)   return 0;
  if (!forecastDays || forecastDays === 0) return 0;

  const actualRate   = actualTotal   / actualDays;
  const forecastRate = forecastTotal / forecastDays;

  if (actualRate === 0) return 0;
  return ((forecastRate - actualRate) / actualRate) * 100;
}

function getPreviousPeriodBookings() {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  switch (currentPeriod) {
    case 'today': {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return allBookings.filter(b => {
        const d = new Date(b.date);
        return d.toDateString() === yesterday.toDateString();
      });
    }
    case 'week': {
      // Monday of THIS week
      const dow = (today.getDay() + 6) % 7;           // 0=Mon…6=Sun
      const thisMonday = new Date(today);
      thisMonday.setDate(today.getDate() - dow);
      // Full previous week
      const prevSun = new Date(thisMonday);
      prevSun.setDate(prevSun.getDate() - 1);
      const prevMon = new Date(prevSun);
      prevMon.setDate(prevMon.getDate() - 6);
      return allBookings.filter(b => {
        const d = new Date(b.date);
        return d >= prevMon && d <= prevSun;
      });
    }
    case 'month': {
      const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const prevMonthEnd   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
      return allBookings.filter(b => {
        const d = new Date(b.date);
        return d >= prevMonthStart && d <= prevMonthEnd;
      });
    }
    case 'year': {
      const prevYearStart = new Date(now.getFullYear() - 1, 0, 1);
      const prevYearEnd   = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);
      return allBookings.filter(b => {
        const d = new Date(b.date);
        return d >= prevYearStart && d <= prevYearEnd;
      });
    }
    default:
      return [];
  }
}

/**
 * Builds a %, label, and color for a current vs previous comparison.
 * @param {number} current
 * @param {number} previous
 * @param {string} prefix   '' or '₱'
 */
function compareToPrevPeriod(current, previous, prefix = '') {
  const periodName = {
    today: 'vs yesterday',
    week:  'vs last week',
    month: 'vs last month',
    year:  'vs last year',
  }[currentPeriod] || 'vs previous';

  if (previous === 0 && current === 0) {
    return { rawPct: 0, label: `No data ${periodName}`, color: '#6c757d' };
  }
  if (previous === 0) {
    return { rawPct: 100, label: `New activity (no prior data ${periodName})`, color: '#28a745' };
  }

  const rawPct = ((current - previous) / previous) * 100;
  const { value: pct, capped } = clampPercent(rawPct);
  const capSign = capped ? (rawPct > 0 ? '+' : '') : '';
  const icon    = rawPct > 0 ? '↑' : rawPct < 0 ? '↓' : '→';
  const color   = rawPct > 0 ? '#28a745' : rawPct < 0 ? '#dc3545' : '#6c757d';
  const sign    = rawPct >= 0 ? '+' : '';

  const fmtCurr = prefix ? `${prefix}${current.toLocaleString()}` : String(current);
  const fmtPrev = prefix ? `${prefix}${previous.toLocaleString()}` : String(previous);

  const label = `${icon} ${sign}${Math.abs(pct).toFixed(1)}${capSign}% ${periodName} (${fmtPrev} → ${fmtCurr})`;
  return { rawPct, label, color };
}

function buildTodayHourForecast(hourCounts) {
  if (!forecastEnabled || !predictionsData || predictionsData.length === 0) return null;

  const avgPredDaily = predictionsData
    .slice(0, 7)
    .reduce((s, p) => s + (p.predictedBookings || 0), 0) / 7;

  const totalToday = hourCounts.reduce((s, v) => s + v, 0);
  if (totalToday === 0) {
    // No bookings today yet — flat distribution
    return hourCounts.map(() => Math.round(avgPredDaily / 24));
  }
  return hourCounts.map(c => Math.round((c / totalToday) * avgPredDaily));
}

function buildServicesChartForecast(labels, serviceCounts) {
  if (!forecastEnabled || !predictionsData || predictionsData.length === 0) return null;

  // Sum each service's predicted count across the entire forecast window.
  // The totals already reflect the full horizon SARIMA projected — rescaling
  // them to elapsed days made forecasts look lower than actuals by ~30 %.
  const predictedByService = {};
  predictionsData.forEach(pred => {
    (pred.topServices || []).forEach(s => {
      predictedByService[s.name] = (predictedByService[s.name] || 0) + s.count;
    });
  });

  return labels.map(name => {
    if (predictedByService[name] != null) {
      return Math.round(predictedByService[name]);
    }
    // Service absent from predictions — apply a small growth nudge
    return Math.round((serviceCounts[name] || 0) * 1.05);
  });
}


  //  Auto-refresh timer
  function startDataRefreshTimer() {
    // Clear existing interval
    if (updateInterval) {
      clearInterval(updateInterval);
    }
    
    // Update timestamp display every 10 seconds
    updateInterval = setInterval(() => {
      updateLastUpdatedTimestamp();
    }, 10000);
    
    // Auto-refresh data every 10 minutes (was 5 — reduces server load on free tier)
    setInterval(() => {
      // Only refresh if overview tab is active
      const overviewTab = document.getElementById('overview-tab');
      if (overviewTab && overviewTab.classList.contains('active')) {
        console.log(' Auto-refreshing analytics data...');
        loadOverviewData();
        loadComprehensiveAnalytics();
      }
    }, 600000); // 10 minutes
  }

  // Show forecast/analytics modal for each chart
  function showChartForecast(chartType) {
    if (!comprehensiveAnalytics) {
      showNotification('Loading analytics data...', 'info');
      loadComprehensiveAnalytics().then(data => {
        if (data) {
          displayChartSpecificForecast(chartType, data);
        }
      });
      return;
    }
    
    displayChartSpecificForecast(chartType, comprehensiveAnalytics);
  }

  async function displayChartSpecificForecast(chartType, analytics) {
    const modal = document.getElementById('statDetailModal');
    const title = document.getElementById('statDetailTitle');
    const content = document.getElementById('statDetailContent');
    
    const chartTitles = {
      peakHours: '⏰ Peak Hours Forecast & Capacity Planning',
      services: ' Service Performance & Demand Forecast',
      revenue: ' Revenue Forecast & Trends',
      revenueStatus: ' Revenue Status & Financial Health',
      bookingDist: ' Booking Distribution & Completion Rate',
      predictions: ' Booking Predictions & Insights'
    };
    
    title.textContent = chartTitles[chartType] || 'Analytics & Forecast';
    
    // Load enhanced predictions for forecasting
    const predictionsData = await loadEnhancedPredictions();
    
    let specificContent = '';
    
    switch(chartType) {
      case 'peakHours':
        specificContent = generatePeakHoursInsight(analytics, predictionsData);
        break;
      case 'services':
        specificContent = generateServicesInsight(analytics, predictionsData);
        break;
      case 'revenue':
        specificContent = generateRevenueInsight(analytics, predictionsData);
        break;
      case 'revenueStatus':
        specificContent = generateRevenueStatusInsight(analytics, predictionsData);
        break;
      case 'bookingDist':
        specificContent = generateBookingDistInsight(analytics, predictionsData);
        break;
      case 'predictions':
        specificContent = generatePredictionsInsight(analytics, predictionsData);
        break;
      default:
        specificContent = '<p>No specific insights available</p>';
    }
    
    content.innerHTML = `
      <div style="padding: 20px;">
        ${specificContent}
        
        <!-- Period Comparison Section -->
        ${generatePeriodComparison()}
        
        <!-- Recommendations Section -->
        ${analytics.recommendations && analytics.recommendations.length > 0 ? `
          <div style="margin-top: 40px; padding: 25px; background: linear-gradient(135deg, #fff8e1 0%, #ffe082 30%, #fff8e1 100%); border-radius: 12px; border-left: 4px solid #ff9800;">
            <h3 style="color: #4b2e1e; margin-bottom: 20px; display: flex; align-items: center; gap: 10px;">
              <span style="font-size: 2rem;"></span>
              <span>AI-Powered Recommendations</span>
            </h3>
            ${analytics.recommendations.slice(0, 3).map(rec => `
              <div style="background: white; padding: 20px; border-radius: 10px; margin-bottom: 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                  <span style="font-size: 2rem;">${rec.icon}</span>
                  <div>
                    <h4 style="margin: 0; color: #4b2e1e; font-size: 1.1rem;">${rec.title}</h4>
                    <p style="margin: 4px 0 0 0; color: #666; font-size: 0.9rem;">${rec.message}</p>
                  </div>
                </div>
                <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #f0f0f0;">
                  <strong style="color: #4b2e1e; font-size: 0.9rem;">Actions:</strong>
                  <ul style="margin: 8px 0 0 20px; padding: 0; color: #555;">
                    ${rec.actions.map(action => `<li style="margin-bottom: 5px;">${action}</li>`).join('')}
                  </ul>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;
    
    modal.classList.add('active');
  }

  //Generate of peak
  function generatePeakHoursInsight(analytics, predictionsData) {
    const { predictions } = predictionsData || {};
    
    // Calculate predicted peak hours from predictions
    const peakHourCounts = {};
    
    if (predictions && predictions.length > 0) {
      predictions.forEach(pred => {
        const hour = pred.peakHour;
        if (hour && hour !== 'N/A') {
          peakHourCounts[hour] = (peakHourCounts[hour] || 0) + pred.predictedBookings;
        }
      });
    }
    
    const topPeakHours = Object.entries(peakHourCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    
    return `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 25px; border-radius: 12px; color: white; margin-bottom: 25px;">
        <h3 style="margin: 0 0 10px 0; font-size: 1.5rem;">⏰ Peak Hours Analysis</h3>
        <p style="margin: 0; opacity: 0.9; font-size: 0.95rem;">
          Optimize staffing and capacity based on demand patterns
        </p>
      </div>
      
      <!-- Predicted Peak Hours for Next 7 Days -->
      <div style="margin-bottom: 30px;">
        <h4 style="color: #4b2e1e; margin-bottom: 20px;"> Predicted Peak Hours </h4>
        ${topPeakHours.length > 0 ? `
          <div style="display: grid; gap: 12px;">
            ${topPeakHours.map(([hour, count], index) => `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 15px; background: ${index === 0 ? '#fff8e1' : '#f8f9fa'}; border-radius: 8px; ${index === 0 ? 'border: 2px solid #ffc107;' : ''}">
                <div>
                  <div style="font-weight: 700; color: #4b2e1e;">
                    ${index === 0 ? ' ' : index === 1 ? ' ' : index === 2 ? ' ' : '⏰ '}${hour}
                  </div>
                  <div style="color: #666; font-size: 0.85rem; margin-top: 4px;">
                    ${index === 0 ? 'Highest demand period' : 'High demand period'}
                  </div>
                </div>
                <div style="text-align: right;">
                  <div style="font-size: 1.8rem; font-weight: 700; color: #4b2e1e;">${count}</div>
                  <div style="font-size: 0.75rem; color: #999;">expected bookings</div>
                </div>
              </div>
            `).join('')}
          </div>
        ` : '<p style="color: #999;">Not enough data to predict peak hours</p>'}
      </div>
      
      <!-- Capacity Planning Recommendations -->
      <div style="padding: 20px; background: #e3f2fd; border-radius: 12px; border-left: 4px solid #2196f3;">
        <h4 style="color: #1565c0; margin: 0 0 15px 0;"> Capacity Planning Recommendations</h4>
        <ul style="margin: 0; padding-left: 20px; color: #666; line-height: 1.8;">
          <li><strong>Peak Hours:</strong> Ensure all therapists are available during ${topPeakHours[0]?.[0] || 'busy periods'}</li>
          <li><strong>Staffing:</strong> Schedule ${Math.ceil(topPeakHours[0]?.[1] / 2 || 2)} therapists minimum during peak times</li>
          <li><strong>Off-Peak:</strong> Consider promotional discounts during slower hours to balance demand</li>
          <li><strong>Break Times:</strong> Schedule therapist breaks during low-demand hours</li>
        </ul>
      </div>
    `;
  }

  function generateServicesInsight(analytics, predictionsData) {
    const { servicePerformance } = analytics;
    const { overallTopServices, predictions } = predictionsData || {};
    
    return `
      <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); padding: 25px; border-radius: 12px; color: white; margin-bottom: 25px;">
        <h3 style="margin: 0 0 10px 0; font-size: 1.5rem;"> Service Performance Analysis</h3>
        <p style="margin: 0; opacity: 0.9; font-size: 0.95rem;">
          Analyze service demand and forecast future bookings
        </p>
      </div>
      
      <!-- Predicted Top Services -->
      <div style="margin-bottom: 30px;">
        <h4 style="color: #4b2e1e; margin-bottom: 20px;"> Predicted Top Services </h4>
        ${overallTopServices && overallTopServices.length > 0 ? `
          <div style="display: grid; gap: 12px;">
            ${overallTopServices.map((service, index) => `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 15px; background: ${index < 3 ? '#fff8e1' : '#f8f9fa'}; border-radius: 8px; ${index < 3 ? 'border: 2px solid #ffc107;' : ''}">
                <div style="display: flex; align-items: center; gap: 12px;">
                  <span style="font-size: 1.8rem;">${index === 0 ? '' : index === 1 ? '' : index === 2 ? '' : '⭐'}</span>
                  <div>
                    <div style="font-weight: 700; color: #4b2e1e;">${service.name}</div>
                    <div style="color: #666; font-size: 0.85rem;">Expected demand</div>
                  </div>
                </div>
                <div style="text-align: right;">
                  <div style="font-size: 1.8rem; font-weight: 700; color: #28a745;">${service.count}</div>
                  <div style="font-size: 0.75rem; color: #999;">bookings</div>
                </div>
              </div>
            `).join('')}
          </div>
        ` : '<p style="color: #999;">Not enough data to predict service demand</p>'}
      </div>
      
      <!-- Current Performance -->
      <div style="margin-top: 30px;">
        <h4 style="color: #4b2e1e; margin-bottom: 20px;"> Current Period Performance</h4>
        ${servicePerformance && servicePerformance.length > 0 ? `
          <div style="display: grid; gap: 10px;">
            ${servicePerformance.slice(0, 5).map((service, index) => `
              <div style="display: flex; justify-content: space-between; padding: 12px; background: #f8f9fa; border-radius: 8px;">
                <span style="font-weight: 600; color: #4b2e1e;">${service.name}</span>
                <div style="text-align: right;">
                  <span style="font-weight: 700; color: #28a745; margin-right: 15px;">₱${service.revenue.toLocaleString()}</span>
                  <span style="color: #666;">${service.bookings} bookings</span>
                </div>
              </div>
            `).join('')}
          </div>
        ` : '<p style="color: #999;">No service data available</p>'}
      </div>
      
      <!-- Service Recommendations -->
      <div style="margin-top: 25px; padding: 20px; background: #fff3e0; border-radius: 12px; border-left: 4px solid #ff9800;">
        <h4 style="color: #e65100; margin: 0 0 15px 0;"> Service Optimization Tips</h4>
        <ul style="margin: 0; padding-left: 20px; color: #666; line-height: 1.8;">
          <li><strong>Top Service:</strong> Ensure adequate therapist capacity for ${overallTopServices?.[0]?.name || 'popular services'}</li>
          <li><strong>Cross-Selling:</strong> Create bundles combining top and underperforming services</li>
          <li><strong>Promotions:</strong> Offer discounts on services with low demand to increase bookings</li>
          <li><strong>Training:</strong> Train more therapists on high-demand services</li>
        </ul>
      </div>
    `;
  }

  function generateRevenueInsight(analytics, predictionsData) {
    const { summary, trends } = analytics;
    const { totalPredictedRevenue, predictions } = predictionsData || {};
    
    // Calculate predicted revenue growth
    const currentRevenue = summary.totalRevenue;
    const revenueGrowth = currentRevenue > 0 
      ? ((totalPredictedRevenue - currentRevenue) / currentRevenue * 100)
      : 0;
    
    return `
      <div style="background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%); padding: 25px; border-radius: 12px; color: white; margin-bottom: 25px;">
        <h3 style="margin: 0 0 10px 0; font-size: 1.5rem;"> Revenue Forecast & Analysis</h3>
        <p style="margin: 0; opacity: 0.9; font-size: 0.95rem;">
          Track revenue trends and predict future earnings
        </p>
      </div>
      
      <!-- Revenue Comparison -->
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 30px;">
        <div style="padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; color: white;">
          <div style="font-size: 0.9rem; opacity: 0.9;">Current Period Revenue</div>
          <div style="font-size: 2.5rem; font-weight: 700; margin: 10px 0;">₱${currentRevenue.toLocaleString()}</div>
          <div style="font-size: 0.85rem; opacity: 0.8;">From ${summary.completedBookings} completed bookings</div>
        </div>
        <div style="padding: 20px; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); border-radius: 12px; color: white;">
          <div style="font-size: 0.9rem; opacity: 0.9;">Predicted Revenue </div>
          <div style="font-size: 2.5rem; font-weight: 700; margin: 10px 0;">₱${(totalPredictedRevenue || 0).toLocaleString()}</div>
          <div style="font-size: 0.85rem; opacity: 0.8;">
            ${revenueGrowth >= 0 ? '' : ''} ${Math.abs(revenueGrowth).toFixed(1)}% vs current period
          </div>
        </div>
      </div>
      
      <!-- Daily Revenue Forecast -->
      <div style="margin-bottom: 30px;">
        <h4 style="color: #4b2e1e; margin-bottom: 20px;"> Daily Revenue Forecast</h4>
        ${predictions && predictions.length > 0 ? `
          <div style="display: grid; gap: 10px;">
            ${predictions.slice(0, 7).map((pred, index) => `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 15px; background: ${pred.predictedRevenue > (totalPredictedRevenue / 7) ? '#fff8e1' : '#f8f9fa'}; border-radius: 8px;">
                <div>
                  <div style="font-weight: 700; color: #4b2e1e;">${pred.dayName}</div>
                  <div style="color: #666; font-size: 0.85rem;">${new Date(pred.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                </div>
                <div style="text-align: right;">
                  <div style="font-size: 1.5rem; font-weight: 700; color: #28a745;">₱${pred.predictedRevenue.toLocaleString()}</div>
                  <div style="font-size: 0.75rem; color: #999;">${pred.predictedBookings} bookings</div>
                </div>
              </div>
            `).join('')}
          </div>
        ` : '<p style="color: #999;">Not enough data for revenue forecast</p>'}
      </div>
      
      <!-- Revenue Growth Tips -->
      <div style="padding: 20px; background: #e8f5e9; border-radius: 12px; border-left: 4px solid #4caf50;">
        <h4 style="color: #2e7d32; margin: 0 0 15px 0;"> Revenue Growth Strategies</h4>
        <ul style="margin: 0; padding-left: 20px; color: #666; line-height: 1.8;">
          <li><strong>Upselling:</strong> Train staff to recommend longer duration services (90 or 120 minutes)</li>
          <li><strong>Package Deals:</strong> Create service bundles to increase average transaction value</li>
          <li><strong>Premium Services:</strong> Introduce high-margin specialty treatments</li>
          <li><strong>Loyalty Program:</strong> Encourage repeat bookings with rewards</li>
        </ul>
      </div>
    `;
  }

  function generateRevenueStatusInsight(analytics, predictionsData) {
    const { summary } = analytics;
    const { totalPredictedRevenue } = predictionsData || {};
    
    const earnedRevenue = summary.totalRevenue;
    const retainedDP = Math.round(earnedRevenue * 0.25);
    const revenueLoss = summary.cancelledBookings * (summary.averageRevenuePerBooking || 1500); // Estimate
    
    return `
      <div style="background: linear-gradient(135deg, #fa709a 0%, #fee140 100%); padding: 25px; border-radius: 12px; color: white; margin-bottom: 25px;">
        <h3 style="margin: 0 0 10px 0; font-size: 1.5rem;"> Revenue Status & Financial Health</h3>
        <p style="margin: 0; opacity: 0.9; font-size: 0.95rem;">
          Track earned revenue, retained deposits, and revenue loss
        </p>
      </div>
      
      <!-- Financial Status Cards -->
      <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 30px;">
        <div style="padding: 20px; background: #e8f5e9; border-radius: 12px; text-align: center;">
          <div style="font-size: 0.9rem; color: #666; margin-bottom: 8px;">Earned Revenue</div>
          <div style="font-size: 1.8rem; font-weight: 700; color: #4caf50;">₱${earnedRevenue.toLocaleString()}</div>
          <div style="font-size: 0.75rem; color: #999; margin-top: 4px;">From completed services</div>
        </div>
        <div style="padding: 20px; background: #fff3e0; border-radius: 12px; text-align: center;">
          <div style="font-size: 0.9rem; color: #666; margin-bottom: 8px;">Retained Down Payment</div>
          <div style="font-size: 1.8rem; font-weight: 700; color: #ff9800;">₱${retainedDP.toLocaleString()}</div>
          <div style="font-size: 0.75rem; color: #999; margin-top: 4px;">25% of earned revenue</div>
        </div>
        <div style="padding: 20px; background: #ffebee; border-radius: 12px; text-align: center;">
          <div style="font-size: 0.9rem; color: #666; margin-bottom: 8px;">Revenue Loss</div>
          <div style="font-size: 1.8rem; font-weight: 700; color: #f44336;">₱${revenueLoss.toLocaleString()}</div>
          <div style="font-size: 0.75rem; color: #999; margin-top: 4px;">From ${summary.cancelledBookings} cancellations</div>
        </div>
      </div>
      
      <!-- Financial Health Metrics -->
      <div style="margin-bottom: 30px;">
        <h4 style="color: #4b2e1e; margin-bottom: 20px;"> Financial Health Metrics</h4>
        <div style="display: grid; gap: 12px;">
          <div style="padding: 15px; background: #f8f9fa; border-radius: 8px;">
            <div style="display: flex; justify-content: space-between;">
              <span style="font-weight: 600; color: #4b2e1e;">Completion Rate</span>
              <span style="font-weight: 700; color: ${summary.completedBookings / summary.totalBookings * 100 >= 80 ? '#28a745' : '#ff9800'};">
                ${summary.totalBookings > 0 ? Math.round(summary.completedBookings / summary.totalBookings * 100) : 0}%
              </span>
            </div>
            <div style="color: #666; font-size: 0.85rem; margin-top: 4px;">
              ${summary.completedBookings} of ${summary.totalBookings} bookings completed
            </div>
          </div>
          <div style="padding: 15px; background: #f8f9fa; border-radius: 8px;">
            <div style="display: flex; justify-content: space-between;">
              <span style="font-weight: 600; color: #4b2e1e;">Average Revenue per Booking</span>
              <span style="font-weight: 700; color: #4b2e1e;">₱${summary.averageRevenuePerBooking.toLocaleString()}</span>
            </div>
            <div style="color: #666; font-size: 0.85rem; margin-top: 4px;">
              Target: ₱1,500 - ₱2,000 per booking
            </div>
          </div>
          <div style="padding: 15px; background: #f8f9fa; border-radius: 8px;">
            <div style="display: flex; justify-content: space-between;">
              <span style="font-weight: 600; color: #4b2e1e;">Cancellation Rate</span>
              <span style="font-weight: 700; color: ${summary.cancelledBookings / summary.totalBookings * 100 <= 15 ? '#28a745' : '#dc3545'};">
                ${summary.totalBookings > 0 ? Math.round(summary.cancelledBookings / summary.totalBookings * 100) : 0}%
              </span>
            </div>
            <div style="color: #666; font-size: 0.85rem; margin-top: 4px;">
              Target: Below 15%
            </div>
          </div>
        </div>
      </div>
      
      <!-- Predicted Future Revenue -->
      ${totalPredictedRevenue ? `
        <div style="padding: 20px; background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%); border-radius: 12px; border-left: 4px solid #2196f3;">
          <h4 style="color: #1565c0; margin: 0 0 12px 0;"> Predicted Revenue </h4>
          <div style="font-size: 2rem; font-weight: 700; color: #1976d2; margin-bottom: 8px;">₱${totalPredictedRevenue.toLocaleString()}</div>
          <p style="color: #666; margin: 0; line-height: 1.6;">
            Expected down payment collection: <strong>₱${Math.round(totalPredictedRevenue * 0.25).toLocaleString()}</strong>
          </p>
        </div>
      ` : ''}
    `;
  }

  function generateBookingDistInsight(analytics, predictionsData) {
    const { summary } = analytics;
    const { predictions, totalPredictedBookings } = predictionsData || {};
    
    const completionRate = summary.totalBookings > 0 
      ? (summary.completedBookings / summary.totalBookings * 100)
      : 0;
    
    const cancellationRate = summary.totalBookings > 0
      ? (summary.cancelledBookings / summary.totalBookings * 100)
      : 0;
    
    return `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 25px; border-radius: 12px; color: white; margin-bottom: 25px;">
        <h3 style="margin: 0 0 10px 0; font-size: 1.5rem;"> Booking Distribution & Completion Analysis</h3>
        <p style="margin: 0; opacity: 0.9; font-size: 0.95rem;">
          Analyze booking patterns and predict future demand
        </p>
      </div>
      
      <!-- Current Distribution -->
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 30px;">
        <div style="padding: 20px; background: #e8f5e9; border-radius: 12px;">
          <div style="font-size: 0.9rem; color: #666; margin-bottom: 8px;">Completion Rate</div>
          <div style="font-size: 2.5rem; font-weight: 700; color: #4caf50;">${completionRate.toFixed(1)}%</div>
          <div style="font-size: 0.85rem; color: #999; margin-top: 4px;">
            ${summary.completedBookings} of ${summary.totalBookings} bookings
          </div>
        </div>
        <div style="padding: 20px; background: #ffebee; border-radius: 12px;">
          <div style="font-size: 0.9rem; color: #666; margin-bottom: 8px;">Cancellation Rate</div>
          <div style="font-size: 2.5rem; font-weight: 700; color: #f44336;">${cancellationRate.toFixed(1)}%</div>
          <div style="font-size: 0.85rem; color: #999; margin-top: 4px;">
            ${summary.cancelledBookings} cancelled bookings
          </div>
        </div>
      </div>
      
      <!-- Predicted Bookings -->
      <div style="margin-bottom: 30px;">
        <h4 style="color: #4b2e1e; margin-bottom: 20px;"> Predicted Bookings </h4>
        ${predictions && predictions.length > 0 ? `
          <div style="padding: 20px; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); border-radius: 12px; color: white; margin-bottom: 20px;">
            <div style="font-size: 0.9rem; opacity: 0.9;">Total Predicted Bookings</div>
            <div style="font-size: 2.5rem; font-weight: 700; margin: 10px 0;">${totalPredictedBookings}</div>
            
          </div>
          
          <div style="display: grid; gap: 10px;">
            ${predictions.slice(0, 7).map((pred, index) => `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 15px; background: ${pred.predictedBookings > (totalPredictedBookings / 7) ? '#fff8e1' : '#f8f9fa'}; border-radius: 8px;">
                <div>
                  <div style="font-weight: 700; color: #4b2e1e;">${pred.dayName}</div>
                  <div style="color: #666; font-size: 0.85rem;">
                    ${new Date(pred.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    ${pred.confidence ? `• ${pred.confidence} confidence` : ''}
                  </div>
                </div>
                <div style="text-align: right;">
                  <div style="font-size: 1.5rem; font-weight: 700; color: #4b2e1e;">${pred.predictedBookings}</div>
                  <div style="font-size: 0.75rem; color: #999;">bookings</div>
                </div>
              </div>
            `).join('')}
          </div>
        ` : '<p style="color: #999;">Not enough data for booking predictions</p>'}
      </div>
      
      <!-- Performance Insights -->
      <div style="padding: 20px; background: #fff3e0; border-radius: 12px; border-left: 4px solid #ff9800;">
        <h4 style="color: #e65100; margin: 0 0 15px 0;"> Performance Insights</h4>
        <ul style="margin: 0; padding-left: 20px; color: #666; line-height: 1.8;">
          <li><strong>Target:</strong> Maintain completion rate above 85% and cancellation rate below 15%</li>
          <li><strong>Action:</strong> ${completionRate < 85 ? 'Implement reminder system to reduce no-shows' : 'Excellent completion rate - keep it up!'}</li>
          <li><strong>Optimization:</strong> ${cancellationRate > 15 ? 'Review cancellation policy and require deposits' : 'Low cancellation rate - good customer commitment'}</li>
          <li><strong>Planning:</strong> Prepare for ${totalPredictedBookings} bookings</li>
        </ul>
      </div>
    `;
  }

  // UPDATE ALL STAT CARDS WITH INSIGHTS
  function generatePredictionsInsight(analytics, predictionsData) {
    // This is the same as the main comprehensive insights
    // We'll call the existing function
    return displayComprehensiveInsightsContent(predictionsData, analytics);
  }

  function generatePeriodComparison() {
    // Get current period stats
    const currentStats = {
      period: currentPeriod,
      bookings: filteredBookingsData.length,
      revenue: filteredBookingsData
        .filter(b => b.status === 'completed')
        .reduce((sum, b) => sum + (b.price || 0), 0),
      completed: filteredBookingsData.filter(b => b.status === 'completed').length,
      cancelled: filteredBookingsData.filter(b => b.status === 'cancelled').length
    };
    
    const periodLabels = {
      today: 'Today',
      week: 'This Week',
      month: 'This Month',
      year: 'This Year'
    };
    
    // Calculate averages and percentages
    const completionRate = currentStats.bookings > 0 
      ? (currentStats.completed / currentStats.bookings * 100).toFixed(1)
      : 0;
    
    const cancellationRate = currentStats.bookings > 0
      ? (currentStats.cancelled / currentStats.bookings * 100).toFixed(1)
      : 0;
    
    const avgRevenuePerBooking = currentStats.completed > 0
      ? Math.round(currentStats.revenue / currentStats.completed)
      : 0;
    
    return `
      <div style="margin-top: 40px; padding: 25px; background: linear-gradient(135deg, #e3f2fd 0%, #bbdefb 100%); border-radius: 12px; border-left: 4px solid #2196f3;">
        <h3 style="color: #1565c0; margin-bottom: 20px; display: flex; align-items: center; gap: 10px;">
          <span style="font-size: 2rem;"></span>
          <span>${periodLabels[currentStats.period]} Performance Summary</span>
        </h3>
        
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px;">
          <div style="background: white; padding: 15px; border-radius: 8px; text-align: center;">
            <div style="font-size: 0.85rem; color: #666; margin-bottom: 6px;">Total Bookings</div>
            <div style="font-size: 2rem; font-weight: 700; color: #4b2e1e;">${currentStats.bookings}</div>
          </div>
          
          <div style="background: white; padding: 15px; border-radius: 8px; text-align: center;">
            <div style="font-size: 0.85rem; color: #666; margin-bottom: 6px;">Completion Rate</div>
            <div style="font-size: 2rem; font-weight: 700; color: ${completionRate >= 80 ? '#28a745' : '#ff9800'};">
              ${completionRate}%
            </div>
          </div>
          
          <div style="background: white; padding: 15px; border-radius: 8px; text-align: center;">
            <div style="font-size: 0.85rem; color: #666; margin-bottom: 6px;">Total Revenue</div>
            <div style="font-size: 1.5rem; font-weight: 700; color: #28a745;">
              ₱${currentStats.revenue.toLocaleString()}
            </div>
          </div>
          
          <div style="background: white; padding: 15px; border-radius: 8px; text-align: center;">
            <div style="font-size: 0.85rem; color: #666; margin-bottom: 6px;">Avg per Booking</div>
            <div style="font-size: 1.5rem; font-weight: 700; color: #4b2e1e;">
              ₱${avgRevenuePerBooking.toLocaleString()}
            </div>
          </div>
        </div>
        
        <div style="margin-top: 15px; padding: 12px; background: white; border-radius: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span style="color: #666;">Cancellation Rate:</span>
            <span style="font-weight: 700; color: ${cancellationRate <= 15 ? '#28a745' : '#dc3545'};">
              ${cancellationRate}% (${currentStats.cancelled} cancellations)
            </span>
          </div>
        </div>
      </div>
    `;
  }

  function displayForecastModal(chartType, analytics) {
    const modal = document.getElementById('statDetailModal');
    const title = document.getElementById('statDetailTitle');
    const content = document.getElementById('statDetailContent');
    
    const chartTitles = {
      bookings: ' Booking Forecast & Insights',
      revenue: ' Revenue Forecast & Trends',
      services: ' Service Performance Analysis',
      peakHours: '⏰ Peak Hours & Capacity Planning',
      therapists: ' Therapist Performance Analytics'
    };
    
    title.textContent = chartTitles[chartType] || 'Analytics & Forecast';
    
    const { summary, trends, forecast, recommendations, servicePerformance, therapistUtilization, anomalies } = analytics;
    
    content.innerHTML = `
      <div style="padding: 20px;">
        <!-- Last Updated Indicator -->
        <div class="data-timestamp" style="
          padding: 12px 20px;
          background: linear-gradient(135deg, #e8f5e9 0%, #c8e6c9 100%);
          border-radius: 8px;
          margin-bottom: 25px;
          text-align: center;
          font-size: 0.95rem;
          font-weight: 600;
          color: #2e7d32;
          border-left: 4px solid #4caf50;
        ">
          <span style="color: #28a745;">●</span> Updated as of ${new Date(analytics.lastUpdated).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })} PH Time
        </div>
        
        ${generateChartSpecificContent(chartType, analytics)}
        
        <!-- Recommendations Section -->
        ${recommendations && recommendations.length > 0 ? `
          <div style="margin-top: 40px; padding: 25px; background: linear-gradient(135deg, #fff8e1 0%, #ffe082 30%, #fff8e1 100%); border-radius: 12px; border-left: 4px solid #ff9800;">
            <h3 style="color: #4b2e1e; margin-bottom: 20px; display: flex; align-items: center; gap: 10px;">
              <span style="font-size: 2rem;"></span>
              <span>AI-Powered Recommendations</span>
            </h3>
            ${recommendations.slice(0, 5).map(rec => `
              <div style="
                background: white;
                padding: 20px;
                border-radius: 10px;
                margin-bottom: 15px;
                box-shadow: 0 2px 8px rgba(0,0,0,0.08);
                border-left: 4px solid ${rec.type === 'critical' ? '#dc3545' : rec.type === 'warning' ? '#ffc107' : rec.type === 'success' ? '#28a745' : '#2196f3'};
              ">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
                  <div style="display: flex; align-items: center; gap: 12px;">
                    <span style="font-size: 2rem;">${rec.icon}</span>
                    <div>
                      <h4 style="margin: 0; color: #4b2e1e; font-size: 1.1rem;">${rec.title}</h4>
                      <p style="margin: 4px 0 0 0; color: #666; font-size: 0.9rem;">${rec.message}</p>
                    </div>
                  </div>
                  <span style="
                    padding: 4px 12px;
                    background: ${rec.priority === 'high' ? '#ffebee' : rec.priority === 'medium' ? '#fff3e0' : '#e3f2fd'};
                    color: ${rec.priority === 'high' ? '#c62828' : rec.priority === 'medium' ? '#e65100' : '#1565c0'};
                    border-radius: 20px;
                    font-size: 0.75rem;
                    font-weight: 700;
                    text-transform: uppercase;
                  ">${rec.priority} Priority</span>
                </div>
                
                <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #f0f0f0;">
                  <strong style="color: #4b2e1e; font-size: 0.9rem;">Recommended Actions:</strong>
                  <ul style="margin: 10px 0 0 0; padding-left: 20px; color: #555;">
                    ${rec.actions.map(action => `<li style="margin-bottom: 6px;">${action}</li>`).join('')}
                  </ul>
                </div>
                
                <div style="margin-top: 12px; padding: 8px 12px; background: #f8f9fa; border-radius: 6px; font-size: 0.85rem;">
                  <strong>Impact:</strong> <span style="color: #4b2e1e;">${rec.impact}</span>
                </div>
              </div>
            `).join('')}
            
            ${recommendations.length > 5 ? `
              <p style="text-align: center; color: #666; margin-top: 15px; font-size: 0.9rem;">
                + ${recommendations.length - 5} more recommendation${recommendations.length - 5 !== 1 ? 's' : ''}
              </p>
            ` : ''}
          </div>
        ` : ''}
        
        <!-- Anomalies Alert -->
        ${anomalies && anomalies.length > 0 ? `
          <div style="margin-top: 25px; padding: 20px; background: #fff3cd; border-radius: 8px; border-left: 4px solid #ffc107;">
            <h4 style="color: #856404; margin: 0 0 12px 0; display: flex; align-items: center; gap: 8px;">
              <span>️</span>
              <span>Unusual Activity Detected</span>
            </h4>
            <p style="color: #856404; margin: 0 0 10px 0;">
              Our system detected ${anomalies.length} unusual pattern${anomalies.length !== 1 ? 's' : ''} in your data:
            </p>
            ${anomalies.slice(0, 3).map(a => `
              <div style="padding: 8px 12px; background: white; border-radius: 6px; margin-bottom: 8px;">
                <strong>${new Date(a.date).toLocaleDateString()}:</strong> 
                ${a.value} booking${a.value !== 1 ? 's' : ''} 
                <span style="color: ${a.severity === 'high' ? '#dc3545' : '#ff9800'};">
                  (${a.severity} severity)
                </span>
              </div>
            `).join('')}
          </div>
        ` : ''}
      </div>
    `;
    
    modal.classList.add('active');
  }

  function generateChartSpecificContent(chartType, analytics) {
    const { summary, trends, forecast, servicePerformance, therapistUtilization } = analytics;
    
    switch(chartType) {
      case 'bookings':
        return `
          <!-- Summary Cards -->
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 30px;">
            <div style="padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; color: white;">
              <div style="font-size: 0.9rem; opacity: 0.9;">Current Period Bookings</div>
              <div style="font-size: 2.5rem; font-weight: 700; margin: 10px 0;">${summary.totalBookings}</div>
              <div style="font-size: 0.85rem; opacity: 0.8;">${summary.completedBookings} completed (${summary.totalBookings > 0 ? Math.round((summary.completedBookings / summary.totalBookings) * 100) : 0}%)</div>
            </div>
            <div style="padding: 20px; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); border-radius: 12px; color: white;">
              <div style="font-size: 0.9rem; opacity: 0.9;">Trend Direction</div>
              <div style="font-size: 2.5rem; font-weight: 700; margin: 10px 0;">
                ${trends.bookings.direction === 'increasing' ? '' : trends.bookings.direction === 'decreasing' ? '' : '️'}
              </div>
              <div style="font-size: 0.85rem; opacity: 0.8; text-transform: capitalize;">${trends.bookings.direction}</div>
            </div>
          </div>
          
          <!-- 7-Day Forecast -->
          <div style="background: white; padding: 25px; border-radius: 12px; margin-bottom: 25px; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">
            <h3 style="color: #4b2e1e; margin-bottom: 20px; display: flex; align-items: center; gap: 10px;">
              <span></span>
              <span>7-Day Booking Forecast</span>
            </h3>
            <div style="display: grid; gap: 12px;">
              ${forecast.dates.map((date, idx) => {
                const dayName = new Date(date).toLocaleDateString('en-US', { weekday: 'long' });
                const predicted = forecast.values[idx];
                const conf = forecast.confidence[idx];
                
                return `
                  <div style="display: flex; justify-content: space-between; align-items: center; padding: 15px; background: #f8f9fa; border-radius: 8px;">
                    <div>
                      <div style="font-weight: 700; color: #4b2e1e;">${dayName}</div>
                      <div style="color: #666; font-size: 0.85rem;">${new Date(date).toLocaleDateString()}</div>
                    </div>
                    <div style="text-align: right;">
                      <div style="font-size: 1.8rem; font-weight: 700; color: #4b2e1e;">${predicted}</div>
                      <div style="color: #999; font-size: 0.75rem;">Range: ${conf.lower}-${conf.upper}</div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        `;
        
      case 'revenue':
        return `
          <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 30px;">
            <div style="padding: 20px; background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%); border-radius: 12px; color: white;">
              <div style="font-size: 0.9rem; opacity: 0.9;">Total Revenue</div>
              <div style="font-size: 2.5rem; font-weight: 700; margin: 10px 0;">₱${summary.totalRevenue.toLocaleString()}</div>
              <div style="font-size: 0.85rem; opacity: 0.8;">Avg: ₱${summary.averageRevenuePerBooking.toLocaleString()} per booking</div>
            </div>
            <div style="padding: 20px; background: linear-gradient(135deg, #fa709a 0%, #fee140 100%); border-radius: 12px; color: white;">
              <div style="font-size: 0.9rem; opacity: 0.9;">Revenue Trend</div>
              <div style="font-size: 2.5rem; font-weight: 700; margin: 10px 0;">
                ${trends.revenue.direction === 'increasing' ? '' : trends.revenue.direction === 'decreasing' ? '' : '️'}
              </div>
              <div style="font-size: 0.85rem; opacity: 0.8; text-transform: capitalize;">${trends.revenue.direction}</div>
            </div>
          </div>
        `;
        
      case 'services':
        return `
          <div style="background: white; padding: 25px; border-radius: 12px; margin-bottom: 25px;">
            <h3 style="color: #4b2e1e; margin-bottom: 20px;">Top Performing Services</h3>
            ${servicePerformance.slice(0, 10).map((service, idx) => `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 15px; background: ${idx < 3 ? '#fff8e1' : '#f8f9fa'}; border-radius: 8px; margin-bottom: 10px; ${idx < 3 ? 'border: 2px solid #ffc107;' : ''}">
                <div style="display: flex; align-items: center; gap: 15px;">
                  <span style="font-size: 2rem;">${idx === 0 ? '' : idx === 1 ? '' : idx === 2 ? '' : '⭐'}</span>
                  <div>
                    <div style="font-weight: 700; color: #4b2e1e;">${service.name}</div>
                    <div style="color: #666; font-size: 0.85rem;">${service.bookings} booking${service.bookings !== 1 ? 's' : ''}</div>
                  </div>
                </div>
                <div style="text-align: right;">
                  <div style="font-weight: 700; color: #28a745; font-size: 1.2rem;">₱${service.revenue.toLocaleString()}</div>
                </div>
              </div>
            `).join('')}
          </div>
        `;
        
      case 'therapists':
        return `
          <div style="background: white; padding: 25px; border-radius: 12px; margin-bottom: 25px;">
            <h3 style="color: #4b2e1e; margin-bottom: 20px;">Therapist Performance Rankings</h3>
            ${therapistUtilization.map((therapist, idx) => `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 15px; background: ${idx < 3 ? '#e8f5e9' : '#f8f9fa'}; border-radius: 8px; margin-bottom: 10px;">
                <div style="display: flex; align-items: center; gap: 15px;">
                  <span style="font-size: 2rem;">${idx === 0 ? '' : idx === 1 ? '' : idx === 2 ? '' : ''}</span>
                  <div>
                    <div style="font-weight: 700; color: #4b2e1e;">${therapist.name}</div>
                    <div style="color: #666; font-size: 0.85rem;">${therapist.completed}/${therapist.bookings} completed</div>
                  </div>
                </div>
                <div style="text-align: right;">
                  <div style="font-weight: 700; font-size: 1.5rem; color: ${therapist.rate >= 80 ? '#28a745' : therapist.rate >= 60 ? '#ffc107' : '#dc3545'};">
                    ${therapist.rate.toFixed(1)}%
                  </div>
                  <div style="font-size: 0.75rem; color: #999;">Completion Rate</div>
                </div>
              </div>
            `).join('')}
          </div>
        `;
        
      default:
        return '<p>No specific forecast available for this chart.</p>';
    }
  }

  //Add "See Analytics" buttons to charts

  function addAnalyticsButtonsToCharts() {
    const chartBoxes = document.querySelectorAll('.chart-box');
    
    chartBoxes.forEach((box) => {
      const chartId = box.querySelector('canvas')?.id;
      if (!chartId) return;
      
      // Map canvas IDs to chart types
      const chartTypeMap = {
        'peakHoursChart': 'peakHours',
        'servicesChart': 'services',
        'revenueChart': 'revenue',
        'revenueStatusChart': 'revenueStatus',
        'bookingDistChart': 'bookingDist',
        'predictionsChart': 'predictions'
      };
      
      const chartType = chartTypeMap[chartId];
      if (!chartType) return;
      
      // Check if button already exists
      if (box.querySelector('.see-analytics-btn')) return;
      
      // Add button
      const button = document.createElement('button');
      button.className = 'see-analytics-btn';
      button.innerHTML = ' See Forecast & Insights';
      button.style.cssText = `
        position: absolute;
        top: 15px;
        right: 15px;
        padding: 8px 16px;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        border: none;
        border-radius: 20px;
        cursor: pointer;
        font-size: 0.85rem;
        font-weight: 600;
        box-shadow: 0 2px 8px rgba(102, 126, 234, 0.4);
        transition: all 0.3s;
        z-index: 10;
        display: ${forecastEnabled ? 'block' : 'none'};
      `;
      
      button.onmouseover = function() {
        this.style.transform = 'translateY(-2px)';
        this.style.boxShadow = '0 4px 12px rgba(102, 126, 234, 0.6)';
      };
      
      button.onmouseout = function() {
        this.style.transform = 'translateY(0)';
        this.style.boxShadow = '0 2px 8px rgba(102, 126, 234, 0.4)';
      };
      
      button.onclick = () => showChartForecast(chartType);
      
      box.style.position = 'relative';
      box.appendChild(button);
    });
  }

  //toggle on/off of forecast
  async function toggleForecast() {
  const toggle = document.getElementById('forecastToggle');
  
  // Support both checkbox toggle and button toggle
  if (toggle) {
    forecastEnabled = toggle.checked;
  } else {
    forecastEnabled = !forecastEnabled;
  }

  // Update status text
  const status = document.getElementById('forecastStatus');
  if (status) {
    status.textContent = forecastEnabled ? 'ON' : 'OFF';
    status.style.color = forecastEnabled ? '#28a745' : '#dc3545';
  }

  // Update toggle button text if using button style
  const toggleBtn = document.querySelector('[onclick*="toggleForecast"]');
  if (toggleBtn) {
    const statusText = toggleBtn.querySelector('.forecast-status');
    if (statusText) {
      statusText.textContent = forecastEnabled ? 'ON' : 'OFF';
      statusText.className = `forecast-status ${forecastEnabled ? 'on' : 'off'}`;
    }
  }

  // Redraw charts with updated forecast setting
  if (currentBookingsData && currentBookingsData.length > 0) {
    createRevenueChart(currentBookingsData);
    createPeakHoursChart(currentBookingsData);
    createServicesChart(currentBookingsData);
    createBookingDistChart(currentBookingsData);
  } else {
    loadOverviewData();
  }

  // Update stat cards

  console.log(` Forecast ${forecastEnabled ? 'enabled' : 'disabled'}`);
}

//period range
  function updatePeriodRange(period) {
    const now = new Date();
    let start, end, label;
    
    switch(period) {
      case 'today':
        start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
        label = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        break;
        
      case 'week':
        start = new Date(now);
        start.setDate(start.getDate() - start.getDay() + 1); // Monday
        start.setHours(0, 0, 0, 0);
        end = new Date(start);
        end.setDate(end.getDate() + 6); // Sunday
        end.setHours(23, 59, 59, 999);
        label = `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
        break;
        
      case 'month':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
        label = start.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        break;
        
      case 'year':
        start = new Date(now.getFullYear(), 0, 1);
        end = new Date(now.getFullYear(), 11, 31, 23, 59, 59);
        label = now.getFullYear().toString();
        break;
    }
    
    currentPeriodRange = { start, end, label };
    
    // Update UI
    updateDateRangeDisplay();
    
    return currentPeriodRange;
  }

  async function loadEnhancedPredictions() {
    try {
      console.log(' Loading enhanced predictions for period:', currentPeriod);

      // Check predictions cache
      const cacheKey = `predictions_${currentPeriod}`;
      const cached = analyticsCache[cacheKey];
      if (cached && (Date.now() - cached.timestamp) < ANALYTICS_CACHE_TTL) {
        console.log(` Predictions cache hit for: ${currentPeriod}`);
        const data = cached.data;
        predictionsData = data.predictions || [];
        if (forecastEnabled && (filteredBookingsData || currentBookingsData)) {
          createCharts(filteredBookingsData || currentBookingsData);
        }
        if (forecastEnabled) displayEnhancedPredictionsChart(data);
        return data;
      }
      
      const res = await fetch(`${apiBase}/analytics/enhanced-predictions?period=${currentPeriod}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (!res.ok) { console.error('Failed to load enhanced predictions'); return null; }
      
      const data = await res.json();
      console.log(' Loaded enhanced predictions');

      // Cache it
      analyticsCache[cacheKey] = { data, timestamp: Date.now() };
      
      predictionsData = data.predictions || [];

      if (forecastEnabled && (filteredBookingsData || currentBookingsData)) {
        createCharts(filteredBookingsData || currentBookingsData);
      }
      if (forecastEnabled) displayEnhancedPredictionsChart(data);
      return data;
      
    } catch (err) {
      console.error(' Error loading enhanced predictions:', err);
      return null;
    }
  }

  function displayEnhancedPredictionsChart(data) {
  const ctx = document.getElementById('predictionsChart');
  
  if (!ctx) {
    console.log('ℹ️ predictionsChart canvas not found (not on therapists tab) - skipping chart render');
    return;
  }
  
  if (currentChart.predictions) {
    currentChart.predictions.destroy();
  }
    
    const { predictions, forecastHorizon } = data;
    
    if (!predictions || predictions.length === 0) {
      console.warn('️ No predictions data to display');
      return;
    }
    
    // Get all dates and bookings
    const allLabels = predictions.map(p => {
      const date = new Date(p.date);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    
    const allData = predictions.map(p => p.predictedBookings);
    
    // Create confidence bounds
    const upperBounds = predictions.map(p => p.upperBound || p.predictedBookings * 1.2);
    const lowerBounds = predictions.map(p => p.lowerBound || p.predictedBookings * 0.8);
    
    // Create datasets
    const datasets = [
      {
        label: `Predicted Bookings (${forecastHorizon})`,
        data: allData,
        borderColor: '#667eea',
        backgroundColor: 'rgba(102, 126, 234, 0.1)',
        borderWidth: 3,
        borderDash: [10, 5],
        fill: false,
        tension: 0.4,
        pointRadius: 5,
        pointBackgroundColor: '#667eea',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointHoverRadius: 7
      }
    ];
    
    if (forecastEnabled) {
      // Add confidence interval
      datasets.push({
        label: 'Upper Confidence',
        data: upperBounds,
        borderColor: 'rgba(102, 126, 234, 0.3)',
        backgroundColor: 'rgba(102, 126, 234, 0.05)',
        borderWidth: 1,
        borderDash: [5, 5],
        fill: '+1',
        pointRadius: 0,
        tension: 0.4
      });
      
      datasets.push({
        label: 'Lower Confidence',
        data: lowerBounds,
        borderColor: 'rgba(102, 126, 234, 0.3)',
        backgroundColor: 'rgba(102, 126, 234, 0.05)',
        borderWidth: 1,
        borderDash: [5, 5],
        fill: false,
        pointRadius: 0,
        tension: 0.4
      });
    }
    
    currentChart.predictions = new Chart(ctx, {
      type: 'line',
      data: {
        labels: allLabels,
        datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              filter: (item) => {
                return !item.text.includes('Confidence');
              },
              boxWidth: 12,
              padding: 10,
              font: {
                size: 11
              }
            }
          },
          title: {
            display: true,
            text: ` Booking Predictions (${forecastHorizon})`,
            font: {
              size: 14,
              weight: 'bold'
            },
            padding: {
              bottom: 15
            }
          },
          tooltip: {
            callbacks: {
              title: function(context) {
                const index = context[0].dataIndex;
                const pred = predictions[index];
                if (pred) {
                  return `${pred.dayName} - ${new Date(pred.date).toLocaleDateString()}`;
                }
                return context[0].label;
              },
              label: function(context) {
                const datasetLabel = context.dataset.label;
                const value = context.parsed.y;
                
                if (datasetLabel.includes('Confidence')) {
                  return null;
                }
                
                return `${datasetLabel}: ${value} booking${value !== 1 ? 's' : ''}`;
              },
              footer: function(context) {
                const index = context[0].dataIndex;
                const pred = predictions[index];
                
                if (pred) {
                  return [
                    `Confidence: ${pred.confidence}`,
                    `Expected Revenue: ₱${pred.predictedRevenue.toLocaleString()}`,
                    `Range: ${pred.lowerBound || Math.floor(pred.predictedBookings * 0.8)}-${pred.upperBound || Math.ceil(pred.predictedBookings * 1.2)}`
                  ];
                }
                return null;
              }
            },
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            padding: 12
          }
        },
        scales: {
          x: {
            grid: {
              display: false
            },
            ticks: {
              font: {
                size: 10
              },
              maxRotation: 45,
              minRotation: 45
            }
          },
          y: {
            beginAtZero: true,
            title: {
              display: true,
              text: 'Number of Bookings',
              font: {
                size: 12,
                weight: 'bold'
              }
            },
            ticks: {
              stepSize: 1,
              precision: 0,
              font: {
                size: 11
              }
            }
          }
        }
      }
    });
    
    // Add forecast indicator if enabled
    // Add forecast indicator if enabled
  if (forecastEnabled && ctx && ctx.parentElement) {
    addForecastIndicator(ctx.parentElement);
  }
  }

  function addForecastIndicator(chartContainer) {
    // Remove existing indicator
    const existing = chartContainer.querySelector('.forecast-indicator');
    if (existing) existing.remove();
    
    const indicator = document.createElement('div');
    indicator.className = 'forecast-indicator';
    indicator.textContent = ' Forecast Active';
    chartContainer.style.position = 'relative';
    chartContainer.appendChild(indicator);
  }

  async function showComprehensiveInsights() {
    const modal = document.getElementById('statDetailModal');
    const title = document.getElementById('statDetailTitle');
    const content = document.getElementById('statDetailContent');
    
    title.textContent = ' Forecast & Prescription Insights';
    
    content.innerHTML = `
      <div style="padding: 20px; text-align: center;">
        <div class="spinner-small"></div>
        <p style="margin-top: 15px; color: #666;">Loading comprehensive insights...</p>
      </div>
    `;
    
    modal.classList.add('active');
    
    try {
      // Load comprehensive data
      const predictionsData = await loadEnhancedPredictions();
      const analyticsData = comprehensiveAnalytics || await loadComprehensiveAnalytics();
      
      if (!predictionsData || !analyticsData) {
        throw new Error('Failed to load data');
      }
      
      displayComprehensiveInsightsContent(predictionsData, analyticsData);
      
    } catch (err) {
      console.error(' Error loading insights:', err);
      content.innerHTML = `
        <div style="padding: 40px; text-align: center;">
          <div style="font-size: 3rem; margin-bottom: 15px;">️</div>
          <p style="color: #dc3545; font-size: 1.1rem; margin-bottom: 10px;">Failed to load insights</p>
          <p style="color: #666; font-size: 0.9rem;">${err.message}</p>
          <button onclick="showComprehensiveInsights()" style="margin-top: 20px; padding: 10px 20px; background: #4b2e1e; color: white; border: none; border-radius: 6px; cursor: pointer;">
            Retry
          </button>
        </div>
      `;
    }
  }

  function displayComprehensiveInsightsContent(predictionsData, analyticsData) {
    const content = document.getElementById('statDetailContent');
    
    const { predictions, forecastHorizon, totalPredictedBookings, totalPredictedRevenue } = predictionsData;
    const { summary, recommendations } = analyticsData;
    
    // Calculate period-specific insights
    const forecastStart = predictions[0].date;
    const forecastEnd = predictions[predictions.length - 1].date;
    
    const avgDailyBookings = totalPredictedBookings / predictions.length;
    const avgDailyRevenue = totalPredictedRevenue / predictions.length;
    
    // Compare with current period
    const currentVsForecast = summary.totalBookings > 0
      ? ((totalPredictedBookings - summary.totalBookings) / summary.totalBookings * 100)
      : 0;
    
    content.innerHTML = `
      <div style="padding: 20px;">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 25px; border-radius: 12px; color: white; margin-bottom: 25px;">
          <h3 style="margin: 0 0 10px 0; font-size: 1.5rem;"> Forecast Period: ${forecastHorizon}</h3>
          <p style="margin: 0; opacity: 0.9; font-size: 0.95rem;">
            ${new Date(forecastStart).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })} 
            → 
            ${new Date(forecastEnd).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
        
        <!-- Forecast Summary Cards -->
        <div class="forecast-comparison-grid">
          <div class="forecast-comparison-card">
            <div class="forecast-comparison-label">Total Predicted Bookings</div>
            <div class="forecast-comparison-value">${totalPredictedBookings}</div>
            <div class="forecast-comparison-change ${currentVsForecast >= 0 ? 'positive' : 'negative'}">
              ${currentVsForecast >= 0 ? '↑' : '↓'} ${Math.abs(currentVsForecast).toFixed(1)}% vs current period
            </div>
          </div>
          
          <div class="forecast-comparison-card">
            <div class="forecast-comparison-label">Expected Revenue</div>
            <div class="forecast-comparison-value">₱${totalPredictedRevenue.toLocaleString()}</div>
            <div class="forecast-comparison-label" style="margin-top: 5px; font-size: 0.75rem;">
              Avg: ₱${Math.round(avgDailyRevenue).toLocaleString()}/day
            </div>
          </div>
          
          <div class="forecast-comparison-card">
            <div class="forecast-comparison-label">Avg Daily Bookings</div>
            <div class="forecast-comparison-value">${avgDailyBookings.toFixed(1)}</div>
            <div class="forecast-comparison-label" style="margin-top: 5px; font-size: 0.75rem;">
              Per day in forecast period
            </div>
          </div>
          
          <div class="forecast-comparison-card">
            <div class="forecast-comparison-label">Forecast Confidence</div>
            <div class="forecast-comparison-value" style="font-size: 1.5rem;">
              ${predictions.filter(p => p.confidence === 'High').length > predictions.length / 2 ? 'High ' : 'Medium '}
            </div>
          </div>
        </div>
        
        <!-- Timeline View -->
        <div style="margin-top: 35px;">
          <h4 style="color: #4b2e1e; margin-bottom: 20px;"> Detailed Forecast Timeline</h4>
          <div class="insight-timeline">
            ${predictions.slice(0, 7).map((pred, index) => {
              const date = new Date(pred.date);
              const isHigh = pred.predictedBookings > avgDailyBookings;
              
              return `
                <div class="insight-timeline-item">
                  <div style="display: flex; justify-content: space-between; align-items: start; background: ${isHigh ? '#fff8e1' : '#f8f9fa'}; padding: 15px; border-radius: 8px; ${isHigh ? 'border: 2px solid #ffc107;' : ''}">
                    <div>
                      <div style="font-weight: 700; color: #4b2e1e; margin-bottom: 5px;">
                        ${pred.dayName}, ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </div>
                      <div style="color: #666; font-size: 0.85rem; margin-bottom: 8px;">
                        ${pred.topServices && pred.topServices.length > 0 
                          ? `Top: ${pred.topServices.slice(0, 2).map(s => s.name).join(', ')}`
                          : 'Multiple services'
                        }
                      </div>
                      <div style="color: #999; font-size: 0.8rem;">
                        Peak: ${pred.peakHour || 'N/A'} | Confidence: ${pred.confidence}
                      </div>
                    </div>
                    <div style="text-align: right;">
                      <div style="font-size: 1.8rem; font-weight: 700; color: ${isHigh ? '#ff9800' : '#4b2e1e'};">
                        ${pred.predictedBookings}
                      </div>
                      <div style="font-size: 0.75rem; color: #999;">bookings</div>
                      <div style="margin-top: 5px; font-weight: 600; color: #28a745; font-size: 0.9rem;">
                        ₱${pred.predictedRevenue.toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
        
        <!-- Recommendations -->
        ${recommendations && recommendations.length > 0 ? `
          <div style="margin-top: 40px; padding: 25px; background: linear-gradient(135deg, #fff8e1 0%, #ffe082 30%, #fff8e1 100%); border-radius: 12px; border-left: 4px solid #ff9800;">
            <h3 style="color: #4b2e1e; margin-bottom: 20px; display: flex; align-items: center; gap: 10px;">
              <span style="font-size: 2rem;"></span>
              <span>Recommended Actions Based on Forecast</span>
            </h3>
            ${recommendations.slice(0, 5).map(rec => `
              <div style="background: white; padding: 20px; border-radius: 10px; margin-bottom: 15px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                  <span style="font-size: 2rem;">${rec.icon}</span>
                  <div>
                    <h4 style="margin: 0; color: #4b2e1e; font-size: 1.1rem;">${rec.title}</h4>
                    <p style="margin: 4px 0 0 0; color: #666; font-size: 0.9rem;">${rec.message}</p>
                  </div>
                </div>
                <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #f0f0f0;">
                  <strong style="color: #4b2e1e; font-size: 0.9rem;">Actions:</strong>
                  <ul style="margin: 8px 0 0 20px; padding: 0; color: #555;">
                    ${rec.actions.map(action => `<li style="margin-bottom: 5px;">${action}</li>`).join('')}
                  </ul>
                </div>
              </div>
            `).join('')}
          </div>
        ` : ''}
        
        <!-- Info Footer -->
        <div style="margin-top: 25px; padding: 20px; background: #e3f2fd; border-radius: 12px; border-left: 4px solid #2196f3;">
          <div style="display: flex; align-items: start; gap: 15px;">
            <div style="font-size: 2rem;">ℹ️</div>
            <div>
              <p style="color: #1565c0; margin: 0 0 10px 0; font-weight: 600; font-size: 1rem;">
                About This Forecast
              </p>
              <p style="color: #666; margin: 0; line-height: 1.6; font-size: 0.9rem;">
                This forecast is generated using historical booking patterns from the past 4-8 weeks. 
                The prediction horizon adjusts based on your selected time period:
              </p>
              <ul style="color: #666; margin: 10px 0 0 20px; line-height: 1.8; font-size: 0.9rem;">
                <li><strong>Today:</strong> Predicts next 7 days</li>
                <li><strong>This Week:</strong> Predicts next 15 days (2+ weeks)</li>
                <li><strong>This Month:</strong> Predicts next 30 days (~1 month)</li>
                <li><strong>This Year:</strong> Predicts next 90 days (~3 months)</li>
              </ul>
              <p style="color: #666; margin: 10px 0 0 0; line-height: 1.6; font-size: 0.85rem; font-style: italic;">
                 Use the forecast toggle in the main dashboard to enable/disable predictions on charts.
              </p>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function updateDateRangeDisplay() {
    const now = new Date();
    let periodTitle = '', periodSub = '';

    switch (currentPeriod) {
      case 'today':
        periodTitle = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
        periodSub   = 'Today';
        break;
      case 'week': {
        const dow     = (now.getDay() + 6) % 7;
        const mon     = new Date(now); mon.setDate(now.getDate() - dow); mon.setHours(0,0,0,0);
        const sun     = new Date(mon); sun.setDate(mon.getDate() + 6);
        const jan4    = new Date(mon.getFullYear(), 0, 4);
        const weekNum = Math.ceil(((mon - jan4) / 86400000 + jan4.getDay() + 1) / 7);
        periodTitle = `${mon.toLocaleDateString('en-US',{month:'short',day:'numeric'})} – ${sun.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}`;
        periodSub   = `Week ${weekNum} of ${mon.getFullYear()}`;
        break;
      }
      case 'month':
        periodTitle = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        periodSub   = `Month ${now.getMonth() + 1} of ${now.getFullYear()}`;
        break;
      case 'year':
        periodTitle = now.getFullYear().toString();
        periodSub   = `Jan 1 – Dec 31, ${now.getFullYear()}`;
        break;
    }

    const valEl = document.getElementById('dateRangeValue');
    const subEl = document.getElementById('dateRangeSub');
    if (valEl) valEl.textContent = periodTitle;
    if (subEl) subEl.textContent = `(${periodSub})`;
    currentPeriodRange.label = periodTitle;
  }

  async function loadOverviewData() {
    try {
      console.log(' Loading overview data...');

      updatePeriodRange(currentPeriod);
      if (!currentPeriod) currentPeriod = 'today';
      updatePeriodRange(currentPeriod);

      // Disable forecast/predictions for today and week — not meaningful + slow
      forecastEnabled = (currentPeriod === 'month' || currentPeriod === 'year');

      // For today/week, set the timestamp immediately after fast load
      if (currentPeriod === 'today' || currentPeriod === 'week') {
        lastDataUpdate = new Date();
        updateLastUpdatedTimestamp();
        startDataRefreshTimer();
      }

      const now = new Date();

      // ── Step 1: Fetch only the current period first (fast) ──────────────────
      // This gives us stats/charts immediately without waiting for all history
      const periodRanges = {
        today: {
          from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).toISOString().split('T')[0],
          to:   new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString().split('T')[0],
        },
        week: {
          from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14).toISOString().split('T')[0],
          to:   new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7).toISOString().split('T')[0],
        },
        month: {
          from: new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().split('T')[0],
          to:   new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString().split('T')[0],
        },
        year: {
          from: new Date(now.getFullYear() - 1, 0, 1).toISOString().split('T')[0],
          to:   new Date(now.getFullYear(), 11, 31).toISOString().split('T')[0],
        },
      };

      const range = periodRanges[currentPeriod] || periodRanges.year;
      const fastRes = await fetch(`${apiBase}/bookings?from=${range.from}&to=${range.to}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!fastRes.ok) throw new Error('Failed to fetch bookings');

      const periodBookings = await fastRes.json();
      console.log(' Fast load:', periodBookings.length, 'bookings for', currentPeriod);

      // Show dashboard immediately with period data
      allBookings = periodBookings;
      filteredBookingsData = filterByPeriod(allBookings, currentPeriod);
      currentBookingsData  = filteredBookingsData;

      calculateStats(filteredBookingsData);
      createCharts(filteredBookingsData);
      updateStatLabels();
      hideLoader();

      // ── Step 2: Load full year range in background for comparisons/calendar ─
      // Non-blocking — updates charts/stats when ready without blocking UI
      const yearAgo   = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate()).toISOString().split('T')[0];
      const yearAhead = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()).toISOString().split('T')[0];

      fetch(`${apiBase}/bookings?from=${yearAgo}&to=${yearAhead}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then(r => r.json())
        .then(fullBookings => {
          console.log(' Full range loaded:', fullBookings.length, 'bookings');
          allBookings = fullBookings;
          filteredBookingsData = filterByPeriod(allBookings, currentPeriod);
          currentBookingsData  = filteredBookingsData;
          // Refresh stats silently with complete data
          calculateStats(filteredBookingsData);
          createCharts(filteredBookingsData);
              // Also refresh calendar if on bookings tab
          if (selectedDate) loadBookingsForDate(selectedDate);
        })
        .catch(err => console.warn('Background full-load failed:', err));

      // Load analytics in background — skip heavy forecast for today/week
      if (currentPeriod === 'today' || currentPeriod === 'week') {
        // Today/Week: light load only
      } else {
        // Month/Year: run analytics + predictions IN PARALLEL (not sequential)
        Promise.all([
          loadComprehensiveAnalytics(),
          loadEnhancedPredictions()
        ])
          .catch(err => console.error('Analytics load error:', err));
      }

    } catch (err) {
      console.error(' Error loading dashboard:', err);
      hideLoader();
      showNotification('Failed to load dashboard data', 'error');
    }
  }
  // FILTER BOOKINGS BY PERIOD
  function filterByPeriod(bookings, period) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    console.log(' Filtering for period:', period);
    console.log(' Today is:', today.toDateString());
    
    const filtered = bookings.filter(b => {
      const bookingDate = new Date(b.date);
      
      switch(period) {
        case 'today':
          const isToday = bookingDate.toDateString() === today.toDateString();
          if (isToday) console.log(' Today booking:', b.date, b.time);
          return isToday;
        
        case 'week':
          const weekStart = new Date(today);
          weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); // Monday
          const weekEnd = new Date(weekStart);
          weekEnd.setDate(weekEnd.getDate() + 6); // Sunday
          
          const isThisWeek = bookingDate >= weekStart && bookingDate <= weekEnd;
          if (isThisWeek) console.log(' This week booking:', b.date, b.time);
          return isThisWeek;
        
        case 'month':
          return bookingDate.getMonth() === now.getMonth() &&
                bookingDate.getFullYear() === now.getFullYear();
        
        case 'year':
          return bookingDate.getFullYear() === now.getFullYear();
        
        default:
          return true;
      }
    });
    
    console.log(` Found ${filtered.length} bookings for ${period}`);
    return filtered;
  }

  // CALCULATE STATS FOR 6 CARDS
  function calculateStats(bookings) {
    const revenue = bookings
      .filter(b => b.status === 'completed')
      .reduce((sum, b) => sum + (b.price || 0), 0);
    
    const bookingCount    = bookings.length;
    const pendingCount    = bookings.filter(b => b.status === 'pending').length;
    const confirmedCount  = bookings.filter(b => b.status === 'confirmed').length;
    const completedCount  = bookings.filter(b => b.status === 'completed').length;
    const cancelledCount  = bookings.filter(b => b.status === 'cancelled').length;
    const rescheduleCount = bookings.filter(b => b.status === 'pending_reschedule').length;
    const cancelReqCount  = bookings.filter(b => b.status === 'pending_cancellation').length;

    // Update main numbers (elements may not exist if summary bar was removed)
    const elRevenue   = document.getElementById('periodRevenue');
    const elBookings  = document.getElementById('periodBookings');
    const elCompleted = document.getElementById('periodCompleted');
    const elCancelled = document.getElementById('periodCancelled');
    if (elRevenue)   elRevenue.textContent   = `₱${revenue.toLocaleString()}`;
    if (elBookings)  elBookings.textContent  = bookingCount;
    if (elCompleted) elCompleted.textContent = completedCount;
    if (elCancelled) elCancelled.textContent = cancelledCount;

    // ── Booking Status Summary Cards ──────────────────────────────────────────
    const setCard = (id, subId, count, subText) => {
      const el = document.getElementById(id);
      const sub = document.getElementById(subId);
      if (el) el.textContent = count;
      if (sub) sub.textContent = subText;
    };
    const pct = (n) => bookingCount > 0 ? `${((n/bookingCount)*100).toFixed(0)}% of total` : '';
    setCard('bscPending',   'bscPendingSub',   pendingCount,   rescheduleCount > 0 ? `+ ${rescheduleCount} reschedule req.` : pct(pendingCount));
    setCard('bscConfirmed', 'bscConfirmedSub', confirmedCount, cancelReqCount > 0  ? `+ ${cancelReqCount} cancel req.`     : pct(confirmedCount));
    setCard('bscCompleted', 'bscCompletedSub', completedCount, `₱${revenue.toLocaleString()} revenue`);
    setCard('bscCancelled', 'bscCancelledSub', cancelledCount, pct(cancelledCount));
    
    //  ADD INLINE INSIGHTS
    const avgRevenue = bookingCount > 0 ? Math.round(revenue / bookingCount) : 0;
    const completionRate = bookingCount > 0 ? ((completedCount / bookingCount) * 100).toFixed(1) : 0;
    const cancellationRate = bookingCount > 0 ? ((cancelledCount / bookingCount) * 100).toFixed(1) : 0;
    
    // Revenue insight
    const revenueInsight = document.getElementById('revenueInsight');
    if (revenueInsight && forecastEnabled && predictionsData && predictionsData.length > 0) {
      const predicted = predictionsData[0]?.predictedRevenue || revenue;
      const diff = revenue - predicted;
      const percentDiff = predicted > 0 ? ((diff / predicted) * 100).toFixed(1) : 0;
      
      if (Math.abs(percentDiff) > 5) {
        revenueInsight.className = `stat-insight ${diff > 0 ? 'positive' : 'negative'}`;
        revenueInsight.textContent = `${diff > 0 ? '↑' : '↓'} ${Math.abs(percentDiff)}% vs forecast`;
      } else {
        revenueInsight.className = 'stat-insight neutral';
        revenueInsight.textContent = ' On track with forecast';
      }
    } else if (revenueInsight) {
      revenueInsight.textContent = `Avg: ₱${avgRevenue.toLocaleString()} per booking`;
      revenueInsight.className = 'stat-insight neutral';
    }
    
    // Bookings insight
    const bookingsInsight = document.getElementById('bookingsInsight');
    if (bookingsInsight) {
      const pendingCount = bookings.filter(b => b.status === 'pending').length;
      const confirmedCount = bookings.filter(b => b.status === 'confirmed').length;
      
      if (pendingCount > 0) {
        bookingsInsight.textContent = `${pendingCount} pending • ${confirmedCount} confirmed`;
        bookingsInsight.className = 'stat-insight warning';
      } else {
        bookingsInsight.textContent = `${completionRate}% completion rate`;
        bookingsInsight.className = 'stat-insight positive';
      }
    }
    
    // Cancelled insight
    const cancelledInsight = document.getElementById('cancelledInsight');
    if (cancelledInsight) {
      cancelledInsight.textContent = `${cancellationRate}% cancellation rate`;
      cancelledInsight.className = cancellationRate > 10 ? 'stat-insight negative' : 'stat-insight neutral';
    }
  }
  function updateChartTitles() {
    const periodTitles = {
      today: {
        peakHours: 'Peak Hours Today',
        services: 'Most Booked Services Today'
      },
      week: {
        peakHours: 'Daily Bookings This Week',
        services: 'Most Booked Services This Week'
      },
      month: {
        peakHours: 'Weekly Bookings This Month',
        services: 'Most Booked Services This Month'
      },
      year: {
        peakHours: 'Monthly Bookings This Year',
        services: 'Most Booked Services This Year'
      }
    };
    
    const titles = periodTitles[currentPeriod];
    
    const peakHoursTitle = document.getElementById('peakHoursTitle');
    const servicesTitle = document.getElementById('servicesTitle');
    
    if (peakHoursTitle) peakHoursTitle.textContent = titles.peakHours;
    if (servicesTitle) servicesTitle.textContent = titles.services;
  }

  /**
   * Add prediction notification to chart
   */
 function addChartNotification(chartId, actualData, predictedData, type) {
  const ctx = document.getElementById(chartId);
  if (!ctx) return;
  const chartBox = ctx.closest('.chart-box');
  if (!chartBox) return;

  const existing = chartBox.querySelector('.chart-notification');
  if (existing) existing.remove();

  // For today/week — show a simple actual summary instead of forecast
  if (!forecastEnabled) {
    const isCurrency = type === 'revenue';
    const actualTotal = actualData.reduce((s, v) => s + (v || 0), 0);
    if (actualTotal === 0) return; // nothing to show
    const fmt = v => isCurrency ? `₱${Math.round(v).toLocaleString()}` : Math.round(v).toLocaleString();
    const label = {
      today: currentPeriod === 'today' ? 'today' : 'this week',
      week:  'this week',
    }[currentPeriod] || 'this period';
    const notification = document.createElement('div');
    notification.className = 'chart-notification';
    notification.style.cssText = `margin-top:12px;padding:12px 16px;background:#f8f9fa;border-left:4px solid #4b2e1e;border-radius:8px;display:flex;align-items:center;gap:10px;font-size:0.88rem;`;
    notification.innerHTML = `
      <span style="font-size:1.4rem;">${isCurrency ? '' : ''}</span>
      <div>
        <strong style="color:#4b2e1e;">
          ${isCurrency ? `Total revenue ${label}: ${fmt(actualTotal)}` : `Total bookings ${label}: ${fmt(actualTotal)}`}
        </strong>
      </div>`;
    chartBox.appendChild(notification);
    return;
  }

  if (!predictedData || predictedData.length === 0) return;

  const isCurrency = type === 'revenue';
  const fmt = v => isCurrency
    ? `₱${Math.round(v).toLocaleString()}`
    : Math.round(v).toLocaleString();

  const actualTotal   = actualData.reduce((s, v) => s + v, 0);
  const forecastTotal = predictedData.reduce((s, v) => s + v, 0);

  // ── Count slots that have actual data ──────────────────────────────────────
  const filledActualSlots    = actualData.filter(v => v > 0).length;
  const filledForecastSlots  = predictedData.filter(v => v > 0).length;

  // ── Count slots with BOTH actual AND forecast (true overlap) ───────────────
  const overlapSlots = actualData.filter((v, i) => v > 0 && (predictedData[i] || 0) > 0).length;

  const notification = document.createElement('div');
  notification.className = 'chart-notification';
  notification.style.cssText = `
    margin-top:12px; padding:12px 16px;
    background:#f8f9fa; border-left:4px solid #4b2e1e;
    border-radius:8px; display:flex; align-items:center; gap:10px;
    font-size:0.88rem; animation:slideInUp 0.4s ease-out;`;

  // ── CASE A: No actual data yet ─────────────────────────────────────────────
  if (actualTotal === 0) {
    notification.innerHTML = `
      <span style="font-size:1.4rem;"></span>
      <div>
        <strong style="color:#4b2e1e;">Forecast Available</strong>
        <div style="color:#666;margin-top:2px;">
          SARIMA predicts <strong>${fmt(forecastTotal)}</strong> total 
          across next ${filledForecastSlots} period${filledForecastSlots !== 1 ? 's' : ''}
        </div>
      </div>`;
    chartBox.appendChild(notification);
    return;
  }

  // ── CASE B: No temporal overlap (e.g. year chart — actual=Jan–Mar, forecast=Apr+) ──
  if (overlapSlots === 0) {
    const actualAvg   = filledActualSlots  > 0 ? actualTotal  / filledActualSlots  : 0;
    const forecastAvg = filledForecastSlots > 0 ? forecastTotal / filledForecastSlots : 0;
    const trend = forecastAvg >= actualAvg ? '' : '';
    const color = forecastAvg >= actualAvg ? '#28a745' : '#e67e22';

    notification.style.borderLeftColor = color;
    notification.style.background = forecastAvg >= actualAvg ? '#f0fff4' : '#fffbf0';

    notification.innerHTML = `
      <span style="font-size:1.4rem;">${trend}</span>
      <div>
        <strong style="color:${color};">
          Actual so far: ${fmt(actualTotal)} 
          &nbsp;·&nbsp; 
          Forecast ahead: ${fmt(forecastTotal)}
        </strong>
        <div style="color:#666;margin-top:2px;">
          Avg per period — actual: ${fmt(actualAvg)} 
          &nbsp;→&nbsp; forecast: ${fmt(forecastAvg)}
        </div>
      </div>`;
    chartBox.appendChild(notification);
    return;
  }

  // ── CASE C: True overlap — safe to compute % change ───────────────────────
  // Only compare the slots that both sides have data for
  const actualOverlapTotal   = actualData.reduce((s, v, i) => (predictedData[i] > 0 && v > 0) ? s + v : s, 0);
  const forecastOverlapTotal = predictedData.reduce((s, v, i) => (actualData[i] > 0 && v > 0) ? s + v : s, 0);

  if (actualOverlapTotal === 0) return;

  const rawPct = ((forecastOverlapTotal - actualOverlapTotal) / actualOverlapTotal) * 100;
  const { value: pct, capped } = clampPercent(rawPct);
  const absPct   = Math.abs(pct).toFixed(1);
  const cappedNote = capped ? (rawPct > 0 ? '>' : '<') : '';
  const icon  = rawPct >  2 ? '' : rawPct < -2 ? '' : '️';
  const color = rawPct >  2 ? '#28a745' : rawPct < -2 ? '#dc3545' : '#ffc107';
  const forecastWord = rawPct > 2 ? 'above' : rawPct < -2 ? 'below' : 'on par with';

  const ctxLabel = {
    today: 'actual today',
    week:  'actual this week',
    month: 'actual this month',
    year:  'actual this year',
  }[currentPeriod] || 'actual';

  notification.style.borderLeftColor = color;
  notification.style.background = `${color}12`;
  notification.innerHTML = `
    <span style="font-size:1.4rem;">${icon}</span>
    <div>
      <strong style="color:${color};">
        Forecast is ${cappedNote}${absPct}% ${forecastWord} ${ctxLabel}
      </strong>
      <div style="color:#666;margin-top:2px;">
        Actual: ${fmt(actualOverlapTotal)}
        &nbsp;→&nbsp; Forecast: ${fmt(forecastOverlapTotal)}
        &nbsp;(${overlapSlots} matched period${overlapSlots !== 1 ? 's' : ''})
      </div>
    </div>`;

  chartBox.appendChild(notification);
}

  // CREATE CHARTS (keeping existing chart functions)
  function createCharts(bookings) {
    // Clear all existing forecast notifications before re-rendering
    // This prevents stale month/year notifications showing on today/week
    document.querySelectorAll('.chart-notification').forEach(n => n.remove());

    createPeakHoursChart(bookings);
    createServicesChart(bookings);
    createRevenueChart(bookings);
    createRevenueStatusChart(bookings);
    createBookingDistChart(bookings);
  }

  //Peak
  function createPeakHoursChart(bookings) {
  const ctx = document.getElementById('peakHoursChart');
  if (!ctx) {
    console.warn('️ Peak hours chart canvas not found');
    return;
  }
  
  let predictedData = null;
  let labels, hourCounts;
  
  if (currentPeriod === 'today') {
    labels = Array.from({length: 24}, (_, i) => {
      const period = i >= 12 ? 'PM' : 'AM';
      const displayHour = i === 0 ? 12 : i > 12 ? i - 12 : i;
      return `${displayHour} ${period}`;
    });
    hourCounts = Array(24).fill(0);
    
    bookings.forEach(b => {
      if (b.time) {
        const timeParts = b.time.match(/(\d+):(\d+)\s*(AM|PM)/i);
        if (timeParts) {
          let hour = parseInt(timeParts[1]);
          const period = timeParts[3].toUpperCase();
          if (period === 'PM' && hour !== 12) hour += 12;
          if (period === 'AM' && hour === 12) hour = 0;
          hourCounts[hour]++;
        }
      }
    });
    
    if (forecastEnabled && predictionsData && predictionsData.length > 0) {
      predictedData = buildTodayHourForecast(hourCounts);
    }
    
  } else if (currentPeriod === 'week') {
    labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    hourCounts = Array(7).fill(0);
    
    bookings.forEach(b => {
      const bookingDate = new Date(b.date);
      let day = bookingDate.getDay();
      day = day === 0 ? 6 : day - 1;
      hourCounts[day]++;
    });
    
    if (forecastEnabled && predictionsData && predictionsData.length > 0) {
      predictedData = Array(7).fill(0);
      predictionsData.slice(0, 7).forEach((pred, i) => {
        if (i < 7) predictedData[i] = pred.predictedBookings || 0;
      });
    }
    
  } else if (currentPeriod === 'month') {
    labels = ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5'];
    hourCounts = Array(5).fill(0);
    
    bookings.forEach(b => {
      const bookingDate = new Date(b.date);
      const dayOfMonth = bookingDate.getDate();
      const weekIndex = Math.min(Math.floor((dayOfMonth - 1) / 7), 4);
      hourCounts[weekIndex]++;
    });
    
    if (forecastEnabled && predictionsData && predictionsData.length > 0) {
      predictedData = Array(5).fill(0);
      predictionsData.forEach((pred, i) => {
        const weekIndex = Math.min(Math.floor(i / 7), 4);
        predictedData[weekIndex] += pred.predictedBookings || 0;
      });
    }
    
  } else {
    labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    hourCounts = Array(12).fill(0);
    
    bookings.forEach(b => {
      const month = new Date(b.date).getMonth();
      hourCounts[month]++;
    });
    
    if (forecastEnabled && predictionsData && predictionsData.length > 0) {
      predictedData = Array(12).fill(0);
      predictionsData.forEach(pred => {
        const month = new Date(pred.date).getMonth();
        predictedData[month] += pred.predictedBookings || 0;
      });
    }
  }
  
  if (currentChart.peakHours) currentChart.peakHours.destroy();
  
  const chartType = currentPeriod === 'today' ? 'bar' : 'line';
const indexAxis = 'x';   // always vertical bars for today, line for others
  
  const datasets = [{
    label: 'Actual Bookings',
    data: hourCounts,
    backgroundColor: currentPeriod === 'today' ? '#9b59b6' : 'rgba(155, 89, 182, 0.2)',
    borderColor: '#9b59b6',
    borderWidth: 3,
    fill: chartType === 'line',
    tension: 0.4,
    pointRadius: 5,
    pointBackgroundColor: '#9b59b6',
    pointBorderColor: '#fff',
    pointBorderWidth: 2,
    pointHoverRadius: 7,
    barThickness: 12,
    borderRadius: 4
  }];
  
  if (forecastEnabled && predictedData && predictedData.length > 0) {
    datasets.push({
      label: 'Predicted Bookings',
      data: predictedData,
      backgroundColor: currentPeriod === 'today' ? '#f39c12' : 'rgba(243, 156, 18, 0.2)',
      borderColor: '#f39c12',
      borderWidth: 3,
      borderDash: [10, 5],
      fill: chartType === 'line',
      tension: 0.4,
      pointRadius: 5,
      pointBackgroundColor: '#f39c12',
      pointBorderColor: '#fff',
      pointBorderWidth: 2,
      pointHoverRadius: 7,
      barThickness: 12,
      borderRadius: 4
    });
  }
  
  currentChart.peakHours = new Chart(ctx, {
    type: chartType,
    data: { labels, datasets },
    options: {
      indexAxis: indexAxis,
      responsive: true,
      maintainAspectRatio: true,
      plugins: { 
        legend: { 
          display: true,
          position: 'top',
          labels: { 
            boxWidth: 10, 
            padding: 10, 
            font: { size: 11 },
            usePointStyle: true
          }
        },
        tooltip: {
          backgroundColor: 'rgba(0, 0, 0, 0.85)',
          padding: 12,
          cornerRadius: 8,
          callbacks: {
            title: function(context) {
              return `${currentPeriod === 'today' ? '⏰' : ''} ${context[0].label}`;
            },
            label: function(context) {
              const count = context.parsed.y ?? context.parsed.x;
              return `${context.dataset.label}: ${count} booking${count !== 1 ? 's' : ''}`;
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          stacked: false,
          ticks: { 
            stepSize: 1, 
            precision: 0,
            maxRotation: 45,
            minRotation: 0
          },
          grid: { 
    display: true,
            color: 'rgba(0, 0, 0, 0.05)' 
          }
        },
        y: { 
          beginAtZero: true,
          stacked: false,
          ticks: { 
            stepSize: 1, 
            precision: 0 
          },
          grid: { 
    display: true,
            color: 'rgba(0, 0, 0, 0.05)' 
          }
        }
      }
    }
  });

  if (forecastEnabled && predictedData && predictedData.length > 0) {
    addChartNotification('peakHoursChart', hourCounts, predictedData, 'bookings');
  }
}

function createServicesChart(bookings) {
  const ctx = document.getElementById('servicesChart');
  if (!ctx) return;

  let predictedData = null;

  const serviceCounts = {};
  console.log(' First booking sample:', JSON.stringify(bookings[0], null, 2)); // ADD THIS
bookings.forEach(b => {
    // Handle both populated objects and plain strings
    const serviceName = b.service?.name || (typeof b.service === 'string' ? b.service : null);
    if (serviceName) {
      serviceCounts[serviceName] = (serviceCounts[serviceName] || 0) + 1;
    }
  });

console.log(' Services chart - bookings:', bookings.length, 'unique services:', Object.keys(serviceCounts).length, serviceCounts);

  const sorted     = Object.entries(serviceCounts).sort((a, b) => b[1] - a[1]);
  const labels     = sorted.map(s => s[0]);
  const actualData = sorted.map(s => s[1]);

  if (currentChart.services) currentChart.services.destroy();

  // Reset canvas height to default for vertical chart
  ctx.style.height = '';
  ctx.parentElement.style.height = '';

  const datasets = [{
    label: 'Actual Bookings',
    data: actualData,
    backgroundColor: '#c0784f',
    borderColor: '#a0522d',
    borderWidth: 1,
    borderRadius: 6,
  }];

  if (forecastEnabled && predictionsData && predictionsData.length > 0) {
    predictedData = buildServicesChartForecast(labels, serviceCounts);

    if (predictedData) {
      datasets.push({
        label: 'Predicted Demand (SARIMA)',
        data: predictedData,
        backgroundColor: '#8b4513',
        borderColor: '#654321',
        borderWidth: 1,
        borderRadius: 6,
      });
    }
  }

  currentChart.services = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { boxWidth: 10, padding: 10, font: { size: 11 }, usePointStyle: true }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const value = context.parsed.y;
              const total = actualData.reduce((sum, val) => sum + val, 0);
              const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
              return `${context.dataset.label}: ${value} bookings (${percentage}%)`;
            }
          },
          backgroundColor: 'rgba(0, 0, 0, 0.85)',
          padding: 12
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            font: { size: 11 },
            maxRotation: 35,
            minRotation: 35,
            callback: function(value) {
              const label = this.getLabelForValue(value);
              // Truncate long service names
              return label.length > 14 ? label.substring(0, 13) + '…' : label;
            }
          }
        },
        y: {
          beginAtZero: true,
          stacked: false,
          ticks: { stepSize: 1, precision: 0 },
          grid: { color: 'rgba(0,0,0,0.05)' }
        }
      }
    }
  });

  if (forecastEnabled && predictedData && predictedData.length > 0) {
    addChartNotification('servicesChart', actualData, predictedData, 'demand');
  }
}

  function createRevenueChart(bookings) {
  const ctx = document.getElementById('revenueChart');
  if (!ctx) {
    console.warn('️ Revenue chart canvas not found');
    return;
  }
  
  //  DECLARE forecastRevenue HERE
  let forecastRevenue = null;
  let labels, historicalData;
  
  if (currentPeriod === 'today') {
    // Group by booking TIME hour
    labels = Array.from({length: 24}, (_, i) => {
      const period = i >= 12 ? 'PM' : 'AM';
      const displayHour = i === 0 ? 12 : i > 12 ? i - 12 : i;
      return `${displayHour} ${period}`;
    });
    historicalData = Array(24).fill(0);
    
    bookings.filter(b => b.status === 'completed').forEach(b => {
      if (b.time) {
        const timeParts = b.time.match(/(\d+):(\d+)\s*(AM|PM)/i);
        if (timeParts) {
          let hour = parseInt(timeParts[1]);
          const period = timeParts[3].toUpperCase();
          
          if (period === 'PM' && hour !== 12) hour += 12;
          if (period === 'AM' && hour === 12) hour = 0;
          
          historicalData[hour] += b.price || 0;
        }
      }
    });
    
  } else if (currentPeriod === 'week') {
    labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    historicalData = Array(7).fill(0);
    
    bookings.filter(b => b.status === 'completed').forEach(b => {
      const bookingDate = new Date(b.date);
      let day = bookingDate.getDay();
      day = day === 0 ? 6 : day - 1;
      historicalData[day] += b.price || 0;
    });
    
  } else if (currentPeriod === 'month') {
    labels = ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5'];
    historicalData = Array(5).fill(0);
    
    bookings.filter(b => b.status === 'completed').forEach(b => {
      const bookingDate = new Date(b.date);
      const dayOfMonth = bookingDate.getDate();
      const weekIndex = Math.min(Math.floor((dayOfMonth - 1) / 7), 4);
      historicalData[weekIndex] += b.price || 0;
    });
    
  } else { // year
    labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    historicalData = Array(12).fill(0);
    
    bookings.filter(b => b.status === 'completed').forEach(b => {
      const month = new Date(b.date).getMonth();
      historicalData[month] += b.price || 0;
    });
  }
  
  // DESTROY old chart
  if (currentChart.revenue) {
    currentChart.revenue.destroy();
  }
  
  //  BUILD DATASETS
  const datasets = [
    {
      label: 'Actual Revenue',
      data: historicalData,
      borderColor: '#28a745',
      backgroundColor: 'rgba(40, 167, 69, 0.2)',
      borderWidth: 3,
      fill: true,
      tension: 0.4,
      pointRadius: 5,
      pointBackgroundColor: '#28a745',
      pointBorderColor: '#fff',
      pointBorderWidth: 2,
      pointHoverRadius: 8
    }
  ];
  
  //  ADD FORECAST if enabled
  //  ADD FORECAST — aggregate per period so daily predictions
  //    roll up to the right hourly / daily / weekly / monthly buckets.
  if (forecastEnabled && predictionsData && predictionsData.length > 0) {

    if (currentPeriod === 'today') {
      // Spread the first day's predicted revenue across 24 hours,
      // proportional to where actual revenue actually fell.
      const totalHourly = historicalData.reduce((s, v) => s + v, 0);
      const dayRevenue  = predictionsData[0]?.predictedRevenue || 0;
      forecastRevenue   = totalHourly > 0
        ? historicalData.map(h => Math.round((h / totalHourly) * dayRevenue))
        : Array(24).fill(Math.round(dayRevenue / 24));

    } else if (currentPeriod === 'week') {
      // Direct 1-to-1: each daily prediction → Mon / Tue / … / Sun
      forecastRevenue = Array(7).fill(0);
      predictionsData.slice(0, 7).forEach((pred, i) => {
        forecastRevenue[i] = pred.predictedRevenue || 0;
      });

    } else if (currentPeriod === 'month') {
      // Group daily predictions into 5 weekly buckets
      forecastRevenue = Array(5).fill(0);
      predictionsData.forEach((pred, i) => {
        const weekIndex = Math.min(Math.floor(i / 7), 4);
        forecastRevenue[weekIndex] += pred.predictedRevenue || 0;
      });

    } else {
      // year — sum daily predictions by calendar month
      forecastRevenue = Array(12).fill(0);
      predictionsData.forEach(pred => {
        const month = new Date(pred.date).getMonth();
        if (month >= 0 && month < 12) {
          forecastRevenue[month] += pred.predictedRevenue || 0;
        }
      });
    }
    
    datasets.push({
      label: 'Predicted Revenue',
      data: forecastRevenue,
      borderColor: '#9b59b6',
      backgroundColor: 'rgba(155, 89, 182, 0.2)',
      borderWidth: 3,
      borderDash: [10, 5],
      fill: true,
      tension: 0.4,
      pointRadius: 5,
      pointBackgroundColor: '#9b59b6',
      pointBorderColor: '#fff',
      pointBorderWidth: 2,
      pointHoverRadius: 8
    });
  }
  
  // Create chart with SMART TOOLTIPS
  currentChart.revenue = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: { 
        legend: { 
          display: true,
          position: 'top',
          labels: {
            boxWidth: 12,
            padding: 15,
            font: { size: 12 }
          }
        },
        tooltip: {
          backgroundColor: 'rgba(0, 0, 0, 0.85)',
          titleColor: '#fff',
          bodyColor: '#fff',
          padding: 16,
          cornerRadius: 8,
          displayColors: true,
          callbacks: {
            //  TITLE: Show period label
            title: function(context) {
              return context[0].label;
            },
            
            //  LABEL: Show revenue with insight
            label: function(context) {
              const datasetLabel = context.dataset.label;
              const value = context.parsed.y;
              const index = context.dataIndex;
              
              // Calculate percentage change from previous period
              let insight = '';
              if (index > 0) {
                const prevValue = context.dataset.data[index - 1];
                if (prevValue > 0) {
                  const percentChange = ((value - prevValue) / prevValue * 100).toFixed(1);
                  const arrow = percentChange > 0 ? '↑' : percentChange < 0 ? '↓' : '→';
                  const sign = percentChange > 0 ? '+' : '';
                  insight = ` (${arrow} ${sign}${percentChange}% from previous)`;
                }
              }
              
              return `${datasetLabel}: ₱${value.toLocaleString()}${insight}`;
            },
            
            //  FOOTER: Show additional insights
            footer: function(context) {
              const actualValue = context[0].parsed.y;
              
              // If forecast is available, compare
              if (context.length > 1 && context[1].dataset.label === 'Predicted Revenue') {
                const predictedValue = context[1].parsed.y;
                const difference = actualValue - predictedValue;
                const percentDiff = predictedValue > 0 ? 
                  ((difference / predictedValue) * 100).toFixed(1) : 0;
                
                if (Math.abs(percentDiff) > 5) {
                  const status = difference > 0 ? 
                    ` Exceeding forecast by ${percentDiff}%` :
                    `️ Below forecast by ${Math.abs(percentDiff)}%`;
                  return `\n${status}`;
                }
              }
              
              // Show booking count if available
              const period = context[0].label;
              const relevantBookings = bookings.filter(b => {
                if (currentPeriod === 'today' && b.time) {
                  const timeParts = b.time.match(/(\d+):(\d+)\s*(AM|PM)/i);
                  if (timeParts) {
                    let hour = parseInt(timeParts[1]);
                    const timePeriod = timeParts[3].toUpperCase();
                    if (timePeriod === 'PM' && hour !== 12) hour += 12;
                    if (timePeriod === 'AM' && hour === 12) hour = 0;
                    const displayHour = hour >= 12 ? 
                      `${hour === 12 ? 12 : hour - 12} PM` : 
                      `${hour === 0 ? 12 : hour} AM`;
                    return displayHour === period && b.status === 'completed';
                  }
                }
                return false;
              }).length;
              
              if (relevantBookings > 0) {
                return `\n ${relevantBookings} booking${relevantBookings !== 1 ? 's' : ''} completed`;
              }
              
              return '';
            }
          }
        }
      },
      scales: {
        x: {
          grid: {
            display: false
          }
        },
        y: {
          beginAtZero: true,
          ticks: {
            callback: function(value) {
              return '₱' + value.toLocaleString();
            }
          },
          grid: {
            color: 'rgba(0, 0, 0, 0.05)'
          }
        }
      }
    }
  });

  //  ADD CHART NOTIFICATION (NOW forecastRevenue is in scope!)
  if (forecastEnabled && forecastRevenue && forecastRevenue.length > 0) {
    addChartNotification('revenueChart', historicalData, forecastRevenue, 'revenue');
  }
}


  function createRevenueStatusChart(bookings) {
    const ctx = document.getElementById('revenueStatusChart');
    if (!ctx) return;
    
    const completed = bookings.filter(b => b.status === 'completed');
    const cancelled = bookings.filter(b => b.status === 'cancelled');
    
    const earnedRevenue = completed.reduce((sum, b) => sum + (b.price || 0), 0);
    //const retainedDP = Math.round(earnedRevenue * 0.25);
    const revenueLoss = cancelled.reduce((sum, b) => sum + (b.price || 0), 0);
    
    if (currentChart.revenueStatus) currentChart.revenueStatus.destroy();
    
    currentChart.revenueStatus = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['Earned Revenue', 'Revenue Loss'],
        datasets: [{
          data: [earnedRevenue, revenueLoss],
          backgroundColor: ['#28a745', '#dc3545']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: { legend: { display: false } },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: function(value) {
                return '₱' + value.toLocaleString();
              }
            }
          }
        }
      }
    });
  const chartBox = document.getElementById('revenueStatusChart')?.closest('.chart-box');
    if (chartBox) {
      const existingNotif = chartBox.querySelector('.chart-notification');
      if (existingNotif) existingNotif.remove();
      
      const completed = bookings.filter(b => b.status === 'completed');
      const earnedRevenue = completed.reduce((sum, b) => sum + (b.price || 0), 0);
      //const retainedDP = Math.round(earnedRevenue * 0.25);
      const cancelled = bookings.filter(b => b.status === 'cancelled');
      const revenueLoss = cancelled.reduce((sum, b) => sum + (b.price || 0), 0);
      
      const growthRate = earnedRevenue > 0 ? ((earnedRevenue - revenueLoss) / earnedRevenue * 100).toFixed(1) : 0;
      const icon = growthRate > 0 ? '' : growthRate < 0 ? '' : '️';
      const color = growthRate > 0 ? '#28a745' : growthRate < 0 ? '#dc3545' : '#ffc107';
      
      const notification = document.createElement('div');
      notification.className = 'chart-notification';
      notification.style.cssText = `
        margin-top: 15px;
        padding: 12px 16px;
        background: ${color}15;
        border-left: 4px solid ${color};
        border-radius: 8px;
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 0.9rem;
      `;
      
      notification.innerHTML = `
        <span style="font-size: 1.5rem;">${icon}</span>
        <div>
          <strong style="color: ${color};">${Math.abs(growthRate)}% Net Revenue Growth</strong>
          <div style="color: #666; font-size: 0.85rem; margin-top: 2px;">
            Earned: ₱${earnedRevenue.toLocaleString()} • Loss: ₱${revenueLoss.toLocaleString()}
          </div>
        </div>
      `;
      
      chartBox.appendChild(notification);
    }
  }

  function createBookingDistChart(bookings) {
    const ctx = document.getElementById('bookingDistChart');
    if (!ctx) return;
    
    const completed = bookings.filter(b => b.status === 'completed').length;
    const cancelled = bookings.filter(b => b.status === 'cancelled').length;
    
    if (currentChart.bookingDist) currentChart.bookingDist.destroy();
    
    currentChart.bookingDist = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Completed', 'Cancelled'],
        datasets: [{
          data: [completed, cancelled],
          backgroundColor: ['#28a745', '#dc3545']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: 'bottom'
          }
        }
      }
    });
  }

  // CALENDAR AND BOOKINGS MANAGEMENT
  let currentMonth = new Date().getMonth();
  let currentYear = new Date().getFullYear();

  async function loadBookingsCalendar() {
  try {
    await loadClosures();
    renderClosurePanel();
    if (!allBookings || allBookings.length === 0) {
      const now  = new Date();
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split('T')[0];
      const to   = new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString().split('T')[0];
      const res  = await fetch(`${apiBase}/bookings?from=${from}&to=${to}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      allBookings = await res.json();
      console.log(` Calendar loaded ${allBookings.length} bookings (${from} → ${to})`);
    }
    renderCalendar();
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
    if (!selectedDate) {
      const todayCell = document.querySelector(`.calendar-day[data-date="${todayStr}"]`);
      if (todayCell && !todayCell.classList.contains('admin-blocked')) {
        selectDate(todayStr, todayCell);
      }
    }
  } catch (err) {
    console.error(err);
  }
}

  async function loadPendingRequests() {
  try {
    // Reuse allBookings instead of re-fetching
    const pending = (allBookings || []).filter(b =>
      b.status === 'pending_cancellation' || b.status === 'pending_reschedule'
    );
    renderPendingRequestsPanel(pending);
  } catch (err) {
    console.error(' Error loading pending requests:', err);
  }
}
window.loadPendingRequests = loadPendingRequests;

function renderPendingRequestsPanel(requests) {
  // Find or create the panel container inside the bookings tab
  let panel = document.getElementById('pendingRequestsPanel');
  if (!panel) {
    const bookingsSection = document.getElementById('bookings-tab');
    if (!bookingsSection) return;

    panel = document.createElement('div');
    panel.id = 'pendingRequestsPanel';

    // Insert before the calendar section
    const calendarSection = bookingsSection.querySelector('.calendar-section');
    if (calendarSection) {
      bookingsSection.insertBefore(panel, calendarSection);
    } else {
      bookingsSection.prepend(panel);
    }
  }

  if (requests.length === 0) {
    panel.innerHTML = '';
    return;
  }

  panel.innerHTML = `
    <div style="
      background: linear-gradient(135deg, #fff8e1 0%, #ffe082 30%, #fff8e1 100%);
      border: 2px solid #ff9800;
      border-radius: 12px;
      padding: 24px;
      margin-bottom: 30px;
    ">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h3 style="margin:0;color:#e65100;display:flex;align-items:center;gap:10px;">
          <span style="background:#ff9800;color:white;border-radius:50%;width:32px;height:32px;
            display:inline-flex;align-items:center;justify-content:center;font-size:0.9rem;font-weight:700;">
            ${requests.length}
          </span>
          Pending Client Requests — Action Required
        </h3>
        <button
          onclick="loadPendingRequests()"
          style="padding:8px 16px;background:#4b2e1e;color:white;border:none;border-radius:6px;cursor:pointer;font-size:0.85rem;">
           Refresh
        </button>
      </div>

      <div style="display:grid;gap:16px;">
        ${requests.map(booking => renderPendingRequestCard(booking)).join('')}
      </div>
    </div>
  `;
}


// ─── RENDER INDIVIDUAL REQUEST CARD ──────────────────────────────────────────

function renderPendingRequestCard(booking) {
  const isCancellation = booking.status === 'pending_cancellation';
  const isReschedule   = booking.status === 'pending_reschedule';

  const color      = isCancellation ? '#dc3545' : '#9c27b0';
  const bg         = isCancellation ? '#ffebee' : '#f3e5f5';
  const typeLabel  = isCancellation ? ' Cancellation Request' : ' Reschedule Request';
  const requestedAt = isCancellation
    ? (booking.cancellationRequestedAt
        ? new Date(booking.cancellationRequestedAt).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
        : 'Unknown time')
    : (booking.rescheduleRequestedAt
        ? new Date(booking.rescheduleRequestedAt).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })
        : 'Unknown time');

  const bookingDate = new Date(booking.date).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  });

  return `
    <div style="
      background: white;
      border: 2px solid ${color}40;
      border-left: 5px solid ${color};
      border-radius: 10px;
      padding: 20px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.06);
    ">
      <!-- Header row -->
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:16px;">
        <div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
            <span style="background:${bg};color:${color};padding:4px 12px;border-radius:20px;
              font-size:0.82rem;font-weight:700;border:1px solid ${color}40;">
              ${typeLabel}
            </span>
            <span style="color:#999;font-size:0.82rem;">Submitted: ${requestedAt}</span>
          </div>
          <h4 style="margin:0;color:#4b2e1e;font-size:1.1rem;">${booking.guestName}</h4>
          <div style="color:#666;font-size:0.88rem;margin-top:4px;">
             ${booking.guestPhone} &nbsp;|&nbsp;
             <span style="font-family:monospace;background:#f5f5f5;padding:2px 8px;border-radius:4px;">
              ${booking.transactionNumber || booking._id.substring(0,8).toUpperCase()}
            </span>
          </div>
        </div>

        <!-- Action Buttons -->
        <div style="display:flex;gap:10px;flex-shrink:0;">
          ${isCancellation ? `
            <button
              onclick="approveCancellation('${booking._id}')"
              style="padding:10px 20px;background:#28a745;color:white;border:none;border-radius:8px;
                cursor:pointer;font-weight:600;font-size:0.9rem;transition:0.2s;"
              onmouseover="this.style.background='#1e7e34'"
              onmouseout="this.style.background='#28a745'">
               Approve Cancellation
            </button>
            <button
              onclick="rejectCancellation('${booking._id}')"
              style="padding:10px 20px;background:#dc3545;color:white;border:none;border-radius:8px;
                cursor:pointer;font-weight:600;font-size:0.9rem;transition:0.2s;"
              onmouseover="this.style.background='#c82333'"
              onmouseout="this.style.background='#dc3545'">
               Reject
            </button>
          ` : `
            <button
              onclick="approveReschedule('${booking._id}')"
              style="padding:10px 20px;background:#28a745;color:white;border:none;border-radius:8px;
                cursor:pointer;font-weight:600;font-size:0.9rem;transition:0.2s;"
              onmouseover="this.style.background='#1e7e34'"
              onmouseout="this.style.background='#28a745'">
               Approve Reschedule
            </button>
            <button
              onclick="rejectReschedule('${booking._id}')"
              style="padding:10px 20px;background:#dc3545;color:white;border:none;border-radius:8px;
                cursor:pointer;font-weight:600;font-size:0.9rem;transition:0.2s;"
              onmouseover="this.style.background='#c82333'"
              onmouseout="this.style.background='#dc3545'">
               Reject
            </button>
          `}
        </div>
      </div>

      <!-- Booking Details -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;
        background:#f8f9fa;border-radius:8px;padding:14px;margin-bottom:14px;">
        <div>
          <div style="font-size:0.78rem;color:#888;text-transform:uppercase;letter-spacing:0.05em;">Service</div>
          <div style="font-weight:600;color:#4b2e1e;">${booking.service?.name || 'N/A'}</div>
        </div>
        <div>
          <div style="font-size:0.78rem;color:#888;text-transform:uppercase;letter-spacing:0.05em;">Current Date & Time</div>
          <div style="font-weight:600;color:#4b2e1e;">${bookingDate} · ${booking.time}</div>
        </div>
        <div>
          <div style="font-size:0.78rem;color:#888;text-transform:uppercase;letter-spacing:0.05em;">Therapist</div>
          <div style="font-weight:600;color:#4b2e1e;">${booking.therapist?.name || 'Unassigned'}</div>
        </div>
        <div>
          <div style="font-size:0.78rem;color:#888;text-transform:uppercase;letter-spacing:0.05em;">Amount</div>
          <div style="font-weight:600;color:#4b2e1e;">₱${(booking.price || 0).toLocaleString()}</div>
        </div>
      </div>

      <!-- Reason Box -->
      ${isCancellation && booking.cancellationReason ? `
        <div style="background:${bg};border-left:3px solid ${color};padding:12px 16px;border-radius:6px;">
          <div style="font-size:0.8rem;color:${color};font-weight:700;margin-bottom:4px;">
            CLIENT'S CANCELLATION REASON
          </div>
          <div style="color:#333;font-size:0.95rem;">${booking.cancellationReason}</div>
        </div>
      ` : ''}

      ${isReschedule ? `
        <div style="background:${bg};border-left:3px solid ${color};padding:12px 16px;border-radius:6px;">
          <div style="font-size:0.8rem;color:${color};font-weight:700;margin-bottom:8px;">
            RESCHEDULE REQUEST DETAILS
          </div>
          <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:${booking.rescheduleReason?'10px':'0'};">
            <div>
              <div style="font-size:0.78rem;color:#888;">Requested New Date</div>
              <div style="font-weight:700;color:#4b2e1e;">
                ${new Date(booking.pendingRescheduleDate).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}
              </div>
            </div>
            <div>
              <div style="font-size:0.78rem;color:#888;">Requested New Time</div>
              <div style="font-weight:700;color:#4b2e1e;">${booking.pendingRescheduleTime}</div>
            </div>
          </div>
          ${booking.rescheduleReason ? `
            <div style="margin-top:8px;">
              <div style="font-size:0.78rem;color:#888;">Client's Reason</div>
              <div style="color:#333;font-size:0.95rem;">${booking.rescheduleReason}</div>
            </div>
          ` : ''}
        </div>
      ` : ''}
    </div>
  `;
}


// ─── APPROVE / REJECT FUNCTIONS ───────────────────────────────────────────────

async function approveCancellation(bookingId) {
  if (!confirm('Approve this cancellation request? The booking will be cancelled.')) return;

  try {
    const res = await fetch(`${apiBase}/bookings/cancel/${bookingId}/approve`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) { showNotification(` ${data.msg}`, 'error'); return; }

    showNotification(' Cancellation approved. Booking has been cancelled.', 'success');
    loadPendingRequests();
    if (allBookings) {
  const idx = allBookings.findIndex(b => b._id === bookingId);
  if (idx > -1) allBookings[idx].status = 'cancelled';
}
    if (selectedDate) loadBookingsForDate(selectedDate);

  } catch (err) {
    showNotification(' Error approving cancellation', 'error');
  }
}
window.approveCancellation = approveCancellation;


async function rejectCancellation(bookingId) {
  const adminNote = prompt(
    'Reason for rejecting this cancellation request:\n(This note will be visible to the client)',
    'We are unable to process your cancellation at this time. Please contact us directly.'
  );
  if (adminNote === null) return; // user pressed Cancel

  try {
    const res = await fetch(`${apiBase}/bookings/cancel/${bookingId}/reject`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ adminNote: adminNote.trim() || 'Cancellation request was not approved.' })
    });
    const data = await res.json();
    if (!res.ok) { showNotification(` ${data.msg}`, 'error'); return; }

    showNotification(' Cancellation request rejected. Booking remains active.', 'success');
    loadPendingRequests();
    if (selectedDate) loadBookingsForDate(selectedDate);

  } catch (err) {
    showNotification(' Error rejecting cancellation', 'error');
  }
}
window.rejectCancellation = rejectCancellation;


async function approveReschedule(bookingId) {
  if (!confirm('Approve this reschedule request? The booking will be moved to the new date and time.')) return;

  try {
    const res = await fetch(`${apiBase}/bookings/reschedule/${bookingId}/approve`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) { showNotification(` ${data.msg}`, 'error'); return; }

    showNotification(' Reschedule approved. Booking has been moved.', 'success');
    loadPendingRequests();
    if (allBookings) {
  const idx = allBookings.findIndex(b => b._id === bookingId);
  if (idx > -1) allBookings[idx].status = 'cancelled';
}
    if (selectedDate) loadBookingsForDate(selectedDate);

  } catch (err) {
    showNotification(' Error approving reschedule', 'error');
  }
}
window.approveReschedule = approveReschedule;


async function rejectReschedule(bookingId) {
  const adminNote = prompt(
    'Reason for rejecting this reschedule request:\n(This note will be visible to the client)',
    'We are unable to accommodate the requested date/time. Please contact us to arrange an alternative.'
  );
  if (adminNote === null) return;

  try {
    const res = await fetch(`${apiBase}/bookings/reschedule/${bookingId}/reject`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ adminNote: adminNote.trim() || 'Reschedule request was not approved.' })
    });
    const data = await res.json();
    if (!res.ok) { showNotification(` ${data.msg}`, 'error'); return; }

    showNotification(' Reschedule request rejected. Booking stays at original time.', 'success');
    loadPendingRequests();
    if (selectedDate) loadBookingsForDate(selectedDate);

  } catch (err) {
    showNotification(' Error rejecting reschedule', 'error');
  }
}
window.rejectReschedule = rejectReschedule;

function getBookingRowActions(b) {
  if (b.status === 'pending_cancellation') {
    return `
      <div style="display:flex;flex-direction:column;gap:6px;">
        <button class="btn-confirm"
          onclick="approveCancellation('${b._id}')"
          style="background:#28a745;"> Approve Cancel</button>
        <button class="btn-cancel-booking"
          onclick="rejectCancellation('${b._id}')"
          style="background:#dc3545;"> Reject</button>
      </div>`;
  }
  if (b.status === 'pending_reschedule') {
    return `
      <div style="display:flex;flex-direction:column;gap:6px;">
        <button class="btn-confirm"
          onclick="approveReschedule('${b._id}')"
          style="background:#28a745;"> Approve Reschedule</button>
        <button class="btn-cancel-booking"
          onclick="rejectReschedule('${b._id}')"
          style="background:#dc3545;"> Reject</button>
      </div>`;
  }
  if (b.status === 'pending') {
    return `
      <button class="btn-confirm" onclick="confirmBooking('${b._id}')">Confirm</button>
      <button class="btn-cancel-booking" onclick="cancelBooking('${b._id}')">Cancel</button>`;
  }
  return '-';
}
window.getBookingRowActions = getBookingRowActions;

  function renderCalendar() {
    const monthNames = ["January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"];
    
    document.getElementById('currentMonth').textContent = `${monthNames[currentMonth]} ${currentYear}`;
    
    const firstDay = new Date(currentYear, currentMonth, 1).getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    
    const calendarGrid = document.getElementById('calendar');
    calendarGrid.innerHTML = '';
    
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    days.forEach(day => {
      const header = document.createElement('div');
      header.textContent = day;
      header.style.cssText = 'font-weight: 600; text-align: center; padding: 10px;';
      calendarGrid.appendChild(header);
    });
    
    for (let i = 0; i < firstDay; i++) {
      const emptyCell = document.createElement('div');
      calendarGrid.appendChild(emptyCell);
    }
    
   for (let day = 1; day <= daysInMonth; day++) {
  const dayCell = document.createElement('div');
  dayCell.className = 'calendar-day';

  const dateStr    = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  dayCell.dataset.date = dateStr;
  const closure   = getClosureForDate(dateStr);
  const isBlocked = !!closure;
  const isSingle  = closure && closure.start === closure.end;

  const hasBookings = allBookings.some(b =>
    new Date(b.date).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) === dateStr
  );

  if (hasBookings) dayCell.classList.add('has-bookings');
  if (isBlocked)   dayCell.classList.add('admin-blocked');
  if (isSingle)    dayCell.classList.add('holiday-day');
  if (isBlocked && !isSingle) dayCell.classList.add('vacation-day');

  dayCell.innerHTML = `
    <span class="day-number">${day}</span>
    ${isBlocked ? `<span class="closure-badge">${isSingle ? '' : '️'} ${closure.label || 'Closed'}</span>` : ''}
  `;

  if (!isBlocked) {
    dayCell.addEventListener('click', () => selectDate(dateStr, dayCell));
  } else {
    dayCell.style.cursor = 'not-allowed';
    dayCell.title = `${closure.label || 'Store Closed'} — no bookings on this date`;
  }

  dayCell.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (closure && !isSingle) {
      showNotification('To remove a multi-day closure, use the panel above', 'info');
      return;
    }
    openHolidayModal(dateStr, isBlocked);
  });

  calendarGrid.appendChild(dayCell);
}
  }

  function selectDate(dateStr, dayCell) {
    document.querySelectorAll('.calendar-day').forEach(cell => {
      cell.classList.remove('selected');
    });
    
    dayCell.classList.add('selected');
    selectedDate = dateStr;
    
    loadBookingsForDate(dateStr);
  }

  function loadBookingsForDate(dateStr) {
    const allDayBookings = allBookings.filter(b => {
      const bookingDate = new Date(b.date).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
      return bookingDate === dateStr;
    });

    // Apply active status filter
    const dayBookings = activeBookingStatusFilter === 'all'
      ? allDayBookings
      : allDayBookings.filter(b => b.status === activeBookingStatusFilter);

    const sortedBookings = sortBookingsByStatusAndTime(dayBookings);
    
    const formattedDate = new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const filterLabel = activeBookingStatusFilter === 'all' ? '' : ` · ${activeBookingStatusFilter.replace('_',' ')} only`;
    document.getElementById('selectedDateTitle').textContent = `Bookings for ${formattedDate}${filterLabel} (${dayBookings.length} of ${allDayBookings.length})`;
    
    const tbody = document.querySelector('#bookingsTable tbody');
    
    if (dayBookings.length === 0) {
      const emptyMsg = activeBookingStatusFilter === 'all'
        ? 'No bookings for this date'
        : `No <strong>${activeBookingStatusFilter.replace('_',' ')}</strong> bookings for this date`;
      tbody.innerHTML = `
        <tr>
          <td colspan="9" style="text-align: center; padding: 40px; color: #999;">
            ${emptyMsg}
          </td>
        </tr>
      `;
      const mobileList = document.getElementById('mobileBookingList');
      if (mobileList) mobileList.innerHTML = `<p style="text-align:center;padding:30px;color:#999;">${emptyMsg}</p>`;
      return;
    }
    
    //  Separate walk-in and online bookings
    const walkInBookings = dayBookings.filter(b => b.bookingType === 'walk-in');
    const onlineBookings = dayBookings.filter(b => b.bookingType === 'online' || !b.bookingType);
    
    console.log(` ${formattedDate}:`, {
      total: allDayBookings.length,
      filtered: dayBookings.length,
      filter: activeBookingStatusFilter,
      walkIn: walkInBookings.length,
      online: onlineBookings.length
    });
    
    tbody.innerHTML = '';
    const mobileList = document.getElementById('mobileBookingList');
    if (mobileList) mobileList.innerHTML = '';

    //  Display Online Bookings First
    if (onlineBookings.length > 0) {
      tbody.innerHTML += `
        <tr style="background: #e3f2fd; font-weight: 700;">
          <td colspan="9" style="padding: 12px; color: #1976d2; font-size: 1.1rem;">
   ONLINE BOOKINGS (${onlineBookings.length})
</td>
        </tr>
      `;
      tbody.innerHTML += onlineBookings.map(b => generateBookingRow(b, 'online')).join('');

      if (mobileList) {
        mobileList.innerHTML += `<div class="mobile-group-header mobile-group-online"> ONLINE BOOKINGS (${onlineBookings.length})</div>`;
        mobileList.innerHTML += onlineBookings.map(b => generateMobileBookingCard(b, 'online')).join('');
      }
    }

    //  Display Walk-in Bookings
    if (walkInBookings.length > 0) {
      tbody.innerHTML += `
        <tr style="background: #fff3e0; font-weight: 700; border-top: 3px solid #ff9800;">
          <td colspan="9" style="padding: 12px; color: #f57c00; font-size: 1.1rem;">
   WALK-IN BOOKINGS (${walkInBookings.length})
</td>
        </tr>
      `;
      tbody.innerHTML += walkInBookings.map(b => generateBookingRow(b, 'walk-in')).join('');

      if (mobileList) {
        mobileList.innerHTML += `<div class="mobile-group-header mobile-group-walkin"> WALK-IN BOOKINGS (${walkInBookings.length})</div>`;
        mobileList.innerHTML += walkInBookings.map(b => generateMobileBookingCard(b, 'walk-in')).join('');
      }
    }
  }

  /* ── Mobile card renderer ── */
  function generateMobileBookingCard(b, type) {
    const clientName  = b.guestName || 'Guest';
    const serviceName = b.service ? b.service.name : 'N/A';
    const numClients  = (b.femaleClients != null && b.maleClients != null)
      ? (b.femaleClients + b.maleClients)
      : (b.numberOfClients || 1);
    const duration    = b.durationMinutes || 60;
    const price       = (b.price || 0).toLocaleString();
    const startTime   = b.time || '—';
    const endTime     = formatEndTime(b.endTime);
    const phone = b.guestPhone || 'No phone';
    const txn   = b.transactionNumber || 'N/A';

    const femaleCount = b.femaleClients ?? null;
    const maleCount   = b.maleClients   ?? null;
    const genderHtml  = (femaleCount !== null && maleCount !== null)
      ? `<span class="mc-gender mc-female">${femaleCount}</span><span class="mc-gender mc-male">${maleCount}</span>`
      : '';

    let therapistName = 'Any Available';
    if (b.therapists && b.therapists.length > 0) therapistName = b.therapists.map(t => t.name).join(', ');
    else if (b.therapist) therapistName = b.therapist.name || b.therapist;

    const typeBadge = type === 'walk-in'
      ? `<span class="mc-type-badge mc-walkin"> WALK-IN</span>`
      : `<span class="mc-type-badge mc-online"> ONLINE</span>`;

    let actionsHtml = '';
    if (b.status === 'pending') {
      actionsHtml = `
        <button class="mc-btn mc-btn-confirm" onclick="confirmBooking('${b._id}')">Confirm</button>
        <button class="mc-btn mc-btn-cancel"  onclick="cancelBooking('${b._id}')">Cancel</button>`;
    } else {
      const raw = getBookingRowActions(b);
      if (raw && raw !== '-') {
        actionsHtml = raw
          .replace(/class="btn-confirm"/g,       'class="mc-btn mc-btn-confirm"')
          .replace(/class="btn-cancel-booking"/g, 'class="mc-btn mc-btn-cancel"')
          .replace(/class="btn-complete"/g,       'class="mc-btn mc-btn-complete"');
      }
    }

    return `
      <div class="mobile-booking-card" data-booking-id="${b._id}">
        <div class="mc-header">
          <span class="mc-name">${clientName}${numClients > 1 ? ` <span class="mc-clients">(${numClients} clients)</span>` : ''}</span>
          ${typeBadge}
        </div>
        ${genderHtml ? `<div class="mc-gender-row">${genderHtml}</div>` : ''}
        <div class="mc-time-service">
          <span class="mc-time-pill"> ${startTime}${endTime !== '—' ? ` – ${endTime}` : ''}</span>
          <span class="mc-service">${serviceName}</span>
        </div>
        <div class="mc-meta">
          <span> ${therapistName}</span>
          <span class="mc-sep">·</span>
          <span>${duration} mins</span>
          <span class="mc-sep">·</span>
          <span class="mc-price">₱${price}</span>
        </div>
        <div class="mc-contact">
          <span> ${phone}</span>
          <span class="mc-sep">·</span>
          <span class="mc-txn"> ${txn}</span>
        </div>
        <div style="margin:5px 0 3px;">
          <button class="mc-reassign-btn" onclick="openAssignTherapist('${b._id}', '${therapistName.replace(/'/g,"\\'")}')"> Reassign</button>
          ${b.assignNote ? `<span class="mc-assign-note">${b.assignNote}</span>` : ''}
        </div>
        <div class="mc-footer">
          <span class="status-badge status-${b.status}">${b.status}</span>
          <div class="mc-actions">${actionsHtml}</div>
        </div>
      </div>`;
  }

  function parseTimeToMinutes(timeStr) {
    if (!timeStr) return 0;
    
    try {
      // Handle formats like "3:00 PM" or "03:00 PM"
      const match = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i);
      
      if (!match) {
        console.warn('Invalid time format:', timeStr);
        return 0;
      }
      
      let hours = parseInt(match[1]);
      const minutes = parseInt(match[2]);
      const period = match[3].toUpperCase();
      
      // Convert to 24-hour format
      if (period === 'PM' && hours !== 12) {
        hours += 12;
      } else if (period === 'AM' && hours === 12) {
        hours = 0;
      }
      
      return hours * 60 + minutes;
    } catch (err) {
      console.error('Error parsing time:', timeStr, err);
      return 0;
    }
  }

  function formatBookingTime(booking) {
  const start = booking.time || '';
  const end   = booking.endTime || '';
  return end ? `${start} – ${end}` : start;
}

function formatBookingDate(b) {
  if (!b.date) return '—';
  return new Date(b.date).toLocaleDateString('en-US',
    { weekday:'short', month:'short', day:'numeric', year:'numeric', timeZone: 'Asia/Manila' });
}

  function sortBookingsByStatusAndTime(bookings) {
    const statusOrder = {
      'pending': 1,
      'confirmed': 2,
      'completed': 3,
      'cancelled': 4
    };
    
    return bookings.sort((a, b) => {
      // First sort by status
      const statusDiff = statusOrder[a.status] - statusOrder[b.status];
      if (statusDiff !== 0) return statusDiff;
      
      // Then sort by time within same status
      const timeA = parseTimeToMinutes(a.time);
      const timeB = parseTimeToMinutes(b.time);
      return timeA - timeB;
    });
  }

  // Generate booking row HTML
  function generateBookingRow(b, type) {
  const clientName  = b.guestName || "Guest";
  const serviceName = b.service ? b.service.name : "N/A";

  // Therapist cell — always show Reassign button underneath
  let therapistName = 'Any Available';
  if (b.therapists && b.therapists.length > 0) {
    therapistName = b.therapists.map(t => t.name).join(', ');
  } else if (b.therapist) {
    therapistName = b.therapist.name || b.therapist;
  }

  const therapistDisplay = `
    <div style="font-weight:500;">${therapistName}</div>
    <button
      onclick="openAssignTherapist('${b._id}', '${therapistName.replace(/'/g, "\\'")}')"
      style="margin-top:5px;font-size:0.72rem;padding:3px 10px;background:#4b2e1e;
        color:#fff;border:none;border-radius:5px;cursor:pointer;white-space:nowrap;">
       Reassign
    </button>
    ${b.assignNote ? `<div style="font-size:0.72rem;color:#888;margin-top:3px;font-style:italic;">${b.assignNote}</div>` : ''}
  `;

  const duration   = b.durationMinutes || 60;
  const numClients = (b.femaleClients != null && b.maleClients != null)
    ? (b.femaleClients + b.maleClients)
    : (b.numberOfClients || 1);
  const femaleCount = b.femaleClients ?? null;
  const maleCount   = b.maleClients   ?? null;
  const genderBreakdown = (femaleCount !== null && maleCount !== null && (femaleCount > 0 || maleCount > 0))
    ? `<span style="font-size:0.78rem;color:#be185d;font-weight:600;">${femaleCount}</span>
       <span style="font-size:0.78rem;color:#1d4ed8;font-weight:600;margin-left:4px;">${maleCount}</span>`
    : '';
  const startTime  = b.time || '—';
  const endTime    = formatEndTime(b.endTime);

  // Format date from booking.date
  const bookingDateStr = b.date
    ? new Date(b.date).toLocaleDateString('en-US', {
        timeZone: 'Asia/Manila',
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
      })
    : '—';

  const typeBadge = type === 'walk-in'
    ? `<span style="display:inline-block;padding:4px 8px;background:#fff3e0;color:#f57c00;
        border-radius:4px;font-size:0.75rem;font-weight:600;margin-left:8px;border:1px solid #ff9800;">
         WALK-IN</span>`
    : `<span style="display:inline-block;padding:4px 8px;background:#e3f2fd;color:#1976d2;
        border-radius:4px;font-size:0.75rem;font-weight:600;margin-left:8px;border:1px solid #2196f3;">
         ONLINE</span>`;

  const actions = b.status === 'pending'
    ? `<button class="btn-confirm" onclick="confirmBooking('${b._id}')">Confirm</button>
       <button class="btn-cancel-booking" onclick="cancelBooking('${b._id}')">Cancel</button>`
    : getBookingRowActions(b);

  return `
    <tr style="${type === 'walk-in' ? 'background:#fffbf0;' : ''}" data-booking-id="${b._id}">
      <td style="word-wrap:break-word;overflow-wrap:break-word;">
        <div style="font-weight:600;font-size:1rem;">${clientName}${typeBadge} ${numClients > 1 ? `(${numClients} clients)` : ''}</div>
        ${genderBreakdown ? `<div style="margin-top:3px;">${genderBreakdown}</div>` : ''}
        <div style="font-size:0.85rem;color:#666;margin-top:4px;"> ${b.guestPhone || 'No phone'}</div>
        <div style="font-size:0.85rem;color:#666;">
           <span style="font-family:monospace;background:#f5f5f5;padding:2px 8px;border-radius:4px;font-size:0.75rem;">
            ${b.transactionNumber || 'N/A'}
          </span>
        </div>
      </td>
      <td style="white-space:nowrap;">${startTime}</td>
      <td style="white-space:nowrap;">${endTime}</td>
      <td style="word-wrap:break-word;overflow-wrap:break-word;font-size:0.9rem;">${serviceName}</td>
      <td style="word-wrap:break-word;overflow-wrap:break-word;">${therapistDisplay}</td>
      <td style="text-align:center;">${duration} mins</td>
      <td style="text-align:right;">₱${(b.price || 0).toLocaleString()}</td>
      <td>${(() => {
        const statusLabels = {
          pending:              { label: 'Pending',      cls: 'pending' },
          confirmed:            { label: 'Confirmed',    cls: 'confirmed' },
          completed:            { label: 'Completed',    cls: 'completed' },
          cancelled:            { label: 'Cancelled',    cls: 'cancelled' },
          pending_reschedule:   { label: 'Reschedule ⏳', cls: 'pending_reschedule' },
          pending_cancellation: { label: 'Cancel Req ⏳', cls: 'pending_cancellation' },
        };
        const s = statusLabels[b.status] || { label: b.status, cls: b.status };
        return `<span class="status-badge status-${s.cls}" style="font-size:0.75rem;padding:4px 6px;white-space:nowrap;">${s.label}</span>`;
      })()}</td>
      <td class="action-buttons">${actions || '-'}</td>
    </tr>
  `;
}

  async function showAvailableTherapists(bookingId, date, time, duration, serviceName) {
    try {
      const res = await fetch(`${apiBase}/bookings/check-availability`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          service: serviceName,
          date: date,
          time: time,
          durationMinutes: duration
        })
      });
      
      const data = await res.json();
      const available = data.available || [];
      
      if (available.length === 0) {
        alert(' No therapists available for this time slot.\n\nReasons could be:\n• All therapists are booked\n• No therapists have expertise in this service\n• No therapists are working at this time');
        return;
      }
      
      const modal = document.createElement('div');
      modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0,0,0,0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10001;
      `;
      
      modal.innerHTML = `
        <div style="background: white; padding: 30px; border-radius: 16px; max-width: 500px; width: 90%; max-height: 80vh; overflow-y: auto;">
          <h3 style="color: #4b2e1e; margin-bottom: 20px;"> Available Therapists (${available.length})</h3>
          <p style="color: #666; margin-bottom: 20px;">Select a therapist to assign to this booking:</p>
          <div style="max-height: 400px; overflow-y: auto;">
            ${available.map(t => `
              <button 
                onclick="assignTherapist('${bookingId}', '${t.id}')"
                style="width: 100%; padding: 16px; margin-bottom: 12px; background: #f5f1eb; border: 2px solid #e0e0e0; border-radius: 8px; cursor: pointer; text-align: left; font-size: 1rem; transition: 0.3s;"
                onmouseover="this.style.borderColor='#4b2e1e'; this.style.background='#fff';"
                onmouseout="this.style.borderColor='#e0e0e0'; this.style.background='#f5f1eb';"
              >
                <div style="display: flex; align-items: center; gap: 12px;">
                  <div style="width: 50px; height: 50px; background: #4b2e1e; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 1.5rem;">
                    
                  </div>
                  <div style="flex: 1;">
                    <div style="font-weight: 700; color: #4b2e1e; margin-bottom: 4px;">${t.name}</div>
                    <div style="color: #888; font-size: 0.85rem;">
                      ${t.expertise && t.expertise.length > 0 ? t.expertise.join(', ') : 'All services'}
                    </div>
                  </div>
                </div>
              </button>
            `).join('')}
          </div>
          <button 
            onclick="this.parentElement.parentElement.remove()"
            style="width: 100%; margin-top: 20px; padding: 12px; background: #6c757d; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;"
          >
            Cancel
          </button>
        </div>
      `;
      
      document.body.appendChild(modal);
    } catch (err) {
      console.error(err);
      alert('Failed to load available therapists');
    }
  }

  //Assign therapist in booking
  async function assignTherapist(bookingId, therapistId) {
    try {
      const res = await fetch(`${apiBase}/bookings/${bookingId}/reassign`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ therapistId })
      });
      
      if (res.ok) {
        showNotification(' Therapist assigned successfully!', 'success');
        
        document.querySelectorAll('[style*="z-index: 10001"]').forEach(el => el.remove());
        
        loadBookingsForDate(selectedDate);
      } else {
        const data = await res.json();
        alert(` ${data.msg || 'Failed to assign therapist'}`);
      }
    } catch (err) {
      console.error(err);
      alert('Failed to assign therapist');
    }
  }

  async function confirmBooking(bookingId) {
    if (!confirm('Confirm this booking?')) return;
    
    try {
      const res = await fetch(`${apiBase}/bookings/${bookingId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: 'confirmed' })
      });
      
      if (res.ok) {
    showNotification('Booking confirmed!', 'success');
    // Update the booking in local cache directly — no full reload needed
    const b = allBookings.find(x => x._id === bookingId);
    if (b) b.status = 'confirmed';
    loadBookingsForDate(selectedDate);
}
    } catch (err) {
      console.error(err);
      showNotification('Failed to confirm booking', 'error');
    }
  }

  function renderTherapistCell(booking) {
  const name = booking.therapist || booking.therapists?.[0]?.name || 'Any available';
  return `
    <td>
      <div style="font-weight:500">${name}</div>
      <button 
        class="btn-assign-therapist" 
        onclick="openAssignTherapist('${booking._id}', '${name}')"
        style="margin-top:5px; font-size:0.75rem; padding:3px 10px; background:#4b2e1e; color:#fff; border:none; border-radius:5px; cursor:pointer;">
         Assign Therapist
      </button>
    </td>
  `;
}

  async function cancelBooking(bookingId) {
    if (!confirm('Cancel this booking? This cannot be undone.')) return;
    
    try {
      const res = await fetch(`${apiBase}/bookings/${bookingId}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ status: 'cancelled' })
      });
      
      if (res.ok) {
    showNotification('Booking cancelled', 'success');
    const b = allBookings.find(x => x._id === bookingId);
    if (b) b.status = 'cancelled';
    loadBookingsForDate(selectedDate);
}
    } catch (err) {
      console.error(err);
      showNotification('Failed to cancel booking', 'error');
    }
  }


  // ─── CLOSURES (Holidays + Vacations) ─────────────────────────────────────────

async function loadClosures() {
  try {
    const res = await fetch(`${apiBase}/settings/closures`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      storeClosures = data.closures || [];
    }
  } catch (e) {
    console.error('Failed to load closures', e);
  }
}

async function saveClosures() {
  try {
    const res = await fetch(`${apiBase}/settings/closures`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ closures: storeClosures })
    });
    if (!res.ok) throw new Error('Save failed');
  } catch (e) {
    showNotification(' Failed to save closures', 'error');
    throw e;
  }
}

// Returns a Set of all YYYY-MM-DD strings covered by storeClosures
function getClosureDatesSet() {
  const set = new Set();
  storeClosures.forEach(c => {
    const cur = new Date(c.start + 'T00:00:00');
    const end = new Date(c.end   + 'T00:00:00');
    while (cur <= end) {
      set.add(cur.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }));
      cur.setDate(cur.getDate() + 1);
    }
  });
  return set;
}

function getClosureForDate(dateStr) {
  return storeClosures.find(c => dateStr >= c.start && dateStr <= c.end) || null;
}

function isSingleDayClosure(closure) {
  return closure && closure.start === closure.end;
}

// ─── CLOSURE PANEL ────────────────────────────────────────────────────────────

function renderClosurePanel() {
  let panel = document.getElementById('closurePanel');
  if (!panel) {
    const bookingsSection = document.getElementById('bookings-tab');
    if (!bookingsSection) return;
    panel = document.createElement('div');
    panel.id = 'closurePanel';
    const calendarSection = bookingsSection.querySelector('.calendar-section');
    if (calendarSection) {
      bookingsSection.insertBefore(panel, calendarSection);
    } else {
      bookingsSection.prepend(panel);
    }
  }

  // Sort closures by start date
  const sorted = [...storeClosures].sort((a, b) => a.start.localeCompare(b.start));
  const holidays  = sorted.filter(c => c.start === c.end);
  const vacations = sorted.filter(c => c.start !== c.end);

  panel.innerHTML = `
    <div style="
      background: white;
      border: 2px solid #e0e0e0;
      border-radius: 12px;
      padding: 22px 24px;
      margin-bottom: 20px;
    ">
      <!-- Header -->
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;">
        <h3 style="margin:0;color:#4b2e1e;display:flex;align-items:center;gap:8px;font-size:1.1rem;">
           Store Closures
          <span style="font-size:0.78rem;color:#888;font-weight:400;">
            (right-click a calendar day for single-day holidays)
          </span>
        </h3>
        <button
          onclick="openClosureModal()"
          style="padding:8px 18px;background:#4b2e1e;color:white;border:none;border-radius:8px;
            cursor:pointer;font-weight:600;font-size:0.9rem;">
          + Add Closure
        </button>
      </div>

      ${storeClosures.length === 0 ? `
        <p style="color:#999;font-style:italic;margin:0;font-size:0.9rem;">
          No closures set. Right-click any calendar day to mark it as a holiday,
          or click "+ Add Closure" for a multi-day range.
        </p>
      ` : `
        <div style="display:grid;gap:8px;">

          ${vacations.length > 0 ? `
            <div style="font-size:0.78rem;font-weight:700;color:#888;text-transform:uppercase;
              letter-spacing:0.06em;margin-bottom:2px;">️ Vacation / Multi-day Closures</div>
            ${vacations.map(c => renderClosureRow(c)).join('')}
            <div style="margin-bottom:4px;"></div>
          ` : ''}

          ${holidays.length > 0 ? `
            <div style="font-size:0.78rem;font-weight:700;color:#888;text-transform:uppercase;
              letter-spacing:0.06em;margin-bottom:2px;"> Single-day Holidays</div>
            ${holidays.map(c => renderClosureRow(c)).join('')}
          ` : ''}

        </div>
      `}
    </div>

    <!-- Add/Edit Closure Modal -->
    <div id="closureModal" style="display:none;position:fixed;inset:0;
      background:rgba(0,0,0,0.55);z-index:10000;align-items:center;justify-content:center;">
      <div style="background:white;padding:32px;border-radius:16px;width:440px;
        max-width:92vw;box-shadow:0 8px 32px rgba(0,0,0,0.25);">

        <h3 id="closureModalTitle" style="margin:0 0 22px 0;color:#4b2e1e;">Add Store Closure</h3>

        <label style="display:block;margin-bottom:16px;">
          <div style="font-size:0.88rem;font-weight:600;color:#555;margin-bottom:5px;">
            Label <span style="font-weight:400;color:#999;">(e.g. "Christmas Break", "Holiday")</span>
          </div>
          <input id="closureLabel" type="text" placeholder="Store Closed"
            style="width:100%;padding:10px 12px;border:2px solid #e0e0e0;border-radius:8px;
              font-size:1rem;box-sizing:border-box;outline:none;"
            onfocus="this.style.borderColor='#4b2e1e'"
            onblur="this.style.borderColor='#e0e0e0'">
        </label>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:8px;">
          <label>
            <div style="font-size:0.88rem;font-weight:600;color:#555;margin-bottom:5px;">Start Date</div>
            <input id="closureStart" type="date"
              style="width:100%;padding:10px;border:2px solid #e0e0e0;border-radius:8px;
                font-size:1rem;box-sizing:border-box;"
              onchange="syncClosureEndMin()">
          </label>
          <label>
            <div style="font-size:0.88rem;font-weight:600;color:#555;margin-bottom:5px;">
              End Date <span style="font-weight:400;color:#999;">(same = single day)</span>
            </div>
            <input id="closureEnd" type="date"
              style="width:100%;padding:10px;border:2px solid #e0e0e0;border-radius:8px;
                font-size:1rem;box-sizing:border-box;">
          </label>
        </div>

        <div id="closureDaysPreview"
          style="font-size:0.85rem;color:#ff9800;font-weight:600;min-height:20px;margin-bottom:16px;"></div>

        <div id="closureModalError"
          style="color:#dc3545;font-size:0.88rem;margin-bottom:14px;display:none;
            padding:8px 12px;background:#ffebee;border-radius:6px;"></div>

        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button onclick="closeClosureModal()"
            style="padding:10px 20px;background:#f5f5f5;color:#333;border:none;
              border-radius:8px;cursor:pointer;font-weight:600;">
            Cancel
          </button>
          <button onclick="confirmAddClosure()"
            style="padding:10px 24px;background:#4b2e1e;color:white;border:none;
              border-radius:8px;cursor:pointer;font-weight:600;">
            Save Closure
          </button>
        </div>
      </div>
    </div>

    <!-- Single-day Holiday Confirm Modal (right-click) -->
    <div id="holidayModal" style="display:none;position:fixed;inset:0;
      background:rgba(0,0,0,0.55);z-index:10000;align-items:center;justify-content:center;">
      <div style="background:white;padding:32px;border-radius:16px;width:380px;
        max-width:92vw;box-shadow:0 8px 32px rgba(0,0,0,0.25);text-align:center;">
        <div id="holidayModalIcon" style="font-size:3rem;margin-bottom:12px;"></div>
        <h3 id="holidayModalTitle" style="margin:0 0 10px 0;color:#4b2e1e;"></h3>
        <p id="holidayModalDate" style="font-weight:700;color:#666;margin-bottom:6px;"></p>
        <p id="holidayModalMsg" style="color:#888;font-size:0.9rem;margin-bottom:20px;"></p>
        <input id="holidayLabelInput" type="text" placeholder="Holiday name (optional)"
          style="width:100%;padding:10px;border:2px solid #e0e0e0;border-radius:8px;
            font-size:0.95rem;box-sizing:border-box;margin-bottom:18px;display:none;">
        <div style="display:flex;gap:10px;justify-content:center;">
          <button onclick="closeHolidayModal()"
            style="padding:10px 20px;background:#f5f5f5;color:#333;border:none;
              border-radius:8px;cursor:pointer;font-weight:600;">
            Cancel
          </button>
          <button id="holidayConfirmBtn" onclick="confirmHolidayToggle()"
            style="padding:10px 24px;background:#4b2e1e;color:white;border:none;
              border-radius:8px;cursor:pointer;font-weight:600;">
            Confirm
          </button>
        </div>
      </div>
    </div>
  `;

  // Live days preview when dates change
  ['closureStart', 'closureEnd'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', updateClosureDaysPreview);
  });
}

function renderClosureRow(c) {
  const isSingle  = c.start === c.end;
  const startFmt  = new Date(c.start + 'T00:00:00').toLocaleDateString('en-US',
    { weekday:'short', month:'short', day:'numeric', year:'numeric' });
  const endFmt    = isSingle ? null : new Date(c.end + 'T00:00:00').toLocaleDateString('en-US',
    { month:'short', day:'numeric', year:'numeric' });
  const days      = isSingle ? 1
    : Math.round((new Date(c.end) - new Date(c.start)) / 86400000) + 1;
  const color     = isSingle ? '#dc3545' : '#ff9800';
  const bg        = isSingle ? '#ffebee' : '#fff8f0';
  const border    = isSingle ? '#ef9a9a' : '#ffe0b2';

  return `
    <div style="display:flex;justify-content:space-between;align-items:center;
      padding:10px 14px;background:${bg};border:1px solid ${border};
      border-radius:8px;border-left:4px solid ${color};">
      <div>
        <div style="font-weight:700;color:#4b2e1e;font-size:0.95rem;">${c.label || 'Store Closed'}</div>
        <div style="color:#666;font-size:0.83rem;margin-top:2px;">
          ${isSingle
            ? ` ${startFmt}`
            : ` ${startFmt} → ${endFmt}
               <span style="color:${color};font-weight:600;margin-left:6px;">
                 ${days} days
               </span>`
          }
        </div>
      </div>
      <button onclick="deleteClosure('${c.id}')"
        style="padding:5px 12px;background:white;color:#c62828;
          border:1px solid #ef9a9a;border-radius:6px;cursor:pointer;
          font-weight:600;font-size:0.82rem;white-space:nowrap;">
         Remove
      </button>
    </div>
  `;
}

// ─── ADD CLOSURE MODAL ────────────────────────────────────────────────────────

let _closurePrefillDate = null;

function openClosureModal(prefillDate = null) {
  _closurePrefillDate = prefillDate;
  document.getElementById('closureModalTitle').textContent = 'Add Store Closure';
  document.getElementById('closureLabel').value  = '';
  document.getElementById('closureStart').value  = prefillDate || '';
  document.getElementById('closureEnd').value    = prefillDate || '';
  document.getElementById('closureModalError').style.display = 'none';
  document.getElementById('closureDaysPreview').textContent  = prefillDate
    ? '1 day selected' : '';
  document.getElementById('closureModal').style.display = 'flex';
}

function closeClosureModal() {
  document.getElementById('closureModal').style.display = 'none';
  _closurePrefillDate = null;
}

function syncClosureEndMin() {
  const start = document.getElementById('closureStart').value;
  const endEl = document.getElementById('closureEnd');
  endEl.min = start;
  if (endEl.value && endEl.value < start) endEl.value = start;
  updateClosureDaysPreview();
}

function updateClosureDaysPreview() {
  const start  = document.getElementById('closureStart').value;
  const end    = document.getElementById('closureEnd').value;
  const prevEl = document.getElementById('closureDaysPreview');
  if (!start || !end || end < start) { prevEl.textContent = ''; return; }
  const days = Math.round((new Date(end) - new Date(start)) / 86400000) + 1;
  prevEl.textContent = `${days} day${days !== 1 ? 's' : ''} will be blocked`;
}

async function confirmAddClosure() {
  const label  = document.getElementById('closureLabel').value.trim() || 'Store Closed';
  const start  = document.getElementById('closureStart').value;
  const end    = document.getElementById('closureEnd').value;
  const errEl  = document.getElementById('closureModalError');

  if (!start || !end) {
    errEl.textContent = 'Please select both a start and end date.';
    errEl.style.display = 'block'; return;
  }
  if (end < start) {
    errEl.textContent = 'End date must be on or after the start date.';
    errEl.style.display = 'block'; return;
  }

  errEl.style.display = 'none';

  storeClosures.push({ id: Date.now().toString(), label, start, end });

  try {
    await saveClosures();
    const days = Math.round((new Date(end) - new Date(start)) / 86400000) + 1;
    showNotification(
      ` "${label}" saved — ${days} day${days !== 1 ? 's' : ''} blocked`,
      'success'
    );
    closeClosureModal();
    renderClosurePanel();
    renderCalendar();
  } catch (e) { /* saveClosures already shows notification */ }
}

async function deleteClosure(id) {
  if (!confirm('Remove this closure? Clients will be able to book these dates again.')) return;
  storeClosures = storeClosures.filter(c => c.id !== id);
  try {
    await saveClosures();
    showNotification(' Closure removed', 'success');
    renderClosurePanel();
    renderCalendar();
  } catch (e) {}
}

// ─── SINGLE-DAY HOLIDAY (right-click) ────────────────────────────────────────

let _holidayTargetDate   = null;
let _holidayIsRemoving   = false;

function openHolidayModal(dateStr, isCurrentlyHoliday) {
  _holidayTargetDate = dateStr;
  _holidayIsRemoving = isCurrentlyHoliday;

  const d     = new Date(dateStr + 'T00:00:00');
  const label = d.toLocaleDateString('en-US',
    { weekday:'long', year:'numeric', month:'long', day:'numeric' });

  document.getElementById('holidayModalIcon').textContent  = isCurrentlyHoliday ? '' : '';
  document.getElementById('holidayModalTitle').textContent = isCurrentlyHoliday
    ? 'Remove Holiday?' : 'Mark as Holiday?';
  document.getElementById('holidayModalDate').textContent  = label;
  document.getElementById('holidayModalMsg').textContent   = isCurrentlyHoliday
    ? 'Clients will be able to book on this day again.'
    : 'Clients will NOT be able to book on this day.';

  const labelInput = document.getElementById('holidayLabelInput');
  labelInput.style.display = isCurrentlyHoliday ? 'none' : 'block';
  labelInput.value = '';

  document.getElementById('holidayConfirmBtn').textContent = isCurrentlyHoliday
    ? 'Remove Holiday' : 'Mark as Holiday';
  document.getElementById('holidayModal').style.display = 'flex';
}

function closeHolidayModal() {
  document.getElementById('holidayModal').style.display = 'none';
  _holidayTargetDate = null;
}

async function confirmHolidayToggle() {
  if (_holidayIsRemoving) {
    // Remove the single-day closure for this date
    storeClosures = storeClosures.filter(c =>
      !(c.start === _holidayTargetDate && c.end === _holidayTargetDate)
    );
    showNotification(' Holiday removed', 'success');
  } else {
    const labelVal = document.getElementById('holidayLabelInput').value.trim() || 'Store Holiday';
    storeClosures.push({
      id:    Date.now().toString(),
      label: labelVal,
      start: _holidayTargetDate,
      end:   _holidayTargetDate
    });
    showNotification(` "${labelVal}" marked as holiday`, 'success');
  }

  try {
    await saveClosures();
    closeHolidayModal();
    renderClosurePanel();
    renderCalendar();
  } catch (e) {}
}

// ─── ASSIGN THERAPIST ─────────────────────────────────────────────────────────
function openAssignTherapist(bookingId, currentTherapist) {
  assigningBookingId = bookingId;
  document.getElementById('assignCurrentTherapist').textContent = currentTherapist;
  document.getElementById('assignReason').value = '';

  const select = document.getElementById('assignTherapistSelect');
  select.innerHTML = '<option value="any">Any available therapist</option>';

  // allTherapists should already be loaded; fallback fetch if not
  const populate = (list) => {
    list.forEach(t => {
      const opt = document.createElement('option');
      opt.value       = t._id;
      opt.textContent = t.name;
      select.appendChild(opt);
    });
  };

  if (window.allTherapistsList && window.allTherapistsList.length) {
    populate(window.allTherapistsList);
  } else {
    fetch(`${apiBase}/therapists`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(list => { window.allTherapistsList = list; populate(list); });
  }

  document.getElementById('assignTherapistModal').style.display = 'flex';
}

function closeAssignTherapist() {
  document.getElementById('assignTherapistModal').style.display = 'none';
  assigningBookingId = null;
}

async function confirmAssignTherapist() {
  const select   = document.getElementById('assignTherapistSelect');
  const reason   = document.getElementById('assignReason').value.trim();
  const selected = select.options[select.selectedIndex];

  const body = selected.value === 'any'
    ? { therapist: 'Any available therapist', therapistId: null, assignNote: reason }
    : { therapist: selected.textContent, therapistId: selected.value, assignNote: reason };

  try {
    const res = await fetch(`${apiBase}/bookings/${assigningBookingId}/assign-therapist`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body:    JSON.stringify(body)
    });
    if (res.ok) {
      showNotification(' Therapist assigned successfully', 'success');
      closeAssignTherapist();
      if (selectedDate) loadBookingsForDate(selectedDate);
    } else {
      showNotification(' Failed to assign therapist', 'error');
    }
  } catch (e) {
    showNotification(' Server error', 'error');
  }
}

  document.getElementById('prevMonth').addEventListener('click', () => {
    currentMonth--;
    if (currentMonth < 0) {
      currentMonth = 11;
      currentYear--;
    }
    renderCalendar();
  });

  document.getElementById('nextMonth').addEventListener('click', () => {
    currentMonth++;
    if (currentMonth > 11) {
      currentMonth = 0;
      currentYear++;
    }
    renderCalendar();
  });

  // SERVICES MANAGEMENT
  let currentServiceId = null;

  const SERVICE_CATEGORIES = [
    'All',
    'Massage Services',
    'Spot Massage',
    'Body Scrub',
    'Facial Treatment',
    'Foot Treatment',
    'Packages',
    'Couples Packages',
  ];

  let activeServiceCategory = 'All';
  let allServicesCache = [];

  async function loadServices() {
    try {
      const res = await fetch(`${apiBase}/services`);
      allServicesCache = await res.json();
      renderServiceCategoryTabs();
      renderServiceList(allServicesCache);
    } catch (err) {
      console.error(err);
      showNotification('Failed to load services', 'error');
    }
  }

  function renderServiceCategoryTabs() {
    const servicesList = document.getElementById('servicesList');

    let tabBar = document.getElementById('serviceCategoryTabs');
    if (!tabBar) {
      tabBar = document.createElement('div');
      tabBar.id = 'serviceCategoryTabs';
      servicesList.parentElement.insertBefore(tabBar, servicesList);
    }

    // Count services per category (all, including hidden)
    const counts = { All: allServicesCache.length };
    allServicesCache.forEach(s => {
      const c = s.category || 'Uncategorised';
      counts[c] = (counts[c] || 0) + 1;
    });

    tabBar.style.cssText = `
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 20px;
    `;

    tabBar.innerHTML = SERVICE_CATEGORIES.map(cat => {
      const isActive = cat === activeServiceCategory;
      const n = counts[cat] || 0;
      const badge = (cat !== 'All' && n > 0)
        ? `<span style="
              background: ${isActive ? 'rgba(255,255,255,0.3)' : 'white'};
              color: ${isActive ? 'white' : '#4b2e1e'};
              border: 1px solid ${isActive ? 'rgba(255,255,255,0.5)' : '#c8a882'};
              border-radius: 10px;
              padding: 1px 7px;
              font-size: 0.78rem;
              margin-left: 4px;
            ">${n}</span>`
        : '';

      return `
        <button
          onclick="filterServicesByCategory('${cat}')"
          style="
            padding: 8px 16px;
            background: ${isActive ? '#4b2e1e' : 'white'};
            color: ${isActive ? 'white' : '#4b2e1e'};
            border: 2px solid #4b2e1e;
            border-radius: 20px;
            cursor: pointer;
            font-size: 0.88rem;
            font-weight: 600;
            transition: all 0.2s;
            display: inline-flex;
            align-items: center;
          "
          onmouseover="if('${cat}'!=='${activeServiceCategory}'){this.style.background='#f5f1eb'}"
          onmouseout="if('${cat}'!=='${activeServiceCategory}'){this.style.background='white'}"
        >${cat}${badge}</button>
      `;
    }).join('');
  }

  function filterServicesByCategory(cat) {
    activeServiceCategory = cat;
    renderServiceCategoryTabs();
    renderServiceList(allServicesCache);
  }

  function renderServiceList(services) {
    const servicesList = document.getElementById('servicesList');

    const filtered = activeServiceCategory === 'All'
      ? services
      : services.filter(s => (s.category || 'Uncategorised') === activeServiceCategory);

    if (filtered.length === 0) {
      servicesList.innerHTML = `
        <p style="text-align:center;color:#999;padding:40px;">
          No services in this category
        </p>`;
      return;
    }

    servicesList.innerHTML = filtered.map(s => {
      const pricing          = s.pricing || {};
      const price60          = pricing[60]  || pricing['60']  || s.price || 0;
      const price90          = pricing[90]  || pricing['90']  || s.price || 0;
      const price120         = pricing[120] || pricing['120'] || s.price || 0;
      const allowedDurations = s.allowedDurations || [60, 90, 120];
      const durationsText    = allowedDurations.length === 3
        ? 'All durations available'
        : `Available: ${allowedDurations.join(', ')} minutes only`;

      const isHidden = s.isActive === false;

      const hiddenBadge = isHidden
        ? `<span style="
              display:inline-block;padding:2px 10px;
              background:#f5f5f5;color:#999;
              border:1px solid #ddd;border-radius:12px;
              font-size:0.75rem;margin-left:8px;vertical-align:middle;
              font-weight:400;
            ">Hidden</span>`
        : '';

      const categoryBadge = s.category
        ? `<span style="
              display:inline-block;padding:3px 12px;
              background:#f5f1eb;color:#4b2e1e;
              border:1px solid #c8a882;border-radius:12px;
              font-size:0.8rem;margin-top:6px;font-weight:600;
            ">${s.category}</span>`
        : '';

      // ── Service image thumbnail (shown on card if image exists) ──────────────
      const imgThumb = s.image
        ? `<div class="svc-img-thumb" style="
              width:100px;min-width:100px;height:70px;
              border-radius:8px;overflow:hidden;
              border:1px solid #e0d5c8;flex-shrink:0;
            ">
            <img src="${s.image}" alt="${s.name}"
              style="width:100%;height:100%;object-fit:cover;" />
          </div>`
        : `<div class="svc-img-thumb" style="
              width:100px;min-width:100px;height:70px;
              border-radius:8px;border:1px dashed #c8a882;
              display:flex;align-items:center;justify-content:center;
              flex-shrink:0;background:#faf7f4;
            ">
            <span style="font-size:0.68rem;color:#b09070;text-align:center;line-height:1.3;padding:4px;">
              <br>No image
            </span>
          </div>`;

      return `
        <div class="service-card" style="${isHidden ? 'opacity:0.55;' : ''}display:flex;align-items:flex-start;gap:14px;">
          ${imgThumb}
          <div class="service-info" style="flex:1;min-width:0;">
            <h3 style="display:flex;align-items:center;flex-wrap:wrap;gap:4px;">
              ${s.name}${hiddenBadge}
            </h3>
            ${categoryBadge}
            <p style="margin-top:8px;">${s.description || 'No description'}</p>
            <div class="service-pricing">
              <span class="price-tag ${!allowedDurations.includes(60)  ? 'disabled' : ''}"
                style="${!allowedDurations.includes(60)  ? 'pointer-events:none;opacity:0.5;' : ''}">
                60 min: ₱${price60}
              </span>
              <span class="price-tag ${!allowedDurations.includes(90)  ? 'disabled' : ''}"
                style="${!allowedDurations.includes(90)  ? 'pointer-events:none;opacity:0.5;' : ''}">
                90 min: ₱${price90}
              </span>
              <span class="price-tag ${!allowedDurations.includes(120) ? 'disabled' : ''}"
                style="${!allowedDurations.includes(120) ? 'pointer-events:none;opacity:0.5;' : ''}">
                120 min: ₱${price120}
              </span>
            </div>
            <p style="color:#666;font-size:0.85rem;margin-top:8px;font-style:italic;">
              ℹ️ ${durationsText}
            </p>
          </div>
          <div class="service-actions">
            <button class="btn-edit" onclick="editService('${s._id}')">Edit</button>
            <button
              class="${isHidden ? 'btn-confirm' : 'btn-cancel-booking'}"
              onclick="toggleServiceVisibility('${s._id}', ${isHidden})"
              style="min-width:76px;"
            >${isHidden ? ' Show' : ' Hide'}</button>
          </div>
        </div>
      `;
    }).join('');
  }

  async function toggleServiceVisibility(serviceId, currentlyHidden) {
    if (!currentlyHidden) {
      if (!confirm('Hide this service? It will no longer appear on the booking page.')) return;
    }
    try {
      const res = await fetch(`${apiBase}/services/${serviceId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ isActive: currentlyHidden })   // hide→false, show→true
      });
      if (res.ok) {
        showNotification(
          currentlyHidden ? ' Service is now visible' : ' Service hidden from booking page',
          'success'
        );
        loadServices();
      } else {
        const data = await res.json();
        showNotification(data.msg || 'Failed to update service', 'error');
      }
    } catch (err) {
      console.error(err);
      showNotification('Failed to update service', 'error');
    }
  }

  document.getElementById('addServiceBtn').addEventListener('click', () => {
    currentServiceId = null;
    document.getElementById('serviceModalTitle').textContent = 'Add New Service';
    document.getElementById('serviceName').value = '';
    document.getElementById('serviceDesc').value = '';
    document.getElementById('price60').value = '';
    document.getElementById('price90').value = '';
    document.getElementById('price120').value = '';
    
    document.getElementById('duration60').checked = true;
    document.getElementById('duration90').checked = true;
    document.getElementById('duration120').checked = true;
    document.getElementById('serviceCategory').value = '';
    
    document.getElementById('editServiceModal').classList.add('active');
  });

  async function editService(serviceId) {
    try {
      const res = await fetch(`${apiBase}/services`);
      const services = await res.json();
      const service = services.find(s => s._id === serviceId);
      
      if (!service) return;
      
      currentServiceId = serviceId;
      document.getElementById('serviceModalTitle').textContent = 'Edit Service';
      document.getElementById('serviceName').value = service.name;
      document.getElementById('serviceDesc').value = service.description || '';
      
      const pricing = service.pricing || {};
      document.getElementById('price60').value = pricing[60] || pricing['60'] || service.price || '';
      document.getElementById('price90').value = pricing[90] || pricing['90'] || service.price || '';
      document.getElementById('price120').value = pricing[120] || pricing['120'] || service.price || '';
      document.getElementById('serviceCategory').value = service.category || '';
      
      const allowedDurations = service.allowedDurations || [60, 90, 120];
      document.getElementById('duration60').checked = allowedDurations.includes(60);
      document.getElementById('duration90').checked = allowedDurations.includes(90);
      document.getElementById('duration120').checked = allowedDurations.includes(120);
      
      document.getElementById('editServiceModal').classList.add('active');

      // ── Inject image upload panel into edit modal ──────────────────────────
      injectServiceImagePanel(serviceId, service.image || null);

    } catch (err) {
      console.error(err);
      showNotification('Failed to load service', 'error');
    }
  }

  // ── Service image upload panel (injected into the edit modal) ─────────────
  function injectServiceImagePanel(serviceId, currentImageUrl) {
    const modal = document.getElementById('editServiceModal');
    if (!modal) return;

    // Remove any previously injected panel
    modal.querySelector('#svc-img-panel')?.remove();

    const panel = document.createElement('div');
    panel.id = 'svc-img-panel';
    panel.style.cssText = `
      margin: 16px 0 0;
      padding: 16px;
      background: #faf7f4;
      border: 1px solid #e0d5c8;
      border-radius: 10px;
    `;

    const hasImg = !!currentImageUrl;
    panel.innerHTML = `
      <p style="font-weight:600;color:#4b2e1e;margin:0 0 10px;font-size:0.9rem;">
         Service Image
      </p>

      <!-- Preview -->
      <div id="svcImgPreviewWrap" style="margin-bottom:12px;${hasImg ? '' : 'display:none;'}">
        <img id="svcImgPreview"
          src="${currentImageUrl || ''}"
          alt="Service image"
          style="width:100%;max-height:180px;object-fit:cover;border-radius:8px;
                 border:1px solid #d0c0b0;display:block;" />
      </div>

      <!-- No-image placeholder -->
      <div id="svcImgPlaceholder"
        style="width:100%;height:100px;border-radius:8px;border:2px dashed #c8a882;
               display:${hasImg ? 'none' : 'flex'};
               align-items:center;justify-content:center;
               background:#fff;margin-bottom:12px;">
        <span style="color:#b09070;font-size:0.82rem;text-align:center;">
          No image uploaded yet<br>
          <span style="font-size:0.75rem;opacity:0.7;">Recommended: 800×500 px, JPG/PNG/WEBP</span>
        </span>
      </div>

      <!-- Buttons -->
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <label id="svcImgUploadBtn" style="
          display:inline-flex;align-items:center;gap:6px;
          padding:8px 16px;border-radius:6px;cursor:pointer;
          background:#c9a882;color:#fff;font-size:0.82rem;font-weight:600;
          transition:background 0.2s;
        " onmouseover="this.style.background='#a07850'"
           onmouseout="this.style.background='#c9a882'">
           ${hasImg ? 'Change Image' : 'Upload Image'}
          <input type="file" id="svcImgFileInput"
            accept="image/jpeg,image/png,image/webp"
            style="display:none;" />
        </label>

        <button id="svcImgRemoveBtn" type="button" style="
          display:${hasImg ? 'inline-flex' : 'none'};align-items:center;gap:6px;
          padding:8px 14px;border-radius:6px;cursor:pointer;
          background:#fff;color:#c0392b;border:1px solid #e0b0b0;
          font-size:0.82rem;font-weight:600;transition:background 0.2s;
        " onmouseover="this.style.background='#fff0f0'"
           onmouseout="this.style.background='#fff'">
           Remove
        </button>
      </div>

      <!-- Progress bar (hidden until upload) -->
      <div id="svcImgProgress" style="display:none;margin-top:10px;">
        <div style="height:4px;background:#e0d5c8;border-radius:2px;overflow:hidden;">
          <div id="svcImgProgressBar"
            style="height:100%;width:0%;background:linear-gradient(90deg,#c9a882,#8b4513);
                   transition:width 0.3s;border-radius:2px;"></div>
        </div>
        <p style="font-size:0.75rem;color:#888;margin:4px 0 0;">Uploading…</p>
      </div>

      <!-- Status message -->
      <p id="svcImgStatus" style="display:none;font-size:0.78rem;margin:8px 0 0;"></p>
    `;

    // Append inside the modal's content area (before the action buttons if they exist)
    const formEl = modal.querySelector('form') || modal.querySelector('.modal-body') || modal;
    formEl.appendChild(panel);

    // ── Wire up file input → upload ─────────────────────────────────────────
    const fileInput = panel.querySelector('#svcImgFileInput');
    fileInput.addEventListener('change', async () => {
      const file = fileInput.files[0];
      if (!file) return;

      // Client-side validation
      if (file.size > 5 * 1024 * 1024) {
        showImgStatus(' File too large. Max size is 5 MB.', 'error');
        return;
      }

      // Show progress bar
      const progressWrap = panel.querySelector('#svcImgProgress');
      const progressBar  = panel.querySelector('#svcImgProgressBar');
      progressWrap.style.display = 'block';
      progressBar.style.width    = '30%';

      try {
        const formData = new FormData();
        formData.append('image', file);

        progressBar.style.width = '60%';

        const res = await fetch(`${apiBase}/services/${serviceId}/image`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: formData,
        });

        progressBar.style.width = '100%';

        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.msg || 'Upload failed');
        }

        const data = await res.json();
        const newUrl = data.image;

        // Update preview
        panel.querySelector('#svcImgPreview').src = newUrl;
        panel.querySelector('#svcImgPreviewWrap').style.display = 'block';
        panel.querySelector('#svcImgPlaceholder').style.display = 'none';
        panel.querySelector('#svcImgRemoveBtn').style.display = 'inline-flex';
        panel.querySelector('#svcImgUploadBtn').querySelector('span') && 
          (panel.querySelector('#svcImgUploadBtn').childNodes[0].textContent = ' Change Image');

        showImgStatus(' Image uploaded successfully!', 'success');
        setTimeout(() => progressWrap.style.display = 'none', 1000);

        // Refresh the service list in background so thumbnail updates
        loadServices();

      } catch (err) {
        progressWrap.style.display = 'none';
        showImgStatus(` ${err.message}`, 'error');
      }

      fileInput.value = ''; // reset input
    });

    // ── Wire up remove button ────────────────────────────────────────────────
    panel.querySelector('#svcImgRemoveBtn').addEventListener('click', async () => {
      if (!confirm('Remove this image from the service?')) return;
      try {
        const res = await fetch(`${apiBase}/services/${serviceId}/image`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('Failed to remove image');

        panel.querySelector('#svcImgPreviewWrap').style.display = 'none';
        panel.querySelector('#svcImgPlaceholder').style.display = 'flex';
        panel.querySelector('#svcImgRemoveBtn').style.display = 'none';
        showImgStatus(' Image removed.', 'success');
        loadServices();
      } catch (err) {
        showImgStatus(` ${err.message}`, 'error');
      }
    });

    function showImgStatus(msg, type) {
      const el = panel.querySelector('#svcImgStatus');
      el.textContent = msg;
      el.style.color = type === 'error' ? '#c0392b' : '#27ae60';
      el.style.display = 'block';
      setTimeout(() => { el.style.display = 'none'; }, 5000);
    }
  }

  document.getElementById('serviceForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const allowedDurations = [];
    if (document.getElementById('duration60').checked) allowedDurations.push(60);
    if (document.getElementById('duration90').checked) allowedDurations.push(90);
    if (document.getElementById('duration120').checked) allowedDurations.push(120);
    
    if (allowedDurations.length === 0) {
      alert(' Please select at least one duration');
      return;
    }
    
    const serviceData = {
      name: document.getElementById('serviceName').value,
      description: document.getElementById('serviceDesc').value,
      category: document.getElementById('serviceCategory').value,
      durationMinutes: 60,
      price: parseInt(document.getElementById('price60').value),
      pricing: {
        60: parseInt(document.getElementById('price60').value),
        90: parseInt(document.getElementById('price90').value),
        120: parseInt(document.getElementById('price120').value)
      },
      allowedDurations
    };
    
    try {
      if (currentServiceId) {
        await fetch(`${apiBase}/services/${currentServiceId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(serviceData)
        });
        showNotification('Service updated!', 'success');
      } else {
        await fetch(`${apiBase}/services`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(serviceData)
        });
        showNotification('Service created!', 'success');
      }
      
      document.getElementById('editServiceModal').classList.remove('active');
      loadServices();
    } catch (err) {
      console.error(err);
      showNotification('Failed to save service', 'error');
    }
  });

  async function deleteService(serviceId) {
    if (!confirm('Delete this service? This cannot be undone.')) return;
    
    try {
      await fetch(`${apiBase}/services/${serviceId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      
      showNotification('Service deleted', 'success');
      loadServices();
    } catch (err) {
      console.error(err);
      showNotification('Failed to delete service', 'error');
    }
  }

  document.getElementById('closeServiceModal').addEventListener('click', () => {
    document.getElementById('editServiceModal').classList.remove('active');
  });

  // THERAPISTS MANAGEMENT
  let currentTherapistId = null;
  let allServices = [];

  // Load therapists with schedule button
  async function loadTherapists() {
    try {
      const res = await fetch(`${apiBase}/therapists`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const allTherapists = await res.json();

      // Get archived IDs from localStorage to exclude them from active list
      const archives   = JSON.parse(localStorage.getItem('nagomi_archivedTherapists') || '[]');
      const archivedIds = new Set(archives.map(a => a.id));

      // Only show active, non-archived therapists
      const therapists = allTherapists.filter(t => t.isActive !== false && !archivedIds.has(t._id));

      const therapistsList = document.getElementById('therapistsList');
      // therapistsList may be null if the separate management section was removed
      if (!therapistsList) return;

      if (therapists.length === 0) {
        therapistsList.innerHTML = '<p style="text-align: center; color: #999; padding: 40px;">No active therapists</p>';
        return;
      }
      
      therapistsList.innerHTML = therapists.map(t => {
        // Display expertise
        const expertiseText = t.expertise && t.expertise.length > 0 
          ? t.expertise.join(', ') 
          : 'All services';
        
        return `
          <div class="therapist-card">
            <div class="therapist-avatar"></div>
            <h3>${t.name}</h3>
            <p>${t.email}</p>
            <p style="margin-top:6px;">
              <span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:0.78rem;font-weight:700;
                background:${t.gender === 'male' ? '#dbeafe' : '#fce7f3'};
                color:${t.gender === 'male' ? '#1d4ed8' : '#be185d'};">
                ${t.gender === 'male' ? ' Male' : ' Female'}
              </span>
            </p>
            <p style="color: ${t.isActive ? '#28a745' : '#dc3545'}; font-weight: 600; margin-top: 8px;">
              ${t.isActive ? '● Active' : '● Inactive'}
            </p>
            <p style="color: #666; font-size: 0.85rem; margin-top: 8px;">
              <strong>Expertise:</strong> ${expertiseText}
            </p>
            <div class="service-actions" style="justify-content: center; margin-top: 16px; flex-direction: column; gap: 10px;">
              <button class="btn-schedule" onclick="openScheduleModal('${t._id}')">
                 Manage Schedule
              </button>
              <div style="display: flex; gap: 8px;">
                <button class="btn-edit" onclick="editTherapist('${t._id}')">Edit</button>
                <button class="btn-archive" onclick="archiveTherapist('${t._id}', '${t.name}')">️ Archive</button>
              </div>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      console.error(err);
      showNotification('Failed to load therapists', 'error');
    }
  }

  // Open schedule management modal
  async function openScheduleModal(therapistId) {
    currentTherapistId = therapistId;
    
    try {
      // Load therapist details
      const tRes = await fetch(`${apiBase}/therapists/${therapistId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const therapist = await tRes.json();
      
      // Load services for expertise
      const sRes = await fetch(`${apiBase}/services`);
      allServices = await sRes.json();
      
      // Populate modal
      document.getElementById('therapist-name-display').textContent = therapist.name;
      document.getElementById('therapist-email-display').textContent = therapist.email;
      
      // Render weekly schedule
      renderWeeklySchedule(therapist.weeklySchedule || []);
      
      // Render expertise
      renderExpertise(therapist.expertise || []);
      
      // Render date overrides
      renderDateOverrides(therapist.dateOverrides || []);
      
      // Show modal
      document.getElementById('scheduleModal').classList.add('active');
      
    } catch (err) {
      console.error(err);
      showNotification('Failed to load therapist details', 'error');
    }

    // Add after you populate the modal content in openScheduleModal()
  setTimeout(() => {
    const tabs = document.querySelectorAll('.schedule-tab');
    console.log(' Schedule tabs found:', tabs.length);
    
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;
        console.log(' Switching to tab:', targetTab);
        
        // Remove active from all tabs
        document.querySelectorAll('.schedule-tab').forEach(t => t.classList.remove('active'));
        
        // Remove active from all content
        document.querySelectorAll('.schedule-tab-content').forEach(c => c.classList.remove('active'));
        
        // Add active to clicked tab
        tab.classList.add('active');
        
        // Add active to target content (with null check)
        const targetContent = document.getElementById(`${targetTab}-tab`);
        if (targetContent) {
          targetContent.classList.add('active');
        } else {
          console.error(' Tab content not found:', `${targetTab}-tab`);
        }
      });
    });
  }, 100);
  }



  function closeScheduleModal() {
    document.getElementById('scheduleModal').classList.remove('active');
    currentTherapistId = null;
  }

  // Render Weekly Schedule with proper breaks
  function renderWeeklySchedule(weeklySchedule) {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const editor = document.getElementById('weekly-schedule-editor');
    
    editor.innerHTML = days.map(day => {
      const daySchedule = weeklySchedule.find(s => s.dayOfWeek === day) || {
        dayOfWeek: day,
        isWorking: true,
        shifts: [{ startTime: '09:00 AM', endTime: '05:00 PM' }],
        breaks: []
      };
      
      // Render breaks properly
      const breaksHTML = (daySchedule.breaks && daySchedule.breaks.length > 0) 
        ? daySchedule.breaks.map((brk, idx) => `
            <div class="break-row" data-break-index="${idx}">
              <input type="text" value="${brk.label || 'Break'}" class="break-label" placeholder="e.g., Lunch">
              <input type="time" value="${convertTo24HourInput(brk.startTime)}" class="break-start">
              <span>to</span>
              <input type="time" value="${convertTo24HourInput(brk.endTime)}" class="break-end">
              <button class="btn-remove-break" onclick="removeBreak('${day}', ${idx})" type="button">×</button>
            </div>
          `).join('')
        : '<p style="color: #999; font-size: 0.85rem; margin: 8px 0;">No breaks set</p>';
      
      return `
        <div class="day-schedule" data-day="${day}">
          <div class="day-schedule-header">
            <span class="day-name">${day}</span>
            <div class="working-toggle">
              <input type="checkbox" id="working-${day}" ${daySchedule.isWorking ? 'checked' : ''} 
                onchange="toggleDayWorking('${day}')">
              <label for="working-${day}">Working</label>
            </div>
          </div>
          
          <div class="shifts-container" id="shifts-${day}" style="display: ${daySchedule.isWorking ? 'flex' : 'none'}; flex-direction: column; gap: 10px;">
            <h5 style="width: 100%; margin: 10px 0 8px 0 !important; color: #4b2e1e; font-size: 1rem !important; font-weight: 600; padding-bottom: 5px; border-bottom: 1px solid #e0e0e0;">
               Working Hours
            </h5>
            ${daySchedule.shifts.map((shift, idx) => `
              <div class="shift-row" data-shift-index="${idx}">
                <input type="time" value="${convertTo24HourInput(shift.startTime)}" class="shift-start">
                <span>to</span>
                <input type="time" value="${convertTo24HourInput(shift.endTime)}" class="shift-end">
                <button class="btn-remove-shift" onclick="removeShift('${day}', ${idx})" type="button">×</button>
              </div>
            `).join('')}
            <button class="btn-add-shift" onclick="addShift('${day}')" type="button">+ Add Shift</button>
            
            <h5 style="width: 100%; margin: 20px 0 8px 0 !important; color: #ff9800; font-size: 1rem !important; font-weight: 700; padding: 8px 12px; background: #fff3e0; border-radius: 6px; border-left: 4px solid #ff9800;">
              ⏰ Break Times
            </h5>
            <div class="breaks-container" id="breaks-${day}">
              ${breaksHTML}
            </div>
            <button class="btn-add-break" onclick="addBreak('${day}')" type="button">⏰ Add Break</button>
          </div>
        </div>
      `;
    }).join('');
  }

  // ─── Format endTime regardless of whether it's an ISO string or plain "H:MM AM/PM" ───
  function formatEndTime(raw) {
    if (!raw) return '—';
    // ISO datetime string e.g. "2026-03-31T13:00:00.000Z"
    // The backend stored Manila local time as UTC digits, so read HH:MM directly from the T part
    if (raw.includes('T')) {
      const timePart = raw.split('T')[1]?.substring(0, 5); // "13:00"
      if (timePart) {
        let [h, m] = timePart.split(':').map(Number);
        const per = h >= 12 ? 'PM' : 'AM';
        const h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
        return `${h12}:${String(m).padStart(2, '0')} ${per}`;
      }
    }
    // Already a plain time string like "1:00 PM"
    return raw;
  }

  function convertTo24HourInput(timeStr) {
    if (!timeStr) return '09:00';
    
    // If already in 24-hour format (HH:MM)
    if (!timeStr.includes('AM') && !timeStr.includes('PM')) {
      return timeStr;
    }
    
    const [time, period] = timeStr.split(' ');
    let [hours, minutes] = time.split(':').map(Number);
    
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  }

  // Helper function to convert "09:00" to "9:00 AM"
  function convertTo12Hour(time24) {
    let [hours, minutes] = time24.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    
    if (hours > 12) hours -= 12;
    if (hours === 0) hours = 12;
    
    return `${hours}:${minutes.toString().padStart(2, '0')} ${period}`;
  }


  // FIXED: Add Break function
  function addBreak(day) {
    const breaksContainer = document.getElementById(`breaks-${day}`);
    
    // Remove "no breaks" message if it exists
    const noBreaksMsg = breaksContainer.querySelector('p');
    if (noBreaksMsg) noBreaksMsg.remove();
    
    const breakRows = breaksContainer.querySelectorAll('.break-row');
    const newIndex = breakRows.length;
    
    const newBreak = document.createElement('div');
    newBreak.className = 'break-row';
    newBreak.dataset.breakIndex = newIndex;
    newBreak.innerHTML = `
      <input type="text" value="Break ${newIndex + 1}" class="break-label" placeholder="e.g., Lunch">
      <input type="time" value="12:00" class="break-start">
      <span>to</span>
      <input type="time" value="13:00" class="break-end">
      <button class="btn-remove-break" onclick="removeBreak('${day}', ${newIndex})" type="button">×</button>
    `;
    
    breaksContainer.appendChild(newBreak);
  }

  // NEW: Remove Break
  function removeBreak(day, index) {
    const breaksContainer = document.getElementById(`breaks-${day}`);
    const breakRows = breaksContainer.querySelectorAll('.break-row');
    
    breakRows[index].remove();
    
    // Re-index remaining breaks
    const remainingBreaks = breaksContainer.querySelectorAll('.break-row');
    remainingBreaks.forEach((row, idx) => {
      row.dataset.breakIndex = idx;
      const removeBtn = row.querySelector('.btn-remove-break');
      removeBtn.onclick = () => removeBreak(day, idx);
    });
    
    // Show "no breaks" message if empty
    if (remainingBreaks.length === 0) {
      breaksContainer.innerHTML = '<p style="color: #999; font-size: 0.85rem; margin: 8px 0;">No breaks set</p>';
    }
  }

  // Toggle Day Working
  function toggleDayWorking(day) {
    const checkbox = document.getElementById(`working-${day}`);
    const shiftsContainer = document.getElementById(`shifts-${day}`);
    shiftsContainer.style.display = checkbox.checked ? 'flex' : 'none';
  }

  // Add Shift
  function addShift(day) {
    const shiftsContainer = document.getElementById(`shifts-${day}`);
    const shiftRows = shiftsContainer.querySelectorAll('.shift-row');
    const newIndex = shiftRows.length;
    
    const newShift = document.createElement('div');
    newShift.className = 'shift-row';
    newShift.dataset.shiftIndex = newIndex;
    newShift.innerHTML = `
      <input type="time" value="09:00" class="shift-start">
      <span>to</span>
      <input type="time" value="17:00" class="shift-end">
      <button class="btn-remove-shift" onclick="removeShift('${day}', ${newIndex})">×</button>
    `;
    
    shiftsContainer.insertBefore(newShift, shiftsContainer.lastElementChild);
  }

  // Remove Shift
  function removeShift(day, index) {
    const shiftsContainer = document.getElementById(`shifts-${day}`);
    const shiftRows = shiftsContainer.querySelectorAll('.shift-row');
    
    if (shiftRows.length <= 1) {
      alert('Must have at least one shift when working');
      return;
    }
    
    shiftRows[index].remove();
    
    // Re-index remaining shifts
    const remainingShifts = shiftsContainer.querySelectorAll('.shift-row');
    remainingShifts.forEach((row, idx) => {
      row.dataset.shiftIndex = idx;
      const removeBtn = row.querySelector('.btn-remove-shift');
      removeBtn.onclick = () => removeShift(day, idx);
    });
  }

  // Render Expertise Selector
  function renderExpertise(selectedExpertise) {
    const selector = document.getElementById('expertise-selector');
    
    selector.innerHTML = `
      <div class="expertise-grid">
        ${allServices.map(service => `
          <div class="expertise-item ${selectedExpertise.includes(service.name) ? 'selected' : ''}">
            <input type="checkbox" id="exp-${service._id}" 
              value="${service.name}" 
              ${selectedExpertise.includes(service.name) ? 'checked' : ''}
              onchange="this.parentElement.classList.toggle('selected', this.checked)">
            <label for="exp-${service._id}">${service.name}</label>
          </div>
        `).join('')}
      </div>
    `;
  }

  // Render Date Overrides (Vacation/Leave)
  function renderDateOverrides(overrides) {
    const list = document.getElementById('overrides-list');
    
    if (overrides.length === 0) {
      list.innerHTML = '<p style="color: #999; text-align: center; padding: 20px;">No date overrides set</p>';
      return;
    }
    
    const now = new Date();
    
    list.innerHTML = overrides.map((override, index) => {
      const overrideDate = new Date(override.date);
      const isPast = overrideDate < now;
      
      return `
        <div class="override-item ${override.isWorking ? 'working' : ''} ${isPast ? 'past' : ''}">
          <div class="override-details">
            <h5>${overrideDate.toLocaleDateString('en-US', { 
              weekday: 'long', 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
            })}</h5>
            <p><strong>Status:</strong> ${override.isWorking ? ' Working (Custom Hours)' : ' Not Working'}</p>
            ${override.reason ? `<p><strong>Reason:</strong> ${override.reason}</p>` : ''}
            ${override.shifts && override.shifts.length > 0 ? 
              `<p><strong>Hours:</strong> ${override.shifts.map(s => `${s.startTime} - ${s.endTime}`).join(', ')}</p>` 
              : ''}
          </div>
          <div class="override-actions">
            <button class="btn-delete" onclick="removeOverride('${override.date}')">Delete</button>
          </div>
        </div>
      `;
    }).join('');
  }

  // Add Date Override
  async function addDateOverride() {
    const date = document.getElementById('override-date').value;
    const reason = document.getElementById('override-reason').value;
    const isWorking = document.getElementById('override-status').value === 'true';
    
    if (!date) {
      alert('Please select a date');
      return;
    }
    
    const overrideData = {
      date,
      isWorking,
      reason,
      shifts: []
    };
    
    if (isWorking) {
      const start = document.getElementById('override-start').value;
      const end = document.getElementById('override-end').value;
      
      if (!start || !end) {
        alert('Please set custom working hours');
        return;
      }
      
      overrideData.shifts = [{ startTime: start, endTime: end }];
    }
    
    try {
      const res = await fetch(`${apiBase}/therapists/${currentTherapistId}/date-override`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(overrideData)
      });
      
      if (res.ok) {
        showNotification('Date override added!', 'success');
        
        // Reload overrides
        const tRes = await fetch(`${apiBase}/therapists/${currentTherapistId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const therapist = await tRes.json();
        renderDateOverrides(therapist.dateOverrides || []);
        
        // Reset form
        document.getElementById('override-date').value = '';
        document.getElementById('override-start').value = '';
        document.getElementById('override-end').value = '';
      } else {
        const data = await res.json();
        alert(data.msg || 'Failed to add override');
      }
    } catch (err) {
      console.error(err);
      alert('Failed to add date override');
    }
  }

  // Remove Date Override
  async function removeOverride(date) {
    if (!confirm('Remove this date override?')) return;
    
    try {
      const res = await fetch(`${apiBase}/therapists/${currentTherapistId}/date-override/${date}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (res.ok) {
        showNotification('Override removed', 'success');
        
        // Reload overrides
        const tRes = await fetch(`${apiBase}/therapists/${currentTherapistId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const therapist = await tRes.json();
        renderDateOverrides(therapist.dateOverrides || []);
      }
    } catch (err) {
      console.error(err);
      alert('Failed to remove override');
    }
  }

  // Save All Schedule Changes (including breaks)
  async function saveTherapistSchedule() {
    try {
      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      const weeklySchedule = [];
      
      days.forEach(day => {
        const isWorking = document.getElementById(`working-${day}`).checked;
        const shiftsContainer = document.getElementById(`shifts-${day}`);
        const shiftRows = shiftsContainer.querySelectorAll('.shift-row');
        
        const shifts = Array.from(shiftRows).map(row => ({
          startTime: convertTo12Hour(row.querySelector('.shift-start').value),
          endTime: convertTo12Hour(row.querySelector('.shift-end').value)
        }));
        
        // Get breaks
        const breaksContainer = document.getElementById(`breaks-${day}`);
        const breakRows = breaksContainer.querySelectorAll('.break-row');
        const breaks = Array.from(breakRows).map(row => ({
          label: row.querySelector('.break-label').value,
          startTime: convertTo12Hour(row.querySelector('.break-start').value),
          endTime: convertTo12Hour(row.querySelector('.break-end').value)
        }));
        
        weeklySchedule.push({
          dayOfWeek: day,
          isWorking,
          shifts: isWorking ? shifts : [],
          breaks: isWorking ? breaks : [] //Include breaks
        });
      });
      
      await fetch(`${apiBase}/therapists/${currentTherapistId}/schedule`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ weeklySchedule })
      });
      
      // Save expertise
      const expertiseCheckboxes = document.querySelectorAll('#expertise-selector input[type="checkbox"]:checked');
      const expertise = Array.from(expertiseCheckboxes).map(cb => cb.value);
      
      await fetch(`${apiBase}/therapists/${currentTherapistId}/expertise`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ expertise })
      });
      
      showNotification(' Schedule updated successfully!', 'success');
      closeScheduleModal();
      loadTherapists();
      
    } catch (err) {
      console.error(err);
      showNotification('Failed to save schedule', 'error');
    }
  }

  // Schedule Tab Switching
  document.querySelectorAll('.schedule-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const targetTab = tab.dataset.tab;
      
      // Update active tab
      document.querySelectorAll('.schedule-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      
      // Update active content
      document.querySelectorAll('.schedule-tab-content').forEach(c => c.classList.remove('active'));
      document.getElementById(`${targetTab}-tab`).classList.add('active');
    });
  });
  
  // Override status toggle
  const overrideStatus = document.getElementById('override-status');
  const overrideShifts = document.getElementById('override-shifts');
  
  if (overrideStatus) {
    overrideStatus.addEventListener('change', () => {
      overrideShifts.style.display = overrideStatus.value === 'true' ? 'block' : 'none';
    });
  }

  // ADD THERAPIST
  document.getElementById('addTherapistBtn').addEventListener('click', () => {
    currentTherapistId = null;
    document.getElementById('therapistModalTitle').textContent = 'Add New Therapist';
    document.getElementById('therapistName').value = '';
    document.getElementById('therapistEmail').value = '';
    // Safely set gender — element may not exist in all HTML versions
    const genderFemaleEl = document.getElementById('genderFemale');
    if (genderFemaleEl) genderFemaleEl.checked = true;
    // Also try by name selector as fallback
    const genderRadio = document.querySelector('input[name="therapistGender"][value="female"]');
    if (genderRadio) genderRadio.checked = true;
    document.getElementById('editTherapistModal').classList.add('active');
  });

  // EDIT THERAPIST
  async function editTherapist(therapistId) {
    try {
      const res = await fetch(`${apiBase}/therapists/${therapistId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const therapist = await res.json();
      
      if (!therapist) return;
      
      currentTherapistId = therapistId;
      document.getElementById('therapistModalTitle').textContent = 'Edit Therapist';
      document.getElementById('therapistName').value = therapist.name;
      document.getElementById('therapistEmail').value = therapist.email;
      const gender = therapist.gender || 'female';
      const genderEl = document.getElementById(gender === 'male' ? 'genderMale' : 'genderFemale');
      if (genderEl) genderEl.checked = true;
      // Also try by name selector as fallback
      const genderRadioEl = document.querySelector(`input[name="therapistGender"][value="${gender}"]`);
      if (genderRadioEl) genderRadioEl.checked = true;
      document.getElementById('editTherapistModal').classList.add('active');
    } catch (err) {
      console.error(err);
      showNotification('Failed to load therapist', 'error');
    }
  }

  // SAVE THERAPIST
  document.getElementById('therapistForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const therapistData = {
      name:     document.getElementById('therapistName').value,
      email:    document.getElementById('therapistEmail').value,
      gender:   document.querySelector('input[name="therapistGender"]:checked')?.value || 'female',
      role:     'therapist',
      isActive: true
    };
    
    try {
      if (currentTherapistId) {
        // Update existing
        await fetch(`${apiBase}/auth/users/${currentTherapistId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify(therapistData)
        });
        showNotification('Therapist updated!', 'success');
      } else {
        // Create new
        therapistData.password = 'therapist123'; // Default password
        await fetch(`${apiBase}/auth/register`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(therapistData)
        });
        showNotification('Therapist created! Default password: therapist123', 'success');
      }
      
      document.getElementById('editTherapistModal').classList.remove('active');
      loadTherapists();
    } catch (err) {
      console.error(err);
      showNotification('Failed to save therapist', 'error');
    }
  });

  // DELETE THERAPIST
  // ── ARCHIVE THERAPIST ──────────────────────────────────────────────────────
  let _archivePendingId   = null;
  let _archivePendingName = null;

  function archiveTherapist(therapistId, therapistName) {
    _archivePendingId   = therapistId;
    _archivePendingName = therapistName;
    document.getElementById('archiveTherapistName').textContent = therapistName;
    document.getElementById('archiveReason').value = '';
    document.getElementById('archiveTherapistModal').classList.add('active');
  }

  async function confirmArchiveTherapist() {
    const reason = document.getElementById('archiveReason').value.trim();
    if (!reason) {
      showNotification('Please enter a reason for archiving.', 'error');
      return;
    }

    try {
      // 1. Fetch therapist details
      const tRes = await fetch(`${apiBase}/therapists/${_archivePendingId}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const therapist = await tRes.json();

      // 2. Fetch ALL bookings to compute lifetime stats
      const bRes = await fetch(`${apiBase}/bookings`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const allBookings = await bRes.json();

      const myBookings = allBookings.filter(b =>
        b.therapist && (b.therapist._id || b.therapist) === _archivePendingId
      );
      const completed  = myBookings.filter(b => b.status === 'completed');
      const cancelled  = myBookings.filter(b => b.status === 'cancelled');
      const totalRev   = completed.reduce((s, b) => s + (b.price || 0), 0);
      const commission = Math.round(totalRev * (commissionSettings.rate / 100));
      const successRate = myBookings.length
        ? Math.round((completed.length / myBookings.length) * 100) : 0;

      // 3. Save archive record to localStorage
      const archives = JSON.parse(localStorage.getItem('nagomi_archivedTherapists') || '[]');
      archives.push({
        id:            _archivePendingId,
        name:          therapist.name  || _archivePendingName,
        email:         therapist.email || '',
        phone:         therapist.phone || '',
        expertise:     therapist.expertise || [],
        archiveReason: reason,
        archiveDate:   new Date().toISOString(),
        stats: {
          totalBookings:     myBookings.length,
          completedServices: completed.length,
          cancelledBookings: cancelled.length,
          totalRevenue:      totalRev,
          commissionEarned:  commission,
          successRate
        }
      });
      localStorage.setItem('nagomi_archivedTherapists', JSON.stringify(archives));

      // 4. Mark therapist inactive in DB (keeps booking records intact)
      await fetch(`${apiBase}/auth/users/${_archivePendingId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ isActive: false, name: therapist.name, email: therapist.email, phone: therapist.phone, role: 'therapist' })
      });

      document.getElementById('archiveTherapistModal').classList.remove('active');
      showNotification(`${_archivePendingName} has been archived.`, 'success');
      loadTherapists();

    } catch (err) {
      console.error(err);
      showNotification('Failed to archive therapist', 'error');
    }
  }

  function closeArchiveModal() {
    document.getElementById('archiveTherapistModal').classList.remove('active');
  }

  // ── VIEW ARCHIVED THERAPISTS ────────────────────────────────────────────────
  function openArchivedTherapists() {
    const archives = JSON.parse(localStorage.getItem('nagomi_archivedTherapists') || '[]');
    const container = document.getElementById('archivedTherapistsList');

    if (archives.length === 0) {
      container.innerHTML = `
        <div style="text-align:center; padding:60px; color:#999;">
          <div style="font-size:3rem; margin-bottom:12px;">️</div>
          <p style="font-size:1.1rem;">No archived therapists yet.</p>
        </div>`;
    } else {
      container.innerHTML = archives.slice().reverse().map((t, idx) => {
        const realIdx = archives.length - 1 - idx;
        const archiveDate = new Date(t.archiveDate).toLocaleDateString('en-PH', {
          year: 'numeric', month: 'long', day: 'numeric'
        });
        const expertise = t.expertise && t.expertise.length ? t.expertise.join(', ') : 'All services';
        return `
          <div class="archived-therapist-card">
            <div class="archived-card-header">
              <div class="archived-avatar"></div>
              <div>
                <h3>${t.name}</h3>
                <p style="color:#666; font-size:0.88rem;">${t.email} ${t.phone ? '· ' + t.phone : ''}</p>
                <p style="color:#666; font-size:0.82rem; margin-top:4px;">
                  <strong>Expertise:</strong> ${expertise}
                </p>
              </div>
              <button class="btn-delete" style="margin-left:auto; align-self:flex-start; font-size:0.8rem; padding:4px 10px;"
                onclick="permanentlyDeleteArchive(${realIdx})">️ Remove</button>
              <button class="btn-schedule" style="align-self:flex-start; font-size:0.8rem; padding:4px 10px; margin-left:6px;"
                onclick="unarchiveTherapist(${realIdx})">️ Unarchive</button>
            </div>
            <div class="archived-reason-box">
              <strong> Reason for Archive:</strong> ${t.archiveReason}
            </div>
            <p style="color:#888; font-size:0.82rem; margin:8px 0 16px;">Archived on ${archiveDate}</p>
            <div class="archived-stats-grid">
              <div class="archived-stat">
                <span class="archived-stat-value">${t.stats.totalBookings}</span>
                <span class="archived-stat-label">Total Bookings</span>
              </div>
              <div class="archived-stat">
                <span class="archived-stat-value" style="color:#28a745">${t.stats.completedServices}</span>
                <span class="archived-stat-label">Completed</span>
              </div>
              <div class="archived-stat">
                <span class="archived-stat-value" style="color:#dc3545">${t.stats.cancelledBookings}</span>
                <span class="archived-stat-label">Cancelled</span>
              </div>
              <div class="archived-stat">
                <span class="archived-stat-value">₱${t.stats.totalRevenue.toLocaleString()}</span>
                <span class="archived-stat-label">Revenue Generated</span>
              </div>
              <div class="archived-stat">
                <span class="archived-stat-value" style="color:#c9a882">₱${t.stats.commissionEarned.toLocaleString()}</span>
                <span class="archived-stat-label">Commission Earned</span>
              </div>
              <div class="archived-stat">
                <span class="archived-stat-value" style="color:${t.stats.successRate >= 80 ? '#28a745' : t.stats.successRate >= 60 ? '#ffc107' : '#dc3545'}">
                  ${t.stats.successRate}%
                </span>
                <span class="archived-stat-label">Success Rate</span>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    document.getElementById('archivedTherapistsModal').classList.add('active');
  }

  function closeArchivedTherapists() {
    document.getElementById('archivedTherapistsModal').classList.remove('active');
  }

  function permanentlyDeleteArchive(index) {
    if (!confirm('Permanently remove this archive record? This cannot be undone.')) return;
    const archives = JSON.parse(localStorage.getItem('nagomi_archivedTherapists') || '[]');
    archives.splice(index, 1);
    localStorage.setItem('nagomi_archivedTherapists', JSON.stringify(archives));
    openArchivedTherapists(); // re-render
  }

  async function unarchiveTherapist(index) {
    const archives = JSON.parse(localStorage.getItem('nagomi_archivedTherapists') || '[]');
    const t = archives[index];
    if (!t) return;

    if (!confirm(`Unarchive ${t.name}? They will be restored as an active therapist.`)) return;

    try {
      // Restore isActive = true in DB
      const res = await fetch(`${apiBase}/auth/users/${t.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          isActive: true,
          name:  t.name,
          email: t.email,
          phone: t.phone,
          role:  'therapist'
        })
      });

      if (!res.ok) throw new Error('API call failed');

      // Remove from localStorage archived list
      archives.splice(index, 1);
      localStorage.setItem('nagomi_archivedTherapists', JSON.stringify(archives));

      // Show success BEFORE refresh calls
      showNotification(`${t.name} has been unarchived and is now active again.`, 'success');

    } catch (err) {
      console.error(err);
      showNotification('Failed to unarchive therapist', 'error');
      return; // stop here if API failed
    }

    // Refresh panels separately — errors here won't trigger failure notif
    try { openArchivedTherapists(); } catch(e) {}
    try { await loadTherapists(); } catch(e) {}
    try { tabLastLoaded['therapists'] = null; } catch(e) {}
  }

  // ── Keep deleteTherapist as alias for legacy safety ─────────────────────────
  async function deleteTherapist(therapistId) {
    archiveTherapist(therapistId, 'this therapist');
  }

  // Close therapist modal
  document.getElementById('closeTherapistModal').addEventListener('click', () => {
    document.getElementById('editTherapistModal').classList.remove('active');
  });

  // UTILITY FUNCTIONS
  function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 90px;
      right: 20px;
      background: ${type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#007bff'};
      color: white;
      padding: 16px 24px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10001;
      animation: slideIn 0.3s;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }



  // Make functions global for onclick

  let gracePeriodsData = {};
  let postServiceRestMinutes = 60;

  // Load Grace Periods
  async function loadGracePeriods() {
    try {
      // Load global grace periods
      const gpRes = await fetch(`${apiBase}/grace-periods`);
      gracePeriodsData = await gpRes.json();
      
      // Load post-service rest setting
      const psrRes = await fetch(`${apiBase}/settings/postServiceRest`);
      const psrData = await psrRes.json();
      postServiceRestMinutes = psrData.value || 60;
      
      renderGracePeriods();
      renderPostServiceRest();
      
    } catch (err) {
      console.error('Error loading grace periods:', err);
      showNotification('Failed to load grace periods', 'error');
    }
  }

  // Render Grace Periods UI
  function renderGracePeriods() {
    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const container = document.getElementById('grace-periods-container');
    
    container.innerHTML = days.map(day => {
      const periods = gracePeriodsData[day] || [];
      
      return `
        <div class="grace-day-section" data-day="${day}">
          <div class="grace-day-header">
            <h4>${day}</h4>
            <button class="btn-add-grace" onclick="addGracePeriod('${day}')">
              ⏰ Add Rest Period
            </button>
          </div>
          
          <div class="grace-periods-list" id="grace-${day}">
            ${periods.length === 0 ? 
              '<p style="color: #999; font-style: italic; padding: 12px;">No rest periods set for this day</p>' :
              periods.map((period, idx) => `
                <div class="grace-period-item">
                  <input type="text" value="${period.label || 'Rest Period'}" 
                    class="grace-label" placeholder="e.g., Lunch Break">
                  <input type="time" value="${convertTo24HourInput(period.startTime)}" 
                    class="grace-start">
                  <span>to</span>
                  <input type="time" value="${convertTo24HourInput(period.endTime)}" 
                    class="grace-end">
                  <button class="btn-remove-grace" onclick="removeGracePeriod('${day}', ${idx})">
                    ×
                  </button>
                </div>
              `).join('')
            }
          </div>
        </div>
      `;
    }).join('');
  }

  // Render Post-Service Rest Setting
  function renderPostServiceRest() {
    const container = document.getElementById('post-service-rest-container');
    
    container.innerHTML = `
      <div class="post-service-rest-box">
        <div class="psr-header">
          <div>
            <h4>⏰ Post-Service Rest Period</h4>
            <p style="color: #666; font-size: 0.9rem; margin-top: 4px;">
              How long should therapists rest after completing each service?
            </p>
          </div>
          <div class="psr-input-group">
            <input type="number" id="postServiceRestInput" 
              value="${postServiceRestMinutes}" 
              min="0" max="120" step="15"
              style="width: 100px; padding: 10px; font-size: 1.2rem; text-align: center; border: 2px solid #4b2e1e; border-radius: 8px; font-weight: 600;">
            <span style="font-size: 1.1rem; color: #666; font-weight: 500;">minutes</span>
          </div>
        </div>
        
        <div class="psr-examples">
          <p style="color: #888; font-size: 0.85rem; margin: 12px 0 8px 0;">
            <strong>Examples:</strong>
          </p>
          <ul style="color: #666; font-size: 0.85rem; line-height: 1.8; padding-left: 20px;">
            <li><strong>60 min:</strong> Client books 1:00 PM - 2:30 PM → Therapist available at 3:30 PM</li>
            <li><strong>30 min:</strong> Client books 1:00 PM - 2:30 PM → Therapist available at 3:00 PM</li>
            <li><strong>0 min:</strong> Client books 1:00 PM - 2:30 PM → Therapist available at 2:30 PM (Not recommended)</li>
          </ul>
        </div>
        
        <button class="btn-save-psr" onclick="savePostServiceRest()">
           Save Rest Period
        </button>
      </div>
    `;
  }

  // Add Grace Period to a Day
  function addGracePeriod(day) {
    if (!gracePeriodsData[day]) {
      gracePeriodsData[day] = [];
    }
    
    gracePeriodsData[day].push({
      label: 'Rest Period',
      startTime: '12:00 PM',
      endTime: '1:00 PM'
    });
    
    renderGracePeriods();
  }

  // Remove Grace Period
  function removeGracePeriod(day, index) {
    if (!gracePeriodsData[day]) return;
    
    gracePeriodsData[day].splice(index, 1);
    renderGracePeriods();
  }

  // Save All Grace Periods
  async function saveGracePeriods() {
    try {
      const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
      const updatedData = {};
      
      days.forEach(day => {
        const container = document.getElementById(`grace-${day}`);
        const items = container.querySelectorAll('.grace-period-item');
        
        updatedData[day] = Array.from(items).map(item => ({
          label: item.querySelector('.grace-label').value,
          startTime: convertTo12Hour(item.querySelector('.grace-start').value),
          endTime: convertTo12Hour(item.querySelector('.grace-end').value)
        }));
      });
      
      const res = await fetch(`${apiBase}/grace-periods/bulk`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ gracePeriods: updatedData })
      });
      
      if (res.ok) {
        showNotification(' Grace periods saved successfully!', 'success');
        gracePeriodsData = updatedData;
      } else {
        const data = await res.json();
        showNotification(` ${data.msg || 'Failed to save'}`, 'error');
      }
    } catch (err) {
      console.error('Error saving grace periods:', err);
      showNotification('Failed to save grace periods', 'error');
    }
  }

  // Save Post-Service Rest
  async function savePostServiceRest() {
    try {
      const value = parseInt(document.getElementById('postServiceRestInput').value);
      
      if (isNaN(value) || value < 0) {
        alert('Please enter a valid number');
        return;
      }
      
      const res = await fetch(`${apiBase}/settings/postServiceRest`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ 
          value,
          description: 'Minutes of rest after each service'
        })
      });
      
      if (res.ok) {
        postServiceRestMinutes = value;
        showNotification(' Post-service rest period updated!', 'success');
        renderPostServiceRest();
      } else {
        const data = await res.json();
        showNotification(` ${data.msg || 'Failed to save'}`, 'error');
      }
    } catch (err) {
      console.error('Error saving post-service rest:', err);
      showNotification('Failed to save setting', 'error');
    }
  }

  async function loadTherapistAnalytics() {
    try {
      console.log(' Loading therapist analytics...');
      
      // Load commission settings
      await loadCommissionSettings();
      
      // Load therapist performance with schedule integration
      await loadTherapistPerformance();
      
      // Load income data
      await loadIncomeData();
      
      // Load predictions
      await loadPredictions();
      
      // Start auto-refresh for status
      startStatusAutoRefresh();
      
      console.log(' Therapist analytics loaded successfully');
      
    } catch (err) {
      console.error(' Error loading therapist analytics:', err);
      showNotification('Failed to load analytics', 'error');
    }
  }

  async function loadTherapistPerformance() {
    try {
      const period = currentCardPeriod || 'today';
      console.log(` Loading therapist performance for period: ${period}`);
      
      // Fetch all three sources in parallel
      const [statusRes, analyticsRes, mgmtRes] = await Promise.all([
        fetch(`${apiBase}/bookings/therapist-status`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${apiBase}/analytics/therapist-performance?period=${period}`, { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`${apiBase}/therapists`, { headers: { Authorization: `Bearer ${token}` } }),
      ]);

      if (!statusRes.ok) { console.error('Failed to load therapist status:', statusRes.status); return; }

      const statusData = await statusRes.json();
      const analytics  = analyticsRes.ok ? await analyticsRes.json() : [];
      const mgmtList   = mgmtRes.ok     ? await mgmtRes.json()      : [];

      // Merge all three
      const merged = statusData.map(t => {
        const analytic = analytics.find(a => a.name?.toLowerCase() === t.name?.toLowerCase()) || {};
        const mgmt     = mgmtList.find(m => m.name?.toLowerCase() === t.name?.toLowerCase()) || {};
        return {
          ...t,
          _id:               mgmt._id               || t._id,
          email:             mgmt.email             || '',
          gender:            mgmt.gender            || 'female',
          isActive:          mgmt.isActive          !== false,
          totalBookings:     analytic.totalBookings     || 0,
          completedBookings: analytic.completedBookings || 0,
          totalRevenue:      analytic.totalRevenue      || 0,
          successRate:       analytic.successRate       || 0,
          expertise:         analytic.expertise         || mgmt.expertise || t.expertise || [],
          workingHours:      analytic.workingHours      || t.workingHours || null,
        };
      });

      console.log(' Loaded', merged.length, 'therapists with live status');
      displayTherapistPerformance(merged);
      
    } catch (err) {
      console.error(' Error loading therapist performance:', err);
      const grid = document.getElementById('therapistStatusGrid');
      if (grid) {
        grid.innerHTML = `
          <div style="padding: 40px; text-align: center; color: #dc3545;">
            <div style="font-size: 3rem; margin-bottom: 15px;">️</div>
            <p style="font-size: 1.1rem; font-weight: 600; margin-bottom: 8px;">Failed to load status</p>
            <p style="font-size: 0.9rem; color: #666;">${err.message}</p>
            <button 
              onclick="loadTherapistPerformance()" 
              style="margin-top: 15px; padding: 10px 20px; background: var(--primary-brown); color: white; border: none; border-radius: 6px; cursor: pointer;"
            >
              Retry
            </button>
          </div>
        `;
      }
    }
  }

  // Unified card: live status + management controls combined
  function displayTherapistPerformance(analytics) {
    const grid = document.getElementById('therapistStatusGrid');
    if (!grid) { console.warn('️ therapistStatusGrid element not found'); return; }
    if (!analytics || analytics.length === 0) {
      grid.innerHTML = '<p style="color: #999; text-align: center; padding: 40px;">No therapists available</p>';
      return;
    }
    console.log(' Rendering', analytics.length, 'therapist cards');

    const statusMeta = {
      available: { icon: '', cls: 'available', label: 'Available Now' },
      busy:      { icon: '', cls: 'busy',      label: 'In Session'    },
      break:     { icon: '', cls: 'break',     label: 'On Break'      },
      off:       { icon: '', cls: 'off',        label: 'Off Duty'      },
    };

    grid.innerHTML = analytics.map(t => {
      const sm = statusMeta[t.status] || { icon: '', cls: 'off', label: t.statusMessage || 'Unknown' };
      const expertiseTxt = t.expertise && t.expertise.length > 0
        ? t.expertise.slice(0, 2).join(', ') + (t.expertise.length > 2 ? ` +${t.expertise.length - 2}` : '')
        : 'All services';
      const genderBadge = `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:0.76rem;font-weight:700;background:${t.gender === 'male' ? '#dbeafe' : '#fce7f3'};color:${t.gender === 'male' ? '#1d4ed8' : '#be185d'};">${t.gender === 'male' ? ' Male' : ' Female'}</span>`;
      const tid = (t._id || '').toString();
      const safeName = (t.name || '').replace(/'/g, "\'");

      return `
        <div class="therapist-status-card ${sm.cls}" style="display:flex;flex-direction:column;">

          <div style="display:flex;align-items:center;gap:14px;padding:16px 18px 12px;">
            <div style="width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#8b6f47,#4b2e1e);color:#fff;font-size:1.5rem;display:flex;align-items:center;justify-content:center;flex-shrink:0;"></div>
            <div style="flex:1;min-width:0;">
              <div style="font-weight:700;font-size:1rem;color:#4b2e1e;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${t.name}</div>
              <div style="font-size:0.78rem;color:#888;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${t.email || ''}</div>
              <div style="margin-top:4px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                ${genderBadge}
                <span style="font-size:0.76rem;font-weight:600;color:${t.status === 'available' ? '#28a745' : t.status === 'busy' ? '#dc3545' : t.status === 'break' ? '#ff9800' : '#666'};">${sm.icon} ${sm.label}</span>
              </div>
            </div>
            <div class="status-indicator" style="flex-shrink:0;"><span class="status-dot-large status-${t.status}"></span></div>
          </div>

          <div class="status-details" style="padding:0 18px 12px;border-top:1px solid rgba(0,0,0,0.06);">
            ${t.currentBooking ? `<div class="status-detail-item"><span class="status-detail-label">Until:</span><span class="status-detail-value">${t.currentBooking.endTime}</span></div>` : ''}
            <div class="status-detail-item"><span class="status-detail-label">Expertise:</span><span class="status-detail-value" style="font-size:0.82rem;">${expertiseTxt}</span></div>
            ${t.workingHours ? `<div class="status-detail-item"><span class="status-detail-label">Today\'s Hours:</span><span class="status-detail-value">${t.workingHours.startTime} - ${t.workingHours.endTime}</span></div>` : ''}
            <div class="status-detail-item"><span class="status-detail-label">Bookings:</span><span class="status-detail-value">${t.completedBookings || 0}/${t.totalBookings || 0} completed</span></div>
            <div class="status-detail-item"><span class="status-detail-label">Revenue:</span><span class="status-detail-value">₱${(t.totalRevenue || 0).toLocaleString()}</span></div>
          </div>

          <div style="padding:10px 18px 14px;border-top:1px solid rgba(0,0,0,0.06);display:flex;flex-direction:column;gap:8px;">
            <button class="btn-schedule" style="width:100%;" onclick="openScheduleModal('${tid}')"> Manage Schedule</button>
            <div style="display:flex;gap:8px;">
              <button class="btn-edit" style="flex:1;" onclick="editTherapist('${tid}')">Edit</button>
              <button class="btn-archive" style="flex:1;" onclick="archiveTherapist('${tid}', '${safeName}')">️ Archive</button>
            </div>
          </div>

        </div>`;
    }).join('');
  }
  // NEW: Load predictions
  async function loadPredictions() {
    try {
      console.log(' Loading predictions for period:', currentPeriod);
      
      const res = await fetch(`${apiBase}/analytics/enhanced-predictions?period=${currentPeriod}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (!res.ok) {
        console.error('Failed to load predictions');
        return;
      }
      
      const data = await res.json();
      console.log(' Loaded predictions:', data);
      
      // Store predictions data globally
      predictionsData = data.predictions || [];
      
      // Update stat card
      
      // Display predictions chart
      if (forecastEnabled) {
        displayEnhancedPredictionsChart(data);
      }
      
    } catch (err) {
      console.error(' Error loading predictions:', err);
    }
  }

  //  Display predictions chart with service breakdown
  function displayPredictionsChart(data) {
    const ctx = document.getElementById('predictionsChart');
    
    if (!ctx) {
      console.warn('️ Predictions chart canvas not found');
      return;
    }
    
    if (currentChart.predictions) {
      currentChart.predictions.destroy();
    }
    
    const { predictions, overallTopServices } = data;
    
    if (!predictions || predictions.length === 0) {
      console.warn('️ No predictions data to display');
      return;
    }
    
    // Prepare data for stacked bar chart showing service breakdown
    const labels = predictions.map(p => p.dayName);
    
    // Get unique services from top services
    const serviceNames = new Set();
    predictions.forEach(pred => {
      pred.topServices?.forEach(s => serviceNames.add(s.name));
    });
    
    const uniqueServices = Array.from(serviceNames).slice(0, 5); // Top 5 services
    
    // Create datasets for each service
    const datasets = uniqueServices.map((serviceName, index) => {
      const colors = [
        '#8b4513', // Brown
        '#a0522d', // Sienna
        '#d2691e', // Chocolate
        '#cd853f', // Peru
        '#daa520'  // Goldenrod
      ];
      
      const data = predictions.map(pred => {
        const service = pred.topServices?.find(s => s.name === serviceName);
        return service ? service.count : 0;
      });
      
      return {
        label: serviceName,
        data,
        backgroundColor: colors[index % colors.length],
        borderColor: colors[index % colors.length],
        borderWidth: 1
      };
    });
    
    currentChart.predictions = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              boxWidth: 12,
              padding: 10,
              font: {
                size: 11
              }
            }
          },
          title: {
            display: true,
            text: 'Predicted Service Demand by Day',
            font: {
              size: 14,
              weight: 'bold'
            },
            padding: {
              bottom: 15
            }
          },
          tooltip: {
            callbacks: {
              title: function(context) {
                const dayData = predictions[context[0].dataIndex];
                return `${dayData.dayName} - ${dayData.predictedBookings} total bookings`;
              },
              label: function(context) {
                return `${context.dataset.label}: ${context.parsed.y} booking${context.parsed.y !== 1 ? 's' : ''}`;
              },
              footer: function(context) {
                const dayData = predictions[context[0].dataIndex];
                return [
                  `Expected Revenue: ₱${dayData.predictedRevenue.toLocaleString()}`,
                  `Peak Hour: ${dayData.peakHour || 'N/A'}`,
                  `Confidence: ${dayData.confidence}`
                ];
              }
            },
            backgroundColor: 'rgba(0, 0, 0, 0.8)',
            titleFont: {
              size: 13,
              weight: 'bold'
            },
            bodyFont: {
              size: 12
            },
            footerFont: {
              size: 11
            },
            padding: 12
          }
        },
        scales: {
          x: {
            stacked: true,
            grid: {
              display: false
            },
            ticks: {
              font: {
                size: 11
              }
            }
          },
          y: {
            stacked: true,
            beginAtZero: true,
            title: {
              display: true,
              text: 'Number of Bookings',
              font: {
                size: 12,
                weight: 'bold'
              }
            },
            ticks: {
              stepSize: 1,
              precision: 0,
              font: {
                size: 11
              }
            }
          }
        }
      }
    });
  }

  // Stop auto-refresh when leaving tab
  window.addEventListener('beforeunload', () => {
    if (window.therapistStatusInterval) {
      clearInterval(window.therapistStatusInterval);
    }
  });

  // Filter for therapist CARDS (Live Status Dashboard) — independent from income filter
  function filterCardByPeriod(period) {
    currentCardPeriod = period;
    document.querySelectorAll('[data-card-period]').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.querySelector(`[data-card-period="${period}"]`);
    if (activeBtn) activeBtn.classList.add('active');
    loadTherapistPerformance();
  }

  // Filter for INCOME & COMMISSION table only
  function filterIncomeByPeriod(period) {
    currentIncomePeriod = period;
    document.querySelectorAll('[data-income-period]').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.querySelector(`[data-income-period="${period}"]`);
    if (activeBtn) activeBtn.classList.add('active');
    loadIncomeData();
  }

  async function saveCommissionSettings() {
  const rate     = parseFloat(document.getElementById('commissionRate').value);
  const baseRate = parseFloat(document.getElementById('baseRate').value) || 0;

  if (isNaN(rate) || rate < 0 || rate > 100) {
    showNotification('Commission rate must be between 0 and 100', 'error');
    return;
  }

  try {
    // ── 1. Save to DB via the settings route (survives logout) ───────────────
    const saveRes = await fetch(`${apiBase}/settings/commission`, {
      method:  'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${token}`,
      },
      body: JSON.stringify({ rate, baseRate }),
    });

    if (!saveRes.ok) {
      const err = await saveRes.json();
      throw new Error(err.msg || 'Settings save failed');
    }

    // ── 2. Also update every therapist's individual commissionRate ───────────
    const listRes = await fetch(`${apiBase}/therapists`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (listRes.ok) {
      const therapists = await listRes.json();
      await Promise.all(therapists.map(t =>
        fetch(`${apiBase}/payroll/settings/${t._id}`, {
          method:  'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization:  `Bearer ${token}`,
          },
          body: JSON.stringify({ commissionRate: rate }),
        })
      ));
    }

    // ── 3. Update the summary card + reload income table ────────────────────
    updateCommissionDisplay(rate);
    if (typeof loadIncomeData === 'function') await loadIncomeData();

    showNotification(` Commission rate saved: ${rate}%`, 'success');

  } catch (err) {
    console.error('saveCommissionSettings error:', err);
    showNotification(` Failed to save: ${err.message}`, 'error');
  }
}

async function loadCommissionSettings() {
    try {
      const res = await fetch(`${apiBase}/settings/commission`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      
      if (res.ok) {
        const data = await res.json();
        commissionSettings = data;
        
        // Update UI elements if they exist
        const rateInput = document.getElementById('commissionRate');
        const baseRateInput = document.getElementById('baseRate');
        
        if (rateInput) rateInput.value = data.rate || 60;
        if (baseRateInput) baseRateInput.value = data.baseRate || 0;
        
        console.log(' Commission settings loaded:', data);
      } else if (res.status === 404) {
        // Settings don't exist yet, use defaults
        console.log('ℹ️ Commission settings not found, using defaults');
        commissionSettings = { rate: 60, baseRate: 0 };
        
        // Try to create default settings
        await fetch(`${apiBase}/settings/commission`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ rate: 60, baseRate: 0 })
        });
      }
    } catch (err) {
      console.error('Error loading commission settings:', err);
      // Use defaults if there's an error
      commissionSettings = { rate: 60, baseRate: 0 };
    }
  }

// ── Helper: update the "Commission Rate" summary card display ────────────
function updateCommissionDisplay(rate) {
  // Update the green "Commission Rate" summary card if it exists
  const rateCards = document.querySelectorAll('.income-summary-grid .summary-card');
  rateCards.forEach(card => {
    const label = card.querySelector('.card-label, p, .label');
    if (label && label.textContent.toLowerCase().includes('commission rate')) {
      const valueEl = card.querySelector('h2, .card-value, .value');
      if (valueEl) valueEl.textContent = `${rate}%`;
    }
  });
}

  // Load Admin Therapist Status
  async function loadAdminTherapistStatus() {
    try {
      const res = await fetch(`${apiBase}/bookings/therapist-status`);
      
      if (!res.ok) {
        console.error('Failed to load status');
        return;
      }
      
      const statusData = await res.json();
      displayAdminTherapistStatus(statusData);
      
    } catch (err) {
      console.error('Error loading therapist status:', err);
    }
  }

  // Display Therapist Status in Admin
  function displayAdminTherapistStatus(statusData) {
    const grid = document.getElementById('therapistStatusGrid');
    
    if (!grid) return;
    
    if (!statusData || statusData.length === 0) {
      grid.innerHTML = '<p style="color: #999; text-align: center; padding: 40px;">No therapists available</p>';
      return;
    }
    
    grid.innerHTML = statusData.map(therapist => {
      const { name, status, currentBooking, breakUntil, nextAvailable } = therapist;
      
      let statusText = '';
      let statusIcon = '';
      
      switch (status) {
        case 'available':
          statusText = 'Available Now';
          statusIcon = '';
          break;
        case 'busy':
          statusText = 'In Session';
          statusIcon = '';
          break;
        case 'break':
          statusText = 'On Break';
          statusIcon = '';
          break;
        case 'off':
          statusText = 'Off Duty';
          statusIcon = '';
          break;
      }
      
      return `
        <div class="therapist-status-card ${status}">
          <div class="status-card-header">
            <div class="therapist-info">
              <h4>${name}</h4>
              <p>${statusText}</p>
            </div>
            <div class="status-indicator">
              <span class="status-dot-large status-${status}"></span>
              <span>${statusIcon}</span>
            </div>
          </div>
          
          <div class="status-details">
            ${status === 'busy' && currentBooking ? `
              <div class="status-detail-item">
                <span class="status-detail-label">Until:</span>
                <span class="status-detail-value">${currentBooking.endTime}</span>
              </div>
            ` : ''}
            
            ${status === 'break' && breakUntil ? `
              <div class="status-detail-item">
                <span class="status-detail-label">Break Ends:</span>
                <span class="status-detail-value">${breakUntil}</span>
              </div>
            ` : ''}
            
            ${status === 'off' && nextAvailable ? `
              <div class="status-detail-item">
                <span class="status-detail-label">Next Available:</span>
                <span class="status-detail-value">${nextAvailable}</span>
              </div>
            ` : ''}
            
            ${status === 'available' ? `
              <div class="status-detail-item">
                <span class="status-detail-label">Status:</span>
                <span class="status-detail-value" style="color: #28a745;">Ready for appointments</span>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
  }

  // Start Auto-Refresh for Status
  function startStatusAutoRefresh() {
    // Clear any existing interval
    if (window.therapistStatusInterval) {
      clearInterval(window.therapistStatusInterval);
    }
    
    console.log(' Starting auto-refresh for therapist status');
    
    window.therapistStatusInterval = setInterval(() => {
      // Only refresh if therapists tab is visible
      const therapistsTab = document.getElementById('therapists-tab');
      if (therapistsTab && therapistsTab.classList.contains('active')) {
        console.log(' Auto-refreshing therapist status...');
        loadTherapistPerformance();
      }
    }, 120000); // Every 2 minutes (was 30s — reduces server load)
  }

  // Load Income Data — uses cached allBookings to avoid re-fetching
  async function loadIncomeData() {
    try {
      // Use already-loaded bookings from memory if available, otherwise fetch
      let incomeBookings;
      if (allBookings && allBookings.length > 0) {
        incomeBookings = allBookings;
      } else {
        const now  = new Date();
        const from = new Date(now.getFullYear(), 0, 1).toISOString().split('T')[0];
        const to   = new Date(now.getFullYear(), 11, 31).toISOString().split('T')[0];
        const res  = await fetch(`${apiBase}/bookings?from=${from}&to=${to}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Failed to fetch bookings');
        incomeBookings = await res.json();
      }

      // Filter by period
      const filteredBookings = filterByPeriod(incomeBookings, currentIncomePeriod);

      // Calculate income by therapist
      const incomeByTherapist = calculateTherapistIncome(filteredBookings);

      // Display summary cards
      displayIncomeSummary(incomeByTherapist);

      // Display detailed table
      displayIncomeTable(incomeByTherapist);
      
    } catch (err) {
      console.error('Error loading income data:', err);
      showNotification('Failed to load income data', 'error');
    }
  }

  // Calculate Therapist Income
  function calculateTherapistIncome(bookings) {
    const therapistData = {};
    
    bookings.forEach(booking => {
      if (booking.therapist && booking.status === 'completed') {
        const therapistId = booking.therapist._id || booking.therapist;
        const therapistName = booking.therapist.name || 'Unknown';
        
        if (!therapistData[therapistId]) {
          therapistData[therapistId] = {
            id: therapistId,
            name: therapistName,
            completedServices: 0,
            totalRevenue: 0,
            commission: 0,
            totalBookings: 0
          };
        }
        
        const servicePrice = booking.price || 0;
        const commission = Math.round(servicePrice * (commissionSettings.rate / 100));
        
        therapistData[therapistId].completedServices++;
        therapistData[therapistId].totalRevenue += servicePrice;
        therapistData[therapistId].commission += commission;
      }
      
      // Count all bookings for success rate
      if (booking.therapist) {
        const therapistId = booking.therapist._id || booking.therapist;
        if (therapistData[therapistId]) {
          therapistData[therapistId].totalBookings++;
        }
      }
    });
    
    return Object.values(therapistData);
  }

  // Display Income Summary Cards
  function displayIncomeSummary(incomeData) {
    const grid = document.getElementById('incomeSummaryGrid');
    
    if (!grid) return;
    
    // Calculate totals
    const totalCommission = incomeData.reduce((sum, t) => sum + t.commission, 0);
    const totalRevenue = incomeData.reduce((sum, t) => sum + t.totalRevenue, 0);
    const totalServices = incomeData.reduce((sum, t) => sum + t.completedServices, 0);
    const avgCommission = incomeData.length ? Math.round(totalCommission / incomeData.length) : 0;
    
    const periodText = {
      today: 'Today',
      week: 'This Week',
      month: 'This Month',
      year: 'This Year'
    }[currentIncomePeriod];
    
    grid.innerHTML = `
      <div class="income-summary-card" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
        <div class="income-card-label">Total Commission Paid</div>
        <div class="income-card-value">₱${totalCommission.toLocaleString()}</div>
        <div class="income-card-subtitle">${periodText}</div>
      </div>
      
      <div class="income-summary-card" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);">
        <div class="income-card-label">Total Revenue</div>
        <div class="income-card-value">₱${totalRevenue.toLocaleString()}</div>
        <div class="income-card-subtitle">From ${totalServices} completed services</div>
      </div>
      
      <div class="income-summary-card" style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);">
        <div class="income-card-label">Average per Therapist</div>
        <div class="income-card-value">₱${avgCommission.toLocaleString()}</div>
        <div class="income-card-subtitle">${incomeData.length} active therapist${incomeData.length !== 1 ? 's' : ''}</div>
      </div>
      
      <div class="income-summary-card" style="background: linear-gradient(135deg, #43e97b 0%, #38f9d7 100%);">
        <div class="income-card-label">Commission Rate</div>
        <div class="income-card-value">${commissionSettings.rate}%</div>
        <div class="income-card-subtitle">Current setting</div>
      </div>
    `;
  }

  // Display Income Table
  function displayIncomeTable(incomeData) {
    const tbody = document.querySelector('#incomeTable tbody');
    
    if (!tbody) return;
    
    if (incomeData.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 40px; color: #999;">
            No income data for this period
          </td>
        </tr>
      `;
      return;
    }
    
    // Sort by commission (highest first)
    incomeData.sort((a, b) => b.commission - a.commission);
    
    tbody.innerHTML = incomeData.map((therapist, index) => {
      const successRate = therapist.totalBookings > 0 
        ? Math.round((therapist.completedServices / therapist.totalBookings) * 100) 
        : 0;
      
      let rateClass = 'low';
      if (successRate >= 80) rateClass = 'high';
      else if (successRate >= 60) rateClass = 'medium';
      
      const medal = index === 0 ? ' ' : index === 1 ? ' ' : index === 2 ? ' ' : '';
      
      return `
        <tr>
          <td>
            <strong>${medal}${therapist.name}</strong>
          </td>
          <td>${therapist.completedServices}</td>
          <td style="font-weight: 600;">₱${therapist.totalRevenue.toLocaleString()}</td>
          <td class="income-amount">₱${therapist.commission.toLocaleString()}</td>
          <td>
            <button class="btn-edit" onclick="showIncomeDetail('${therapist.id}', '${therapist.name}')">
              View Details
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Stores the therapist currently open in the detail modal — used by exportIncomeReport
  let _detailTherapistId   = null;
  let _detailTherapistName = null;
  let _detailBookings      = [];   // ALL completed bookings for this therapist (full year)

  async function showIncomeDetail(therapistId, therapistName) {
    try {
      const now  = new Date();
      const from = new Date(now.getFullYear() - 1, 0, 1).toISOString().split('T')[0];
      const to   = new Date(now.getFullYear(), 11, 31).toISOString().split('T')[0];
      const res  = await fetch(`${apiBase}/bookings?from=${from}&to=${to}`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      const fetchedBookings = await res.json();

      // Store ALL completed bookings for this therapist (full range) so export can filter by any period
      _detailTherapistId   = therapistId;
      _detailTherapistName = therapistName;
      _detailBookings      = fetchedBookings.filter(b => {
        const tId = b.therapist?._id || b.therapist;
        return String(tId) === String(therapistId) && b.status === 'completed';
      });

      // Display using the currently selected income period
      _renderIncomeDetailContent(currentIncomePeriod);

      document.getElementById('incomeDetailModal').classList.add('active');

    } catch (err) {
      console.error('Error loading income detail:', err);
      showNotification('Failed to load details', 'error');
    }
  }

  /** (Re-)renders the detail modal table for a given period — called on open and on export */
  function _renderIncomeDetailContent(period) {
    const modal   = document.getElementById('incomeDetailModal');
    const title   = document.getElementById('incomeDetailTitle');
    const content = document.getElementById('incomeDetailContent');
    if (!modal || !title || !content) return;

    const periodLabels = { today:'Today', week:'This Week', month:'This Month', year:'This Year' };
    const periodLabel  = periodLabels[period] || period;

    const filteredBookings = filterByPeriod(_detailBookings, period);

    title.textContent = `${_detailTherapistName} — Income Details (${periodLabel})`;

    const rate            = commissionSettings.rate || 60;
    const totalCommission = filteredBookings.reduce((sum, b) =>
      sum + Math.round((b.price || 0) * (rate / 100)), 0);
    const totalRevenue    = filteredBookings.reduce((sum, b) => sum + (b.price || 0), 0);

    content.innerHTML = `
      <div style="padding:20px;">
        <!-- Summary banner -->
        <div style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);padding:25px;border-radius:12px;color:white;margin-bottom:20px;">
          <div style="font-size:0.9rem;opacity:0.9;">Total Commission — ${periodLabel}</div>
          <div style="font-size:2.5rem;font-weight:700;margin:8px 0;">₱${totalCommission.toLocaleString()}</div>
          <div style="font-size:0.85rem;opacity:0.8;">
            ${filteredBookings.length} completed services · Revenue: ₱${totalRevenue.toLocaleString()} · Rate: ${rate}%
          </div>
        </div>

        <!-- Period quick-filter inside modal -->
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
          ${['today','week','month','year'].map(p => `
            <button onclick="_changeDetailPeriod('${p}')"
              style="padding:7px 16px;border-radius:6px;font-size:0.82rem;font-weight:600;cursor:pointer;
                border:1.5px solid ${p===period?'#4b2e1e':'#ddd'};
                background:${p===period?'#4b2e1e':'#fff'};
                color:${p===period?'#fff':'#555'};
                font-family:'Poppins',sans-serif;">
              ${periodLabels[p]}
            </button>`).join('')}
        </div>

        <!-- Breakdown table -->
        <h4 style="margin-bottom:12px;">Service Breakdown:</h4>
        ${filteredBookings.length === 0 ? `
          <p style="color:#999;text-align:center;padding:30px;">No completed services for this period.</p>
        ` : `
          <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
            <thead>
              <tr style="background:#f5f1eb;">
                <th style="padding:10px 12px;text-align:left;color:#4b2e1e;">Date</th>
                <th style="padding:10px 12px;text-align:left;color:#4b2e1e;">Service</th>
                <th style="padding:10px 12px;text-align:left;color:#4b2e1e;">Client</th>
                <th style="padding:10px 12px;text-align:right;color:#4b2e1e;">Price</th>
                <th style="padding:10px 12px;text-align:right;color:#4b2e1e;">Commission (${rate}%)</th>
              </tr>
            </thead>
            <tbody>
              ${filteredBookings
                .slice().sort((a,b) => new Date(b.date) - new Date(a.date))
                .map(b => {
                  const commission = Math.round((b.price||0) * (rate/100));
                  const date = new Date(b.date).toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'});
                  return `
                    <tr style="border-bottom:1px solid #f0ece6;">
                      <td style="padding:10px 12px;">${date}</td>
                      <td style="padding:10px 12px;">${b.service?.name||'Unknown'}</td>
                      <td style="padding:10px 12px;color:#666;">${b.guestName||'—'}</td>
                      <td style="padding:10px 12px;text-align:right;">₱${(b.price||0).toLocaleString()}</td>
                      <td style="padding:10px 12px;text-align:right;font-weight:700;color:#28a745;">₱${commission.toLocaleString()}</td>
                    </tr>`;
                }).join('')}
              <!-- Totals row -->
              <tr style="background:#f5f1eb;font-weight:700;">
                <td colspan="3" style="padding:10px 12px;">TOTAL</td>
                <td style="padding:10px 12px;text-align:right;">₱${totalRevenue.toLocaleString()}</td>
                <td style="padding:10px 12px;text-align:right;color:#28a745;">₱${totalCommission.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>`}
      </div>`;
  }

  /** Called by period buttons inside the detail modal */
  window._changeDetailPeriod = function(period) {
    _renderIncomeDetailContent(period);
  };

  async function loadReviewsManagement() {
    try {
      console.log(' Loading reviews management...');
      
      const token = localStorage.getItem('token');
      const response = await fetch(`${apiBase}/reviews/admin/all`, {
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      const reviews = data.reviews || [];
      
      console.log(` Loaded ${reviews.length} reviews`);
      
      displayReviewsManagement(reviews);
      loadReviewStats();
      
    } catch (err) {
      console.error(' Error loading reviews:', err);
      
      const container = document.getElementById('reviewsManagementContainer');
      if (container) {
        container.innerHTML = `
          <div style="padding: 60px; text-align: center;">
            <div style="font-size: 4rem; margin-bottom: 20px;">️</div>
            <h3 style="color: #dc3545; margin-bottom: 15px;">Failed to Load Reviews</h3>
            <p style="color: #666; margin-bottom: 25px;">${err.message}</p>
            <button 
              onclick="loadReviewsManagement()" 
              style="padding: 12px 30px; background: var(--primary-brown); color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;"
            >
              Retry
            </button>
          </div>
        `;
      }
      
      showNotification('Failed to load reviews', 'error');
    }
  }

  function displayReviewsManagement(reviews) {
  const container = document.getElementById('reviewsManagementContainer');
  if (!container) return;

  container.innerHTML = `
    <div class="stats-grid" style="margin-bottom: 30px;">
      <div class="stat-card">
        <div class="stat-icon"></div>
        <div class="stat-details"><h3 id="totalReviews">0</h3><p>Total Reviews</p></div>
      </div>
      <div class="stat-card">
        <div class="stat-icon">⭐</div>
        <div class="stat-details"><h3 id="avgRating">0</h3><p>Average Rating</p></div>
      </div>
    </div>

    <div class="review-filters" style="margin-bottom: 20px; display: flex; gap: 10px; flex-wrap: wrap;">
      <button class="filter-btn active" onclick="filterReviews('all')">All (${reviews.length})</button>
      <button class="filter-btn" onclick="filterReviews(5)">5  (${reviews.filter(r=>r.rating===5).length})</button>
      <button class="filter-btn" onclick="filterReviews(4)">4  (${reviews.filter(r=>r.rating===4).length})</button>
      <button class="filter-btn" onclick="filterReviews(3)">3  (${reviews.filter(r=>r.rating===3).length})</button>
      <button class="filter-btn" onclick="filterReviews(2)">2  (${reviews.filter(r=>r.rating===2).length})</button>
      <button class="filter-btn" onclick="filterReviews(1)">1  (${reviews.filter(r=>r.rating===1).length})</button>
    </div>

    <div id="reviewsList" style="display:flex; flex-direction:column; gap:16px; width:100%;">
      ${reviews.length === 0
        ? `<div style="padding:60px;text-align:center;"><div style="font-size:4rem;"></div><h3>No Reviews Yet</h3></div>`
        : reviews.map(review => createReviewCard(review)).join('')
      }
    </div>
  `;
}

  function createReviewCard(review) {
  const serviceName = review.service?.name || 'Service Not Found';
  const userName = review.guestName || review.user?.name || 'Guest';
  const userEmail = review.guestEmail || review.user?.email || 'No email';
  const reviewDate = review.createdAt
    ? new Date(review.createdAt).toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' })
    : 'Unknown date';

  return `
    <div class="review-card-admin" data-status="${review.status}" data-rating="${review.rating}" style="width:100%;box-sizing:border-box;">
      <div class="review-card-header">
        <div class="review-client-info">
          <div class="client-avatar">${userName.charAt(0).toUpperCase()}</div>
          <div>
            <h4>${userName}</h4>
            <p class="client-email">${userEmail}</p>
            <p class="review-date">${reviewDate}</p>
          </div>
        </div>
      </div>
      <div class="review-content">
        <div class="review-rating-display">
          ${''.repeat(review.rating)}${''.repeat(5 - review.rating)}
          <span>(${review.rating}/5)</span>
        </div>
        <p class="review-service">${serviceName}</p>
        <p class="review-comment">${review.comment}</p>
      </div>
      <div class="review-actions"></div>
    </div>
  `;
}

  async function loadReviewStats() {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`${apiBase}/reviews/admin/stats`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      const stats = await response.json();
      
      document.getElementById('totalReviews').textContent = stats.total;
      document.getElementById('avgRating').textContent = stats.averageRating;
      
    } catch (err) {
      console.error('Error loading review stats:', err);
    }
  }

  function filterReviews(filter) {
  document.querySelectorAll('.review-filters .filter-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  event.target.classList.add('active');
  
  const cards = document.querySelectorAll('.review-card-admin');
  cards.forEach(card => {
    if (filter === 'all' || parseInt(card.dataset.rating) === filter) {
      card.style.display = 'block';
    } else {
      card.style.display = 'none';
    }
  });
}

  // Close Income Detail Modal
  function closeIncomeDetail() {
    document.getElementById('incomeDetailModal').classList.remove('active');
  }

  // Export Income Report (placeholder)
  // ═══════════════════════════════════════════════════════════════════════
  // EXCEL / CSV EXPORT UTILITIES
  // ═══════════════════════════════════════════════════════════════════════

  /** Escape a cell value for CSV (handles commas, quotes, newlines) */
  function _csvCell(val) {
    const s = (val === null || val === undefined) ? '' : String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  /** Convert array-of-arrays to a CSV string */
  function _toCSV(rows) {
    return rows.map(row => row.map(_csvCell).join(',')).join('\r\n');
  }

  /** Trigger a browser download of the CSV as an Excel-compatible .csv */
  function _downloadCSV(csvStr, filename) {
    // BOM makes Excel open with correct encoding (UTF-8)
    const blob = new Blob(['\uFEFF' + csvStr], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  /** Format a date as YYYY-MM-DD */
  function _dateLabel(d) {
    try { return new Date(d).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }); } catch(e) { return ''; }
  }

  // ── 1. BOOKING EXPORT ────────────────────────────────────────────────────

  /**
   * Opens the booking-export filter modal.
   * Called from the Export button in the Bookings tab.
   */
  window.openBookingExportModal = function() {
    if (document.getElementById('bookingExportModal')) {
      document.getElementById('bookingExportModal').classList.add('active');
      return;
    }
    // Build modal
    const m = document.createElement('div');
    m.id        = 'bookingExportModal';
    m.className = 'modal active';
    m.innerHTML = `
      <div class="modal-content" style="max-width:480px;text-align:left;">
        <h3 style="color:#4b2e1e;margin-bottom:6px;"> Export Bookings to Excel</h3>
        <p style="color:#888;font-size:0.85rem;margin-bottom:20px;">Choose a period to export, then specify the range.</p>

        <label style="font-weight:600;color:#4b2e1e;display:block;margin-bottom:6px;">Filter By</label>
        <select id="bexPeriod" onchange="bookingExportPeriodChanged()" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:8px;font-size:0.95rem;margin-bottom:16px;font-family:'Poppins',sans-serif;">
          <option value="today">Today</option>
          <option value="week">This Week</option>
          <option value="month">This Month</option>
          <option value="year">This Year</option>
          <option value="custom-week">Specific Week</option>
          <option value="custom-month">Specific Month</option>
          <option value="custom-year">Specific Year</option>
        </select>

        <!-- Dynamic sub-filter rendered by JS -->
        <div id="bexSubFilter"></div>

        <div class="modal-actions" style="margin-top:20px;">
          <button onclick="runBookingExport()" class="btn-success">⬇️ Download Excel</button>
          <button onclick="document.getElementById('bookingExportModal').classList.remove('active')" class="btn-secondary">Cancel</button>
        </div>
      </div>`;
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) m.classList.remove('active'); });
    bookingExportPeriodChanged(); // render initial sub-filter
  };

  window.bookingExportPeriodChanged = function() {
    const period = document.getElementById('bexPeriod')?.value;
    const sub    = document.getElementById('bexSubFilter');
    if (!sub) return;
    const now = new Date();

    if (period === 'custom-week') {
      // Which week of which month?
      sub.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
          <div>
            <label style="font-weight:600;color:#4b2e1e;display:block;margin-bottom:6px;">Month</label>
            <select id="bexMonth" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:8px;font-size:0.9rem;">
              ${['January','February','March','April','May','June','July','August','September','October','November','December']
                .map((mn, i) => `<option value="${i}" ${i===now.getMonth()?'selected':''}>${mn}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-weight:600;color:#4b2e1e;display:block;margin-bottom:6px;">Year</label>
            <select id="bexYear" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:8px;font-size:0.9rem;">
              ${[now.getFullYear()-1, now.getFullYear(), now.getFullYear()+1]
                .map(y => `<option value="${y}" ${y===now.getFullYear()?'selected':''}>${y}</option>`).join('')}
            </select>
          </div>
        </div>
        <label style="font-weight:600;color:#4b2e1e;display:block;margin-bottom:6px;">Week</label>
        <select id="bexWeek" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:8px;font-size:0.9rem;margin-bottom:16px;">
          <option value="1">Week 1 (1st–7th)</option>
          <option value="2">Week 2 (8th–14th)</option>
          <option value="3">Week 3 (15th–21st)</option>
          <option value="4">Week 4 (22nd–28th)</option>
          <option value="5">Week 5 (29th–31st)</option>
        </select>`;
    } else if (period === 'custom-month') {
      sub.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px;">
          <div>
            <label style="font-weight:600;color:#4b2e1e;display:block;margin-bottom:6px;">Month</label>
            <select id="bexMonth" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:8px;font-size:0.9rem;">
              ${['January','February','March','April','May','June','July','August','September','October','November','December']
                .map((mn, i) => `<option value="${i}" ${i===now.getMonth()?'selected':''}>${mn}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-weight:600;color:#4b2e1e;display:block;margin-bottom:6px;">Year</label>
            <select id="bexYear" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:8px;font-size:0.9rem;">
              ${[now.getFullYear()-1, now.getFullYear(), now.getFullYear()+1]
                .map(y => `<option value="${y}" ${y===now.getFullYear()?'selected':''}>${y}</option>`).join('')}
            </select>
          </div>
        </div>`;
    } else if (period === 'custom-year') {
      sub.innerHTML = `
        <div style="margin-bottom:16px;">
          <label style="font-weight:600;color:#4b2e1e;display:block;margin-bottom:6px;">Year</label>
          <select id="bexYear" style="width:100%;padding:10px;border:1.5px solid #ddd;border-radius:8px;font-size:0.9rem;">
            ${[now.getFullYear()-2, now.getFullYear()-1, now.getFullYear(), now.getFullYear()+1]
              .map(y => `<option value="${y}" ${y===now.getFullYear()?'selected':''}>${y}</option>`).join('')}
          </select>
        </div>`;
    } else {
      sub.innerHTML = '';
    }
  };

  window.runBookingExport = function() {
    const period = document.getElementById('bexPeriod')?.value;
    const now    = new Date();
    let start, end, label;

    if (period === 'today') {
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      end   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23,59,59);
      label = _dateLabel(start);
    } else if (period === 'week') {
      const dow = now.getDay();
      start = new Date(now); start.setDate(now.getDate() - dow); start.setHours(0,0,0,0);
      end   = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23,59,59);
      label = `Week_${_dateLabel(start)}_to_${_dateLabel(end)}`;
    } else if (period === 'month') {
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end   = new Date(now.getFullYear(), now.getMonth()+1, 0, 23,59,59);
      label = `${now.toLocaleString('default',{month:'long'})}_${now.getFullYear()}`;
    } else if (period === 'year') {
      start = new Date(now.getFullYear(), 0, 1);
      end   = new Date(now.getFullYear(), 11, 31, 23,59,59);
      label = String(now.getFullYear());
    } else if (period === 'custom-week') {
      const mo = parseInt(document.getElementById('bexMonth')?.value ?? now.getMonth());
      const yr = parseInt(document.getElementById('bexYear')?.value  ?? now.getFullYear());
      const wk = parseInt(document.getElementById('bexWeek')?.value  ?? 1);
      const weekStarts = [1, 8, 15, 22, 29];
      const weekEnds   = [7, 14, 21, 28, 31];
      start = new Date(yr, mo, weekStarts[wk-1]);
      end   = new Date(yr, mo, Math.min(weekEnds[wk-1], new Date(yr, mo+1, 0).getDate()), 23,59,59);
      const mName = new Date(yr, mo).toLocaleString('default', { month:'long' });
      label = `Week${wk}_${mName}_${yr}`;
    } else if (period === 'custom-month') {
      const mo = parseInt(document.getElementById('bexMonth')?.value ?? now.getMonth());
      const yr = parseInt(document.getElementById('bexYear')?.value  ?? now.getFullYear());
      start = new Date(yr, mo, 1);
      end   = new Date(yr, mo+1, 0, 23,59,59);
      label = `${new Date(yr,mo).toLocaleString('default',{month:'long'})}_${yr}`;
    } else if (period === 'custom-year') {
      const yr = parseInt(document.getElementById('bexYear')?.value ?? now.getFullYear());
      start = new Date(yr, 0, 1);
      end   = new Date(yr, 11, 31, 23,59,59);
      label = String(yr);
    }

    // Filter allBookings by date range
    const filtered = allBookings.filter(b => {
      const d = new Date(b.date);
      return d >= start && d <= end;
    });

    if (filtered.length === 0) {
      showNotification('No bookings found for that period.', 'error');
      return;
    }

    // Build rows
    const header = ['Date','Start Time','End Time','Service','Client Name','Therapist','Duration (mins)','Price (₱)','Status'];
    const rows   = filtered.map(b => {
      const dateStr      = _dateLabel(b.date);
      const startTime    = b.time || '';
      const endTime      = b.endTime
        ? (b.endTime instanceof Date ? b.endTime.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit',hour12:true}) : b.endTime)
        : '';
      const service      = b.service?.name || b.service || '';
      const client       = b.guestName || '';
      const therapists   = b.therapists?.length
        ? b.therapists.map(t => t.name || t).join(' / ')
        : (b.therapist?.name || b.therapist || 'Unassigned');
      const duration     = b.durationMinutes || '';
      const price        = b.price || 0;
      const status       = b.status || '';
      return [dateStr, startTime, endTime, service, client, therapists, duration, price, status];
    });

    // Sort by date then time
    rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));

    const csv = _toCSV([header, ...rows]);
    _downloadCSV(csv, `Nagomi_Bookings_${label}.csv`);
    showNotification(` Exported ${filtered.length} bookings to Excel!`, 'success');
    document.getElementById('bookingExportModal')?.classList.remove('active');
  };

  // ── 2. COMMISSION / INCOME EXPORT ────────────────────────────────────────

  function exportIncomeReport() {
    const rate = commissionSettings.rate || 60;
    const now  = new Date();

    // ── If called from the detail modal: export THIS therapist, current modal period ──
    const isModalOpen = document.getElementById('incomeDetailModal')?.classList.contains('active');
    if (isModalOpen && _detailTherapistId && _detailBookings) {
      // Detect which period is shown inside the modal (period buttons re-render title)
      const titleText = document.getElementById('incomeDetailTitle')?.textContent || '';
      let period = currentIncomePeriod;
      if      (titleText.includes('Today'))      period = 'today';
      else if (titleText.includes('This Week'))  period = 'week';
      else if (titleText.includes('This Month')) period = 'month';
      else if (titleText.includes('This Year'))  period = 'year';

      const periodLabel = { today:'Today', week:'This_Week', month:'This_Month', year:'This_Year' }[period] || period;
      const filtered    = filterByPeriod(_detailBookings, period);

      if (filtered.length === 0) {
        showNotification('No completed bookings for this period.', 'error');
        return;
      }

      const header = [
        `Commission Report — ${_detailTherapistName} — ${periodLabel.replace(/_/g,' ')}`,
        '', '', '', ''
      ];
      const colHdr = ['Date', 'Service', 'Client', 'Duration (mins)', `Service Price (₱)`, `Commission (${rate}%) (₱)`];
      const rows   = filtered
        .slice().sort((a,b) => new Date(a.date) - new Date(b.date))
        .map(b => [
          _dateLabel(b.date),
          b.service?.name || '',
          b.guestName || '',
          b.durationMinutes || '',
          b.price || 0,
          Math.round((b.price||0) * (rate/100))
        ]);

      const totalRevenue    = filtered.reduce((s,b) => s+(b.price||0), 0);
      const totalCommission = filtered.reduce((s,b) => s+Math.round((b.price||0)*(rate/100)), 0);
      const totalsRow       = ['TOTAL', '', '', '', totalRevenue, totalCommission];
      const exportedLine    = [`Exported: ${now.toLocaleString('en-PH',{timeZone:'Asia/Manila'})}`, '', '', '', '', ''];

      const csv      = _toCSV([exportedLine, [], colHdr, ...rows, [], totalsRow]);
      const safeName = _detailTherapistName.replace(/[^a-z0-9]/gi, '_');
      _downloadCSV(csv, `Nagomi_Commission_${safeName}_${periodLabel}.csv`);
      showNotification(` Exported ${filtered.length} records for ${_detailTherapistName}!`, 'success');
      return;
    }

    // ── Fallback: export ALL therapists summary from Income tab ──────────────
    const periodLabels = { today:'Today', week:'This Week', month:'This Month', year:'This Year' };
    const periodLabel  = periodLabels[currentIncomePeriod] || currentIncomePeriod;
    const filtered     = filterByPeriod(allBookings || [], currentIncomePeriod)
      .filter(b => b.status === 'completed' && b.therapist);

    if (filtered.length === 0) {
      showNotification('No completed bookings to export for this period.', 'error');
      return;
    }

    const header = ['Date','Service','Client Name','Therapist','Duration (mins)',`Service Price (₱)`,`Commission (${rate}%) (₱)`,'Status'];
    const rows   = filtered
      .slice().sort((a,b) => new Date(a.date)-new Date(b.date))
      .map(b => [
        _dateLabel(b.date),
        b.service?.name || '',
        b.guestName || '',
        b.therapist?.name || b.therapist || '',
        b.durationMinutes || '',
        b.price || 0,
        Math.round((b.price||0)*(rate/100)),
        b.status
      ]);

    const byTherapist = {};
    filtered.forEach(b => {
      const name = b.therapist?.name || String(b.therapist) || 'Unknown';
      if (!byTherapist[name]) byTherapist[name] = { services:0, revenue:0, commission:0 };
      byTherapist[name].services++;
      byTherapist[name].revenue    += b.price || 0;
      byTherapist[name].commission += Math.round((b.price||0)*(rate/100));
    });

    const summaryHdr    = ['', 'SUMMARY BY THERAPIST', '','','','','',''];
    const summaryColHdr = ['Therapist','Completed Services',`Total Revenue (₱)`,`Total Commission (${rate}%) (₱)`,'','','',''];
    const summaryRows   = Object.entries(byTherapist)
      .sort((a,b)=>b[1].commission-a[1].commission)
      .map(([n,d])=>[n,d.services,d.revenue,d.commission,'','','','']);

    const exportedLine = [`Exported: ${now.toLocaleString('en-PH',{timeZone:'Asia/Manila'})} · Period: ${periodLabel}`, '','','','','','',''];
    const csv      = _toCSV([exportedLine, [], header, ...rows, [], summaryHdr, summaryColHdr, ...summaryRows]);
    _downloadCSV(csv, `Nagomi_Commission_All_${periodLabel.replace(/\s/g,'_')}_${_dateLabel(now)}.csv`);
    showNotification(` Exported ${filtered.length} records to Excel!`, 'success');
  }

  // UTILITY FUNCTIONS
  function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 90px;
      right: 20px;
      background: ${type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : '#007bff'};
      color: white;
      padding: 16px 24px;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10001;
      animation: slideIn 0.3s;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.style.animation = 'slideOut 0.3s';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }

  function hideLoader() {
    loader.style.opacity = 0;
    setTimeout(() => loader.style.display = "none", 600);
  }

  // Initialize dashboard — poll until Chart.js CDN is ready
  function initDashboard() {
    const todayBtn = document.querySelector('.filter-btn[data-period="today"]');
    if (todayBtn) {
      todayBtn.click();
    } else {
      loadOverviewData();
    }
  }

  (function waitForChart(attempts) {
    if (typeof Chart !== 'undefined') {
      initDashboard();
    } else if (attempts < 50) {
      setTimeout(function() { waitForChart(attempts + 1); }, 100);
    } else {
      console.error('Chart.js failed to load after 5s');
      hideLoader();
    }
  })(0);

  (function restoreCommissionInputs() {
    const savedRate = localStorage.getItem('nagomi_commissionRate');
    const savedBase = localStorage.getItem('nagomi_baseRate');
    if (savedRate) {
      const el = document.getElementById('commissionRate');
      if (el) el.value = savedRate;
    }
    if (savedBase) {
      const el = document.getElementById('baseRate');
      if (el) el.value = savedBase;
    }
  })();

  // Logout
  document.getElementById("logoutBtn").addEventListener("click", () => {
    socket.disconnect();
    localStorage.clear();
    window.location.href = "login.html";
  });

  // Make functions global for onclick handlers
  window.editService = editService;
  window.deleteService = deleteService;
  window.showAvailableTherapists = showAvailableTherapists;
  window.assignTherapist = assignTherapist;
  window.confirmBooking = confirmBooking;
  window.cancelBooking = cancelBooking;
  window.loadGracePeriods = loadGracePeriods;
  window.addGracePeriod = addGracePeriod;
  window.removeGracePeriod = removeGracePeriod;
  window.saveGracePeriods = saveGracePeriods;
  window.savePostServiceRest = savePostServiceRest;
  window.editTherapist = editTherapist;
  window.deleteTherapist = deleteTherapist;
  window.archiveTherapist = archiveTherapist;
  window.confirmArchiveTherapist = confirmArchiveTherapist;
  window.closeArchiveModal = closeArchiveModal;
  window.openArchivedTherapists = openArchivedTherapists;
  window.closeArchivedTherapists = closeArchivedTherapists;
  window.permanentlyDeleteArchive = permanentlyDeleteArchive;
  window.openScheduleModal = openScheduleModal;
  window.closeScheduleModal = closeScheduleModal;
  window.toggleDayWorking = toggleDayWorking;
  window.addShift = addShift;
  window.removeShift = removeShift;
  window.addDateOverride = addDateOverride;
  window.removeOverride = removeOverride;
  window.saveTherapistSchedule = saveTherapistSchedule;
  window.addBreak = addBreak;
  window.removeBreak = removeBreak;
  window.loadTherapistAnalytics = loadTherapistAnalytics;
  window.saveCommissionSettings = saveCommissionSettings;
  window.filterIncomeByPeriod = filterIncomeByPeriod;
  window.filterCardByPeriod   = filterCardByPeriod;
  window.showIncomeDetail = showIncomeDetail;
  window.closeIncomeDetail = closeIncomeDetail;
  window.exportIncomeReport = exportIncomeReport;
  window.generateBookingRow = generateBookingRow;
  window.addEventListener('beforeunload', () => {
    if (window.therapistStatusInterval) {
      clearInterval(window.therapistStatusInterval);
    }
  });
  window.showChartForecast = showChartForecast;
  window.loadComprehensiveAnalytics = loadComprehensiveAnalytics;
  window.updateLastUpdatedTimestamp = updateLastUpdatedTimestamp;
  window.toggleForecast = toggleForecast;
  window.showComprehensiveInsights = showComprehensiveInsights;
  window.updatePeriodRange = updatePeriodRange;
  window.loadEnhancedPredictions = loadEnhancedPredictions;
  window.createRevenueChart = createRevenueChart;
  window.loadReviewsManagement = loadReviewsManagement;
  window.filterReviews = filterReviews;
  window.clearBookingSearch = clearBookingSearch;
  window.navigateToBookingDate = navigateToBookingDate;
 window.filterServicesByCategory = filterServicesByCategory;
 window.toggleServiceVisibility  = toggleServiceVisibility;
 window.openAssignTherapist   = openAssignTherapist;
window.closeAssignTherapist  = closeAssignTherapist;
window.confirmAssignTherapist = confirmAssignTherapist;
window.loadClosures         = loadClosures;
window.renderClosurePanel   = renderClosurePanel;
window.openClosureModal     = openClosureModal;
window.closeClosureModal    = closeClosureModal;
window.confirmAddClosure    = confirmAddClosure;
window.deleteClosure        = deleteClosure;
window.openHolidayModal     = openHolidayModal;
window.closeHolidayModal    = closeHolidayModal;
window.confirmHolidayToggle = confirmHolidayToggle;
window.syncClosureEndMin    = syncClosureEndMin;
// ═══════════════════════════════════════════════════════════════════════
// NOTIFICATION SYSTEM
// ═══════════════════════════════════════════════════════════════════════

const notifStore = [];

// ── Notification persistence helpers ─────────────────────────────────────────
function saveNotifStore() {
  try { localStorage.setItem('nagomi_notifs', JSON.stringify(notifStore.slice(0,30))); } catch(e) {}
}
function loadNotifStore() {
  try {
    const saved = localStorage.getItem('nagomi_notifs');
    if (saved) {
      const parsed = JSON.parse(saved);
      parsed.forEach(n => notifStore.push(n));
    }
  } catch(e) {}
}
loadNotifStore(); // Restore on page load

function addNotif(message, type = 'booking', targetTab = null) {
  const icons = { booking: '', cancel: '', reschedule: '', leave: '', general: 'ℹ️' };
  notifStore.unshift({ message, type, icon: icons[type] || '', time: new Date(), read: false, targetTab });
  if (notifStore.length > 30) notifStore.pop();
  saveNotifStore();
  renderNotifPanel();
  // Flash badge
  const badge = document.getElementById('notifBadge');
  const unread = notifStore.filter(n => !n.read).length;
  if (badge) {
    badge.textContent = unread > 9 ? '9+' : unread;
    badge.style.display = unread > 0 ? 'flex' : 'none';
  }
  // Pulse animation on bell
  const bellBtn = document.querySelector('#notifBellWrap button');
  if (bellBtn) {
    bellBtn.classList.add('notif-bell-pulse');
    setTimeout(() => bellBtn.classList.remove('notif-bell-pulse'), 1000);
  }
}

function renderNotifPanel() {
  const list = document.getElementById('notifList');
  if (!list) return;
  if (notifStore.length === 0) {
    list.innerHTML = '<p style="color:#999;font-size:0.85rem;padding:16px;text-align:center;">No new notifications</p>';
    return;
  }
  list.innerHTML = notifStore.map((n, i) => {
    const mins = Math.floor((new Date() - new Date(n.time)) / 60000);
    const ago = mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : mins < 1440 ? `${Math.floor(mins/60)}h ago` : `${Math.floor(mins/1440)}d ago`;
    const clickable = n.targetTab ? `onclick="handleNotifClick(${i})" style="cursor:pointer;"` : '';
    const arrow = n.targetTab ? `<span style="color:#c9a882;font-size:0.8rem;margin-left:auto;padding-left:8px;">→</span>` : '';
    return `<div class="notif-item ${n.read ? 'notif-read' : ''}" ${clickable}>
      <span class="notif-item-icon">${n.icon}</span>
      <div class="notif-item-body" style="flex:1;min-width:0;">
        <div class="notif-item-msg">${n.message}</div>
        <div class="notif-item-time">${ago}</div>
      </div>
      ${arrow}
    </div>`;
  }).join('');
}

function handleNotifClick(index) {
  const n = notifStore[index];
  if (!n) return;
  n.read = true;
  saveNotifStore();
  renderNotifPanel();
  // Close panel
  const panel = document.getElementById('notifPanel');
  if (panel) panel.style.display = 'none';
  // Navigate to target tab
  if (n.targetTab) switchTab(n.targetTab);
}

function toggleNotifPanel() {
  const panel = document.getElementById('notifPanel');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen) {
    // Mark all read
    notifStore.forEach(n => n.read = true);
    const badge = document.getElementById('notifBadge');
    if (badge) badge.style.display = 'none';
    renderNotifPanel();
  }
}

function clearNotifs() {
  notifStore.length = 0;
  renderNotifPanel();
  const badge = document.getElementById('notifBadge');
  if (badge) badge.style.display = 'none';
}

// Close panel when clicking outside
document.addEventListener('click', (e) => {
  const wrap = document.getElementById('notifBellWrap');
  if (wrap && !wrap.contains(e.target)) {
    const panel = document.getElementById('notifPanel');
    if (panel) panel.style.display = 'none';
  }
});

// Wire Socket.IO to notifications
(function wireNotifSocket() {
  const BACKEND = 'https://nagomi-backend.onrender.com';
  let sock = null;
  let attempts = 0;
  const MAX_ATTEMPTS = 10;

  function attachEvents(socket) {
    socket.on('connect', () => {
      console.log(' Connected to server');
      attempts = 0;
    });
    // Note: new-booking, booking-cancelled, reschedule-request, leave-request
    // are now handled by the primary socket at the top of the file.
    // wireNotifSocket only handles connect/error for the secondary health-check socket.
    socket.on('connect', () => {
      console.log('[notif-socket] connected');
    });
    socket.on('connect_error', () => {
      // Silently suppress — server may still be waking up
    });
  }

  function tryConnect() {
    if (typeof io === 'undefined' || attempts >= MAX_ATTEMPTS) return;
    attempts++;
    try {
      // First ping /health — only connect socket if server is actually up
      fetch(`${BACKEND}/health`, { signal: AbortSignal.timeout(4000) })
        .then(r => {
          if (!r.ok) throw new Error('not ready');
          // Server is up — connect socket
          if (sock) sock.disconnect();
          sock = io(BACKEND, {
            transports: ['websocket'], // skip polling to avoid CORS on 502s
            reconnectionDelay: 5000,
            reconnectionAttempts: 5,
          });
          attachEvents(sock);
        })
        .catch(() => {
          // Server still sleeping — retry in 8s
          if (attempts < MAX_ATTEMPTS) setTimeout(tryConnect, 8000);
        });
    } catch(e) { /* io not ready yet */ }
  }

  // Wait 3s after page load before first attempt (let server wake up first)
  const checkIo = setInterval(() => {
    if (typeof io !== 'undefined') {
      clearInterval(checkIo);
      setTimeout(tryConnect, 3000);
    }
  }, 500);
})();


// Sync sidebar admin name
(function syncSidebarName() {
  const el = document.getElementById('adminName');
  const sidebar = document.getElementById('sidebarAdminName');
  if (el && sidebar) {
    const obs = new MutationObserver(() => { sidebar.textContent = el.textContent; });
    obs.observe(el, { childList: true, characterData: true, subtree: true });
    sidebar.textContent = el.textContent;
  }
})();

// ═══════════════════════════════════════════════════════════════════════
// MANAGE ARCHIVE MODAL
// ═══════════════════════════════════════════════════════════════════════

let _archiveTab = 'active'; // 'active' | 'archived'

async function openManageArchiveModal() {
  document.getElementById('manageArchiveModal').classList.add('active');
  switchArchiveTab('active');
}

function closeManageArchiveModal() {
  document.getElementById('manageArchiveModal').classList.remove('active');
}

function closeManageArchiveOnBackdrop(e) {
  if (e.target === document.getElementById('manageArchiveModal')) closeManageArchiveModal();
}

async function switchArchiveTab(tab) {
  _archiveTab = tab;
  document.getElementById('archiveTabActive').classList.toggle('active', tab === 'active');
  document.getElementById('archiveTabArchived').classList.toggle('active', tab === 'archived');
  const list = document.getElementById('manageArchiveList');
  list.innerHTML = '<p style="color:#999;text-align:center;padding:32px;">Loading...</p>';

  if (tab === 'active') {
    // Load active therapists from API
    try {
      const res = await fetch(`${apiBase}/therapists`, { headers: { Authorization: `Bearer ${token}` } });
      const all = await res.json();
      const archivedIds = new Set(JSON.parse(localStorage.getItem('nagomi_archivedTherapists') || '[]').map(a => a.id));
      const active = all.filter(t => t.isActive !== false && !archivedIds.has(t._id));
      if (active.length === 0) {
        list.innerHTML = '<p style="color:#999;text-align:center;padding:32px;">No active therapists</p>';
        return;
      }
      list.innerHTML = active.map(t => `
        <div class="archive-list-row">
          <div class="archive-row-avatar"></div>
          <div class="archive-row-info">
            <div class="archive-row-name">${t.name}</div>
            <div class="archive-row-email">${t.email}</div>
          </div>
          <button class="btn-archive archive-row-btn"
            onclick="archiveTherapist('${t._id}','${t.name.replace(/'/g,"\\'")}');closeManageArchiveModal();">
            ️ Archive
          </button>
        </div>`).join('');
    } catch(e) {
      list.innerHTML = '<p style="color:#dc3545;text-align:center;padding:32px;">Failed to load therapists</p>';
    }
  } else {
    // Show archived from localStorage
    const archives = JSON.parse(localStorage.getItem('nagomi_archivedTherapists') || '[]').slice().reverse();
    if (archives.length === 0) {
      list.innerHTML = '<p style="color:#999;text-align:center;padding:32px;">No archived therapists yet</p>';
      return;
    }
    const realIdxOf = (t) => archives.length - 1 - archives.indexOf(t);
    list.innerHTML = archives.map((t, i) => {
      const realIdx = archives.length - 1 - i;
      const date = new Date(t.archiveDate).toLocaleDateString('en-PH', { year:'numeric', month:'short', day:'numeric' });
      return `
        <div class="archive-list-row">
          <div class="archive-row-avatar" style="opacity:0.6;"></div>
          <div class="archive-row-info">
            <div class="archive-row-name" style="color:#888;">${t.name}</div>
            <div class="archive-row-email">${t.email} · Archived ${date}</div>
            <div class="archive-row-reason" style="font-size:0.78rem;color:#aaa;margin-top:2px;">${t.archiveReason || ''}</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            <button class="btn-schedule" style="font-size:0.78rem;padding:5px 10px;"
              onclick="unarchiveTherapist(${realIdx});closeManageArchiveModal();">️ Restore</button>
            <button class="btn-delete" style="font-size:0.78rem;padding:5px 10px;"
              onclick="permanentlyDeleteArchive(${realIdx});switchArchiveTab('archived');">️</button>
          </div>
        </div>`;
    }).join('');
  }
}

// ═══════════════════════════════════════════════════════════════════════
// LEAVE & OVERTIME REQUESTS
// ═══════════════════════════════════════════════════════════════════════

async function loadLeaveRequests() {
  const container = document.getElementById('leaveRequestsList');
  if (!container) return;
  container.innerHTML = '<p style="color:#999;text-align:center;padding:40px;">Loading requests...</p>';

  try {
    const res = await fetch(`${apiBase}/therapists/leave-requests/all`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('API not available');
    const requests = await res.json();

    // Clear badge
    const badge = document.getElementById('leaveSidebarBadge');
    if (badge) badge.style.display = 'none';

    if (!requests || requests.length === 0) {
      container.innerHTML = `
        <div style="text-align:center;padding:60px;color:#999;">
          <div style="font-size:3rem;margin-bottom:12px;"></div>
          <p style="font-size:1.1rem;">No pending leave or overtime requests</p>
        </div>`;
      return;
    }

    const pending   = requests.filter(r => r.status === 'pending');
    const reviewed  = requests.filter(r => r.status !== 'pending');

    container.innerHTML = '';

    if (pending.length > 0) {
      container.innerHTML += `<h3 style="color:#4b2e1e;font-family:'Playfair Display',serif;margin-bottom:12px;">⏳ Pending (${pending.length})</h3>`;
      container.innerHTML += pending.map(r => renderLeaveCard(r)).join('');
    }

    if (reviewed.length > 0) {
      container.innerHTML += `<h3 style="color:#888;font-family:'Playfair Display',serif;margin:24px 0 12px;"> Previously Reviewed</h3>`;
      container.innerHTML += reviewed.map(r => renderLeaveCard(r)).join('');
    }
  } catch(e) {
    container.innerHTML = `
      <div style="background:#fff3cd;border:1px solid #ffc107;border-radius:12px;padding:24px;text-align:center;">
        <div style="font-size:2rem;margin-bottom:8px;">ℹ️</div>
        <p style="color:#856404;font-weight:600;">Leave request system not yet connected to the backend.</p>
        <p style="color:#856404;font-size:0.9rem;margin-top:6px;">Add the <code>/api/therapists/leave-requests/all</code> route to your backend to enable this feature.</p>
      </div>`;
  }
}

function renderLeaveCard(r) {
  const typeLabel = { leave: ' Leave', vacation: '️ Vacation', overtime: '⏰ Overtime' }[r.type] || r.type;
  const statusColor = { pending:'#ff9800', approved:'#28a745', rejected:'#dc3545' }[r.status] || '#666';
  const statusLabel = { pending:'⏳ Pending', approved:' Approved', rejected:' Rejected' }[r.status] || r.status;

  return `
    <div style="background:#fff;border-radius:14px;padding:20px 24px;box-shadow:0 2px 8px rgba(0,0,0,0.07);
      border-left:4px solid ${statusColor};margin-bottom:12px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
        <div>
          <div style="font-weight:700;font-size:1rem;color:#4b2e1e;">${r.therapistName || 'Therapist'}</div>
          <div style="font-size:0.85rem;color:#8b6f47;margin-top:2px;">${typeLabel}</div>
        </div>
        <span style="background:${statusColor}20;color:${statusColor};padding:4px 12px;border-radius:20px;
          font-size:0.78rem;font-weight:700;border:1px solid ${statusColor}40;">${statusLabel}</span>
      </div>
      <div style="margin-top:12px;display:flex;gap:24px;flex-wrap:wrap;font-size:0.85rem;color:#666;">
        <span> <strong>From:</strong> ${r.startDate ? new Date(r.startDate).toLocaleDateString('en-PH') : '—'}</span>
        <span> <strong>To:</strong> ${r.endDate ? new Date(r.endDate).toLocaleDateString('en-PH') : '—'}</span>
        ${r.hours ? `<span>⏱ <strong>Hours:</strong> ${r.hours}</span>` : ''}
      </div>
      ${r.reason ? `<div style="margin-top:10px;padding:10px;background:#faf6f1;border-radius:8px;font-size:0.88rem;color:#555;">${r.reason}</div>` : ''}
      ${r.status === 'pending' ? `
        <div style="margin-top:14px;display:flex;gap:8px;">
          <button onclick="reviewLeaveRequest('${r._id}','approved')"
            style="background:#28a745;color:#fff;border:none;padding:8px 20px;border-radius:8px;cursor:pointer;font-weight:600;font-size:0.85rem;">
             Approve
          </button>
          <button onclick="reviewLeaveRequest('${r._id}','rejected')"
            style="background:#dc3545;color:#fff;border:none;padding:8px 20px;border-radius:8px;cursor:pointer;font-weight:600;font-size:0.85rem;">
             Reject
          </button>
        </div>` : ''}
    </div>`;
}

async function reviewLeaveRequest(id, decision) {
  try {
    const res = await fetch(`${apiBase}/therapists/leave-requests/${id}/${decision}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Failed');
    showNotification(`Request ${decision === 'approved' ? 'approved ' : 'rejected '}`, decision === 'approved' ? 'success' : 'error');
    loadLeaveRequests();
  } catch(e) {
    showNotification('Failed to update request', 'error');
  }
}

// Expose new functions
window.toggleNotifPanel      = toggleNotifPanel;
window.clearNotifs           = clearNotifs;
window.openManageArchiveModal    = openManageArchiveModal;
window.closeManageArchiveModal   = closeManageArchiveModal;
window.closeManageArchiveOnBackdrop = closeManageArchiveOnBackdrop;
window.switchArchiveTab      = switchArchiveTab;
window.loadLeaveRequests     = loadLeaveRequests;
window.reviewLeaveRequest    = reviewLeaveRequest;