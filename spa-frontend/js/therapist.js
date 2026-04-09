// js/therapist.js - Commission-based payroll + strict completion enforcement
const apiBase = 'https://nagomi-backend.onrender.com/api';
const token = localStorage.getItem("token");
const user = JSON.parse(localStorage.getItem("user") || "{}");

// Protect route
if (!token || user.role !== "therapist") {
  window.location.replace("login.html");
}

const loader = document.getElementById("loader");
let allBookings = [];
let therapistProfile = null;   // ✅ NEW: stores full profile (weeklySchedule, dateOverrides)
let appointmentToComplete = null;
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let selectedDate = new Date().toDateString();
let timeUpdateInterval = null;

// Socket.IO connection
const socket = io('https://nagomi-backend.onrender.com', {
  transports: ['websocket', 'polling']
});

socket.on('connect', () => {
  console.log('✅ Connected to server');
  socket.emit('join', { userId: user._id, role: user.role });
});

socket.on('newAssignment', (data) => {
  console.log('🆕 New appointment assigned!', data);
  showNotification('You have a new appointment!', 'success');
  playNotificationSound();
  loadTherapistData();
});

socket.on('appointmentUpdated', () => loadTherapistData());
socket.on('appointmentRemoved', () => {
  showNotification('An appointment was reassigned', 'warning');
  loadTherapistData();
});

// ── Re-sync profile + calendar when leave is approved or rejected ─────────
socket.on('leave-approved', (data) => {
  if (!data || data.therapistId !== user._id) return;
  showNotification('🌴 Your leave request was approved!', 'success');
  loadTherapistData(); // refreshes profile → dateOverrides → calendar
});
socket.on('leave-rejected', (data) => {
  if (!data || data.therapistId !== user._id) return;
  showNotification('❌ Your leave request was not approved.', 'error');
});

// Display welcome message
document.getElementById("welcomeMessage").textContent = `Welcome back, ${user.name}!`;
document.getElementById("dashboardSubtitle").textContent = `Here's your dashboard overview, ${user.name}`;

// ── Load therapist profile (schedule, dateOverrides) ───────────────────────
async function loadTherapistProfile() {
  try {
    const res = await fetch(`${apiBase}/therapists/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error('Profile unavailable');
    therapistProfile = await res.json();
  } catch (err) {
    console.warn('Could not load therapist profile:', err.message);
    therapistProfile = null;
  }
}

// ── Day-off helpers ────────────────────────────────────────────────────────

// Returns the name of the therapist's weekly day off, or null if none set.
function getWeeklyDayOff() {
  if (!therapistProfile?.weeklySchedule?.length) return null;
  const dayOff = therapistProfile.weeklySchedule.find(d => !d.isWorking);
  return dayOff ? dayOff.dayOfWeek : null;
}

// Returns true if the given YYYY-MM-DD date is the therapist's day off.
// Priority: dateOverride (specific date) > approved leaves > weekly schedule.
function isTherapistDayOff(dateStr) {
  if (!therapistProfile) return false;

  // 1. Check dateOverrides first (admin-set specific dates)
  if (therapistProfile.dateOverrides?.length) {
    const override = therapistProfile.dateOverrides.find(o => {
      const d = new Date(o.date);
      const oStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      return oStr === dateStr;
    });
    if (override) return !override.isWorking;
  }

  // 2. Check approved leave requests (startDate → endDate range)
  if (therapistProfile.leaveRequests?.length) {
    const checkDate = new Date(dateStr + 'T12:00:00');
    const onLeave = therapistProfile.leaveRequests.some(lr => {
      if (lr.status !== 'approved') return false;
      const start = new Date(lr.startDate);
      const end   = new Date(lr.endDate);
      start.setHours(0,0,0,0);
      end.setHours(23,59,59,999);
      return checkDate >= start && checkDate <= end;
    });
    if (onLeave) return true;
  }

  // 3. Fall back to weekly schedule
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const dayName  = dayNames[new Date(dateStr + 'T12:00:00').getDay()];
  const schedDay = therapistProfile.weeklySchedule?.find(d => d.dayOfWeek === dayName);
  if (schedDay) return !schedDay.isWorking;

  return false;
}

// ── Load therapist data ────────────────────────────────────────────────────
async function loadTherapistData() {
  try {
    // ✅ Load profile + bookings in parallel
    const [_, bookingsRes] = await Promise.all([
      loadTherapistProfile(),
      fetch(`${apiBase}/bookings/my-appointments`, {
        headers: { Authorization: `Bearer ${token}` }
      })
    ]);

    if (!bookingsRes.ok) throw new Error('Failed to fetch appointments');
    allBookings = await bookingsRes.json();

    const today = new Date().toDateString();
    const todayBookings = allBookings.filter(b =>
      new Date(b.date).toDateString() === today
    );
    const upcomingBookings = allBookings.filter(b =>
      (b.status === 'pending' || b.status === 'confirmed') &&
      new Date(b.date) >= new Date()
    );
    const completedToday = todayBookings.filter(b => b.status === 'completed');

    document.getElementById("todayAppointments").textContent = todayBookings.length;
    document.getElementById("upcomingCount").textContent = upcomingBookings.length;
    document.getElementById("completedCount").textContent = completedToday.length;

    await loadCommissionSummary();

    renderCalendar();
    displayAppointmentsForDate(today);

    setTimeout(() => {
      loader.style.opacity = 0;
      setTimeout(() => loader.style.display = "none", 600);
    }, 800);

  } catch (err) {
    console.error(err);
    alert("Failed to load your appointments. Please try again.");
    loader.style.display = "none";
  }
}

// ── Commission summary (stat card) ────────────────────────────────────────
async function loadCommissionSummary() {
  try {
    const res = await fetch(`${apiBase}/payroll/my-summary`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) throw new Error('Payroll unavailable');
    const data = await res.json();
    window._payrollSummary = data;

    const earned = data.currentPeriod.commissionEarned || 0;
    document.getElementById('todayRevenue').textContent = `₱${earned.toLocaleString()}`;

    const labelEl = document.getElementById('commissionPeriodLabel');
    if (labelEl) {
      const start = new Date(data.currentPeriod.start);
      const end   = new Date(data.currentPeriod.end);
      const fmt   = d => d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
      const type  = data.therapist.paySchedule === 'weekly' ? 'This week' : 'This pay period';
      labelEl.textContent = `${type} (${fmt(start)}–${fmt(end)})`;
    }

  } catch (err) {
    console.warn('Commission summary unavailable — showing ₱0');
    document.getElementById('todayRevenue').textContent = '₱0';
    const labelEl = document.getElementById('commissionPeriodLabel');
    if (labelEl) labelEl.textContent = 'Commission-based';
  }
}

// ── Payroll history panel ──────────────────────────────────────────────────
async function showPayrollPanel() {
  // Show as modal overlay instead of inline panel
  let modal = document.getElementById('payrollModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'payrollModal';
    modal.style.cssText = 'display:none;position:fixed;inset:0;z-index:10200;background:rgba(20,10,4,0.72);backdrop-filter:blur(4px);align-items:center;justify-content:center;padding:20px;overflow-y:auto;';
    modal.innerHTML = '<div id="payrollModalInner" style="background:#fdfaf5;border-radius:16px;width:100%;max-width:700px;max-height:88vh;overflow-y:auto;padding:28px;box-shadow:0 20px 60px rgba(0,0,0,0.35);margin:auto;border-top:3px solid #b8933a;"></div>';
    modal.addEventListener('click', e => { if (e.target === modal) modal.style.display = 'none'; });
    document.body.appendChild(modal);
  }
  modal.style.display = 'flex';
  const panel = document.getElementById('payrollModalInner');
  if (!panel) return;
  panel.innerHTML = '<div style="text-align:center;padding:30px;color:#6b3f2a;">Loading payroll history...</div>';

  try {
    const [summaryRes, historyRes] = await Promise.all([
      fetch(`${apiBase}/payroll/my-summary`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${apiBase}/payroll/my-history`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);

    if (!summaryRes.ok || !historyRes.ok) throw new Error('Payroll data unavailable');

    const summary = await summaryRes.json();
    const history = await historyRes.json();

    const nextPay    = new Date(summary.currentPeriod.nextPayDate);
    const nextPayFmt = nextPay.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric' });
    const schedText  = summary.therapist.paySchedule === 'weekly'
      ? '📅 You are on <strong>weekly pay</strong> (every Friday)'
      : '📅 You are on <strong>semi-monthly pay</strong> (15th & last day of month)';

    const historyRows = history.history.map(p => `
      <tr style="border-bottom:1px solid #f0f0f0;">
        <td style="padding:11px 14px;color:#333;">${p.label}</td>
        <td style="padding:11px 14px;text-align:right;color:#555;">${p.count}</td>
        <td style="padding:11px 14px;text-align:right;color:#555;">₱${(p.totalRevenue || 0).toLocaleString()}</td>
        <td style="padding:11px 14px;text-align:right;font-weight:700;color:#2d6a4f;">
          ₱${(p.commissionEarned || 0).toLocaleString()}
        </td>
      </tr>
    `).join('');

    const summaryCards = [
      { label: 'Services This Period', value: summary.currentPeriod.count,                                        icon: '💆', hi: false },
      { label: 'Revenue Generated',    value: `₱${(summary.currentPeriod.totalRevenue || 0).toLocaleString()}`,   icon: '💵', hi: false },
      { label: 'Your Commission',      value: `₱${(summary.currentPeriod.commissionEarned || 0).toLocaleString()}`, icon: '💰', hi: true  },
      { label: 'This Month Total',     value: `₱${(summary.thisMonth.commissionEarned || 0).toLocaleString()}`,    icon: '📆', hi: false },
    ];

    panel.innerHTML = `
      <div style="
        background: white;
        border-radius: 16px;
        padding: 28px;
        box-shadow: 0 4px 24px rgba(0,0,0,0.12);
        margin: 12px 0 28px 0;
      ">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:22px;flex-wrap:wrap;gap:12px;">
          <h2 style="color:#4b2e1e;margin:0;font-size:1.35rem;">💰 Commission & Payroll</h2>
          <button onclick="document.getElementById('payrollModal').style.display='none'"
            style="background:#f5f1eb;color:#4b2e1e;border:none;padding:8px 18px;border-radius:8px;cursor:pointer;font-weight:600;font-size:0.9rem;">
            ✕ Close
          </button>
        </div>

        <div style="background:#f5f1eb;border-radius:10px;padding:16px 20px;margin-bottom:22px;border-left:4px solid #c8a882;">
          <p style="margin:0 0 5px 0;color:#4b2e1e;font-size:0.95rem;">${schedText}</p>
          <p style="margin:0 0 4px 0;color:#555;font-size:0.88rem;">🗓️ Next pay date: <strong>${nextPayFmt}</strong></p>
          <p style="margin:0;color:#555;font-size:0.88rem;">📊 Commission rate: <strong>${summary.therapist.commissionRate}%</strong> of completed service price</p>
          ${summary.therapist.payrollNotes
            ? `<p style="margin:5px 0 0 0;color:#888;font-size:0.82rem;font-style:italic;">📝 ${summary.therapist.payrollNotes}</p>`
            : ''}
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:26px;">
          ${summaryCards.map(c => `
            <div style="
              background:${c.hi ? '#d4edda' : '#f8f9fa'};
              border:1px solid ${c.hi ? '#a3c9b0' : '#e9ecef'};
              border-radius:12px;padding:18px 14px;text-align:center;">
              <div style="font-size:1.7rem;margin-bottom:8px;">${c.icon}</div>
              <div style="font-size:1.25rem;font-weight:700;color:${c.hi ? '#2d6a4f' : '#333'};">${c.value}</div>
              <div style="font-size:0.78rem;color:#666;margin-top:4px;">${c.label}</div>
            </div>
          `).join('')}
        </div>

        <h3 style="color:#4b2e1e;margin:0 0 14px 0;font-size:1.05rem;">📋 Pay Period History</h3>
        <div style="overflow-x:auto;border-radius:10px;border:1px solid #f0f0f0;">
          <table style="width:100%;border-collapse:collapse;font-size:0.88rem;">
            <thead>
              <tr style="background:#f5f1eb;">
                <th style="padding:11px 14px;text-align:left;color:#4b2e1e;font-weight:600;">Pay Period</th>
                <th style="padding:11px 14px;text-align:right;color:#4b2e1e;font-weight:600;">Services</th>
                <th style="padding:11px 14px;text-align:right;color:#4b2e1e;font-weight:600;">Revenue</th>
                <th style="padding:11px 14px;text-align:right;color:#4b2e1e;font-weight:600;">Commission Earned</th>
              </tr>
            </thead>
            <tbody>
              ${historyRows || `<tr><td colspan="4" style="text-align:center;padding:22px;color:#999;">No history yet</td></tr>`}
            </tbody>
          </table>
        </div>

        <p style="margin:14px 0 0 0;font-size:0.78rem;color:#aaa;text-align:center;">
          Includes completed sessions only &nbsp;•&nbsp; ${summary.therapist.commissionRate}% commission rate
        </p>
      </div>
    `;

  } catch (err) {
    console.error(err);
    panel.innerHTML = `
      <div style="background:white;border-radius:12px;padding:24px;text-align:center;color:#c62828;margin:12px 0;">
        ⚠️ Could not load payroll data. Please try again later.
        <br><button onclick="document.getElementById('payrollModal').style.display='none'"
          style="margin-top:12px;background:#eee;border:none;padding:8px 16px;border-radius:6px;cursor:pointer;">
          Close
        </button>
      </div>`;
  }
}

// ── Calendar ───────────────────────────────────────────────────────────────
function renderCalendar() {
  const monthNames = ["January","February","March","April","May","June",
    "July","August","September","October","November","December"];

  document.getElementById('currentMonth').textContent = `${monthNames[currentMonth]} ${currentYear}`;

  const firstDay      = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth   = new Date(currentYear, currentMonth + 1, 0).getDate();
  const prevMonthDays = new Date(currentYear, currentMonth, 0).getDate();
  const calendarDays  = document.getElementById('calendarDays'); // ✅ fixed: was "calendarGrid"
  calendarDays.innerHTML = '';

  // Trailing days from previous month
  for (let i = prevMonthDays - firstDay + 1; i <= prevMonthDays; i++) {
    const d = document.createElement('div');
    d.className = 'calendar-day other-month';
    d.textContent = i;
    calendarDays.appendChild(d);
  }

  // Days of current month
  for (let day = 1; day <= daysInMonth; day++) {
    const dayCell = document.createElement('div');
    dayCell.className = 'calendar-day';

    const dateStr  = `${currentYear}-${String(currentMonth + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    const isDayOff = isTherapistDayOff(dateStr);  // ✅ NEW

    const hasBookings = allBookings.some(b =>
      new Date(b.date).toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) === dateStr
    );

    if (hasBookings) dayCell.classList.add('has-appointments');
    if (isDayOff)    dayCell.classList.add('day-off');       // ✅ NEW: matches legend CSS

    dayCell.innerHTML = `
      <span class="day-number">${day}</span>
      ${isDayOff ? `<span class="day-off-badge">😴<br>Day Off</span>` : ''}
    `;

    if (isDayOff) {
      dayCell.style.cursor = 'not-allowed';
      dayCell.title = 'Your scheduled day off';
    } else {
      dayCell.addEventListener('click', () => selectDate(dateStr, dayCell));
    }

    calendarDays.appendChild(dayCell);  // ✅ fixed: was "calendarGrid"
  }

  // Leading days for next month
  const cellsUsed = firstDay + daysInMonth;
  for (let i = 1; i <= 42 - cellsUsed; i++) {
    const d = document.createElement('div');
    d.className = 'calendar-day other-month';
    d.textContent = i;
    calendarDays.appendChild(d);
  }
}

// ── Select date ────────────────────────────────────────────────────────────
function selectDate(dateStr, dayCell) {
  document.querySelectorAll('.calendar-day.selected')
    .forEach(el => el.classList.remove('selected'));
  dayCell.classList.add('selected');
  selectedDate = new Date(dateStr + 'T12:00:00').toDateString();
  displayAppointmentsForDate(selectedDate);
}

// ── Appointment time status ────────────────────────────────────────────────
function getAppointmentTimeStatus(booking) {
  const now           = new Date();
  const bookingDate   = new Date(booking.date);
  const [time, period] = booking.time.split(' ');
  let [hours, minutes] = time.split(':').map(Number);

  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;

  const appointmentStart = new Date(bookingDate);
  appointmentStart.setHours(hours, minutes, 0, 0);

  const appointmentEnd    = new Date(appointmentStart.getTime() + booking.durationMinutes * 60 * 1000);
  const minutesUntilStart = Math.round((appointmentStart - now) / 60000);
  const minutesUntilEnd   = Math.round((appointmentEnd - now) / 60000);
  const minutesSinceEnd   = Math.round((now - appointmentEnd) / 60000);

  return {
    appointmentStart,
    appointmentEnd,
    minutesUntilStart,
    minutesUntilEnd,
    minutesSinceEnd,
    isBeforeStart:       now < appointmentStart,
    isDuringAppointment: now >= appointmentStart && now < appointmentEnd,
    isAfterEnd:          now >= appointmentEnd,
    canComplete:         now >= appointmentEnd,
  };
}

function formatTimeRemaining(minutes) {
  if (minutes < 0) return '';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatEndTime(appointmentEnd) {
  const h   = appointmentEnd.getHours();
  const m   = appointmentEnd.getMinutes();
  const per = h >= 12 ? 'PM' : 'AM';
  const dh  = h > 12 ? h - 12 : (h === 0 ? 12 : h);
  return `${dh}:${m.toString().padStart(2,'0')} ${per}`;
}

// ── Appointments for date ──────────────────────────────────────────────────
function displayAppointmentsForDate(dateStr) {
  if (timeUpdateInterval) clearInterval(timeUpdateInterval);

  const dayBookings = allBookings
    .filter(b => new Date(b.date).toDateString() === dateStr)
    .sort((a, b) => convertTo24Hour(a.time) - convertTo24Hour(b.time));

  const appointmentsList = document.getElementById('appointmentsList');

  if (dayBookings.length === 0) {
    appointmentsList.innerHTML = `
      <div style="text-align:center;padding:60px 20px;color:white;">
        <div style="font-size:3rem;margin-bottom:20px;">📅</div>
        <p style="font-size:1.2rem;">No appointments for this date</p>
      </div>`;
    return;
  }

  renderAppointmentsList(dayBookings);
  timeUpdateInterval = setInterval(() => renderAppointmentsList(dayBookings), 60000);
}

function renderAppointmentsList(dayBookings) {
  const appointmentsList = document.getElementById('appointmentsList');

  appointmentsList.innerHTML = dayBookings.map(b => {
    const clientName  = b.guestName || (b.client ? b.client.name : "Guest");
    const serviceName = b.service ? b.service.name : "Service";
    const duration    = b.durationMinutes || 60;
    const numClients  = b.numberOfClients || 1;

    const coTherapists = (b.therapists && b.therapists.length > 1)
      ? b.therapists.filter(t => t._id !== user._id).map(t => t.name)
      : [];

    const ts          = getAppointmentTimeStatus(b);
    const isCompleted = b.status === 'completed';

    let buttonDisabled = true, buttonText = 'Mark as Complete', buttonClass = 'btn-complete';
    let timeMessage = '', timeBadgeClass = '';

    if (isCompleted) {
      buttonText = '✅ Completed'; buttonClass = 'btn-complete disabled';
      timeMessage = '✅ Appointment completed'; timeBadgeClass = 'time-badge-completed';
    } else if (ts.isBeforeStart) {
      buttonText = 'Appointment not started'; buttonClass = 'btn-complete disabled';
      timeMessage = `⏳ Starts in ${formatTimeRemaining(ts.minutesUntilStart)} at ${b.time}`;
      timeBadgeClass = 'time-badge-waiting';
    } else if (ts.isDuringAppointment) {
      buttonText = `In Progress (${formatTimeRemaining(ts.minutesUntilEnd)} left)`;
      buttonClass = 'btn-complete disabled in-progress';
      timeMessage = `🔴 Session in progress - ends at ${formatEndTime(ts.appointmentEnd)}`;
      timeBadgeClass = 'time-badge-active';
    } else if (ts.isAfterEnd) {
      buttonDisabled = false;
      buttonText = '✅ Mark as Complete'; buttonClass = 'btn-complete enabled';
      timeMessage = ts.minutesSinceEnd <= 30
        ? '✅ Session ended - ready to complete'
        : `⚠️ Session ended ${formatTimeRemaining(ts.minutesSinceEnd)} ago - please complete`;
      timeBadgeClass = ts.minutesSinceEnd <= 30 ? 'time-badge-ready' : 'time-badge-overdue';
    }

    return `
      <div class="appointment-card ${ts.isDuringAppointment ? 'in-progress' : ''} ${ts.isAfterEnd && !isCompleted ? 'ready-to-complete' : ''}">
        <div class="appointment-header">
          <div class="appointment-time">${b.time}</div>
          <span class="status-badge status-${isCompleted ? 'completed' : 'upcoming'}">${isCompleted ? 'Completed' : 'Upcoming'}</span>
        </div>

        ${timeMessage ? `<div class="time-status-banner ${timeBadgeClass}">${timeMessage}</div>` : ''}

        <div class="client-name">${clientName.toUpperCase()}</div>
        <div class="service-name">${serviceName}</div>

        ${coTherapists.length > 0 ? `
          <div class="co-therapists" style="
            display:flex;align-items:center;gap:8px;padding:8px 12px;
            background:#e3f2fd;border-left:3px solid #2196f3;
            border-radius:6px;margin:8px 0;font-size:0.9rem;">
            <span style="font-weight:600;color:#1565c0;">👥 Co-therapists:</span>
            <span style="color:#424242;">${coTherapists.join(', ')}</span>
          </div>` : ''}

        <div class="appointment-details">
          <span class="duration-icon">⏱</span>
          <span>${duration} mins</span>
          ${numClients > 1 ? `<span>• ${numClients} clients</span>` : ''}
        </div>

        <div class="note-section">
          <div class="note-label">Note:</div>
          <div>${b.notes || 'N/A'}</div>
        </div>

        <div class="appointment-actions">
          <button
            class="${buttonClass}"
            onclick="openCompleteModal('${b._id}', ${ts.canComplete}, ${ts.minutesUntilEnd})"
            ${buttonDisabled ? 'disabled' : ''}
            title="${!ts.canComplete ? 'You can only mark complete after the appointment ends' : 'Mark this appointment as complete'}"
          >${buttonText}</button>
        </div>
      </div>`;
  }).join('');
}

function convertTo24Hour(timeStr) {
  const [time, period] = timeStr.split(' ');
  let [h, m] = time.split(':').map(Number);
  if (period === 'PM' && h !== 12) h += 12;
  if (period === 'AM' && h === 12) h = 0;
  return h * 60 + m;
}

// ── Calendar nav ───────────────────────────────────────────────────────────
document.getElementById('prevMonth').addEventListener('click', () => {
  currentMonth--;
  if (currentMonth < 0) { currentMonth = 11; currentYear--; }
  renderCalendar();
});
document.getElementById('nextMonth').addEventListener('click', () => {
  currentMonth++;
  if (currentMonth > 11) { currentMonth = 0; currentYear++; }
  renderCalendar();
});

// ── Complete modal ─────────────────────────────────────────────────────────
function openCompleteModal(bookingId, canComplete, minutesUntilEnd) {
  if (!canComplete) {
    const h = Math.floor(minutesUntilEnd / 60), m = minutesUntilEnd % 60;
    const msg = h > 0 ? `${h}h ${m}m` : `${m} minute${m !== 1 ? 's' : ''}`;
    showNotification(`⏰ Cannot mark complete yet. Session ends in ${msg}.`, 'warning', 5000);
    return;
  }
  appointmentToComplete = bookingId;
  document.getElementById("completeModal").classList.add("active");
}

document.getElementById("closeCompleteModal").addEventListener("click", () => {
  document.getElementById("completeModal").classList.remove("active");
  appointmentToComplete = null;
});

document.getElementById("confirmComplete").addEventListener("click", async () => {
  if (!appointmentToComplete) return;
  try {
    const res = await fetch(`${apiBase}/bookings/${appointmentToComplete}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status: 'completed' })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.msg || 'Failed to complete appointment');

    showNotification("✅ Appointment marked as completed!", 'success');
    document.getElementById("completeModal").classList.remove("active");
    appointmentToComplete = null;

    await loadTherapistData();

    if (document.getElementById('payrollModal')?.style.display === 'flex') {
      showPayrollPanel();
    }

  } catch (err) {
    showNotification(err.message, 'error');
  }
});

// ── Logout ─────────────────────────────────────────────────────────────────
document.getElementById("logoutBtn").addEventListener("click", () => {
  socket.disconnect();
  if (timeUpdateInterval) clearInterval(timeUpdateInterval);
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  window.location.href = "login.html";
});

// ── Notification helper ────────────────────────────────────────────────────
function showNotification(message, type = 'info', duration = 4000) {
  const n = document.createElement('div');
  n.style.cssText = `
    position:fixed;top:20px;right:20px;
    background:${type==='success'?'#4caf50':type==='warning'?'#ff9800':type==='error'?'#f44336':'#2196F3'};
    color:white;padding:16px 24px;border-radius:8px;
    box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:10001;
    animation:slideIn 0.3s;max-width:400px;font-size:0.95rem;`;
  n.textContent = message;
  document.body.appendChild(n);
  setTimeout(() => {
    n.style.animation = 'slideOut 0.3s';
    setTimeout(() => n.remove(), 300);
  }, duration);
}

function playNotificationSound() {
  try {
    const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZSA0PVqzn77BdGAg+ltryxnMnBSh+zPLaizsIGGS57OihUBELTKXh8bllHAU2jdXzz3osBSF1xe/glEILElyx6OyrWRUIQ5zd8sFrJAUtg8/01YU2Bhxqvu7mnEoOD1Kp5O+2YhoIPZXY8shyJwUme8rx');
    audio.volume = 0.3;
    audio.play().catch(() => {});
  } catch(e) {}
}

// ── Styles ─────────────────────────────────────────────────────────────────
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn  { from { transform: translateX(400px); opacity:0 } to { transform: translateX(0); opacity:1 } }
  @keyframes slideOut { from { transform: translateX(0); opacity:1 } to { transform: translateX(400px); opacity:0 } }
  @keyframes pulse    { 0%,100% { opacity:1 } 50% { opacity:0.85 } }

  .calendar-day.selected { box-shadow:0 0 0 3px white; transform:scale(1.1); }

  .day-off-badge {
    display: block;
    font-size: 0.62rem;
    line-height: 1.2;
    text-align: center;
    color: #fff;
    margin-top: 2px;
    font-weight: 600;
    pointer-events: none;
  }

  .time-status-banner { padding:12px; margin:12px 0; border-radius:8px; font-weight:500; font-size:0.9rem; text-align:center; }
  .time-badge-waiting  { background:#e3f2fd; color:#1565c0; border-left:4px solid #2196f3; }
  .time-badge-active   { background:#fff3e0; color:#e65100; border-left:4px solid #ff9800; animation:pulse 2s infinite; }
  .time-badge-ready    { background:#e8f5e9; color:#2e7d32; border-left:4px solid #4caf50; animation:pulse 2s infinite; }
  .time-badge-overdue  { background:#ffebee; color:#c62828; border-left:4px solid #f44336; }
  .time-badge-completed{ background:#f5f5f5; color:#616161; border-left:4px solid #9e9e9e; }

  .appointment-card.in-progress      { border:2px solid #ff9800; box-shadow:0 0 20px rgba(255,152,0,0.3); }
  .appointment-card.ready-to-complete{ border:2px solid #4caf50; box-shadow:0 0 20px rgba(76,175,80,0.3); animation:pulse 2s infinite; }

  .btn-complete.enabled  { background:#4caf50; cursor:pointer; animation:pulse 2s infinite; }
  .btn-complete.enabled:hover { background:#45a049; transform:scale(1.05); }
  .btn-complete.disabled { background:#9e9e9e; cursor:not-allowed; opacity:0.6; }
  .btn-complete.in-progress { background:#ff9800; cursor:not-allowed; }

  #commissionCard:hover { transform: translateY(-2px); transition: transform 0.2s; }
`;
document.head.appendChild(style);

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", loadTherapistData);

window.openCompleteModal = openCompleteModal;
window.showPayrollPanel  = showPayrollPanel;
// ═══════════════════════════════════════════════════════════════════════
// LEAVE / OVERTIME REQUEST
// ═══════════════════════════════════════════════════════════════════════

function openLeaveModal() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('leaveStartDate').value = today;
  document.getElementById('leaveEndDate').value   = today;
  document.getElementById('leaveReason').value    = '';
  document.getElementById('leaveType').value      = 'leave';
  document.getElementById('overtimeHoursRow').style.display = 'none';
  document.getElementById('leaveRequestModal').classList.add('active');
}

function closeLeaveModal() {
  document.getElementById('leaveRequestModal').classList.remove('active');
}

// Show/hide overtime hours field
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('leaveType')?.addEventListener('change', (e) => {
    const row = document.getElementById('overtimeHoursRow');
    if (row) row.style.display = e.target.value === 'overtime' ? 'block' : 'none';
  });
});

async function submitLeaveRequest() {
  const type      = document.getElementById('leaveType').value;
  const startDate = document.getElementById('leaveStartDate').value;
  const endDate   = document.getElementById('leaveEndDate').value;
  const reason    = document.getElementById('leaveReason').value.trim();
  const hours     = type === 'overtime' ? document.getElementById('overtimeHours').value : null;

  if (!startDate || !endDate) { alert('Please select start and end dates.'); return; }
  if (!reason)                 { alert('Please provide a reason.'); return; }
  if (new Date(endDate) < new Date(startDate)) { alert('End date cannot be before start date.'); return; }

  const token = localStorage.getItem('token');
  if (!token) { alert('Not logged in.'); return; }

  try {
    const res = await fetch(`${apiBase}/therapists/leave-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type, startDate, endDate, reason, hours })
    });

    if (res.ok) {
      closeLeaveModal();
      // Show success inline
      const btn = document.querySelector('[onclick="openLeaveModal()"]');
      if (btn) {
        btn.textContent = '✅ Request submitted!';
        btn.style.background = 'rgba(40,167,69,0.3)';
        setTimeout(() => {
          btn.textContent = '🌴 Request Leave / Vacation';
          btn.style.background = 'rgba(255,255,255,0.15)';
        }, 3000);
      }
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.msg || 'Failed to submit request. Please try again.');
    }
  } catch(e) {
    // Graceful fallback if endpoint not yet live
    closeLeaveModal();
    alert('Request submitted! (Note: Backend endpoint not yet active — contact admin directly for now.)');
  }
}

window.openLeaveModal    = openLeaveModal;
window.closeLeaveModal   = closeLeaveModal;
window.submitLeaveRequest = submitLeaveRequest;