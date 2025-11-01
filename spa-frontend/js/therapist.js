// js/therapist-new.js - NEW DESIGN WITH CALENDAR
const apiBase = "http://localhost:5000/api";
const token = localStorage.getItem("token");
const user = JSON.parse(localStorage.getItem("user") || "{}");

// Protect route
if (!token || user.role !== "therapist") {
  alert("Access denied! Please log in as a therapist.");
  window.location.href = "login.html";
}

const loader = document.getElementById("loader");
let allBookings = [];
let appointmentToComplete = null;
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();
let selectedDate = new Date().toDateString();

// Socket.IO connection
const socket = io("http://localhost:5000", {
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

socket.on('appointmentUpdated', (data) => {
  console.log('🔄 Appointment updated', data);
  loadTherapistData();
});

socket.on('appointmentRemoved', (data) => {
  console.log('🗑️ Appointment removed', data);
  showNotification('An appointment was reassigned', 'warning');
  loadTherapistData();
});

// Display welcome message
document.getElementById("welcomeMessage").textContent = `Welcome back, ${user.name}!`;
document.getElementById("dashboardSubtitle").textContent = `Here's your dashboard overview, ${user.name}`;

// Load therapist data
async function loadTherapistData() {
  try {
    const res = await fetch(`${apiBase}/bookings/my-appointments`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      throw new Error('Failed to fetch appointments');
    }

    allBookings = await res.json();

    // Calculate stats
    const today = new Date().toDateString();
    const todayBookings = allBookings.filter(b => 
      new Date(b.date).toDateString() === today
    );
    
    const upcomingBookings = allBookings.filter(b => 
      (b.status === 'pending' || b.status === 'confirmed') && 
      new Date(b.date) >= new Date()
    );
    
    const completedToday = todayBookings.filter(b => b.status === 'completed');
    const todayRevenue = completedToday.reduce((sum, b) => sum + (b.price || 0), 0);

    // Update stats
    document.getElementById("todayAppointments").textContent = todayBookings.length;
    document.getElementById("upcomingCount").textContent = upcomingBookings.length;
    document.getElementById("completedCount").textContent = completedToday.length;
    document.getElementById("todayRevenue").textContent = `P${todayRevenue.toLocaleString()}`;

    // Render calendar
    renderCalendar();
    
    // Display today's appointments
    displayAppointmentsForDate(today);

    // Hide loader
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

// Render calendar
// Render calendar - FIXED VERSION
// Render calendar - PROPERLY FIXED VERSION
function renderCalendar() {
  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  
  document.getElementById('currentMonth').textContent = `${monthNames[currentMonth]} ${currentYear}`;
  
  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  const prevMonthDays = new Date(currentYear, currentMonth, 0).getDate();
  const today = new Date();
  
  const calendarDays = document.getElementById('calendarDays');
  calendarDays.innerHTML = '';
  
  // Calculate total cells needed (6 rows * 7 days)
  const totalCells = 42;
  
  // Previous month's trailing days
  const prevMonthStart = prevMonthDays - firstDay + 1;
  for (let i = prevMonthStart; i <= prevMonthDays; i++) {
    const dayCell = document.createElement('div');
    dayCell.className = 'calendar-day other-month';
    dayCell.textContent = i;
    calendarDays.appendChild(dayCell);
  }
  
  // Current month's days
  for (let day = 1; day <= daysInMonth; day++) {
    const dayCell = document.createElement('div');
    dayCell.className = 'calendar-day current-month';
    dayCell.textContent = day;
    
    const cellDate = new Date(currentYear, currentMonth, day);
    const dateStr = cellDate.toDateString();
    
    // Check if today
    if (cellDate.getDate() === today.getDate() && 
        cellDate.getMonth() === today.getMonth() && 
        cellDate.getFullYear() === today.getFullYear()) {
      dayCell.classList.add('today');
    }
    
    // Check if has appointments
    const hasAppointments = allBookings.some(b => 
      new Date(b.date).toDateString() === dateStr
    );
    
    if (hasAppointments) {
      dayCell.classList.add('has-appointments');
    }
    
    // Click handler
    dayCell.addEventListener('click', () => {
      selectedDate = dateStr;
      displayAppointmentsForDate(dateStr);
      
      // Highlight selected
      document.querySelectorAll('.calendar-day').forEach(d => d.classList.remove('selected'));
      dayCell.classList.add('selected');
    });
    
    calendarDays.appendChild(dayCell);
  }
  
  // Next month's leading days
  const cellsUsed = firstDay + daysInMonth;
  const nextMonthDays = totalCells - cellsUsed;
  
  for (let i = 1; i <= nextMonthDays; i++) {
    const dayCell = document.createElement('div');
    dayCell.className = 'calendar-day other-month';
    dayCell.textContent = i;
    calendarDays.appendChild(dayCell);
  }
}

// Display appointments for selected date
// Display appointments for selected date - UPDATED DESIGN
function displayAppointmentsForDate(dateStr) {
  const dayBookings = allBookings.filter(b => 
    new Date(b.date).toDateString() === dateStr
  );
  
  // Sort by time
  dayBookings.sort((a, b) => {
    const timeA = convertTo24Hour(a.time);
    const timeB = convertTo24Hour(b.time);
    return timeA - timeB;
  });
  
  const appointmentsList = document.getElementById('appointmentsList');
  
  if (dayBookings.length === 0) {
    appointmentsList.innerHTML = `
      <div style="text-align: center; padding: 60px 20px; color: white;">
        <div style="font-size: 3rem; margin-bottom: 20px;">📅</div>
        <p style="font-size: 1.2rem;">No appointments for this date</p>
      </div>
    `;
    return;
  }
  
  appointmentsList.innerHTML = dayBookings.map(b => {
    const clientName = b.guestName || (b.client ? b.client.name : "Guest");
    const serviceName = b.service ? b.service.name : "Service";
    const duration = b.durationMinutes || 60;
    const numClients = b.numberOfClients || 1;
    
    const canComplete = (b.status === 'pending' || b.status === 'confirmed') && 
                        new Date(b.date) <= new Date();
    
    const statusClass = b.status === 'completed' ? 'completed' : 'upcoming';
    const statusText = b.status === 'completed' ? 'Completed' : 'Upcoming';
    
    return `
      <div class="appointment-card">
        <div class="appointment-header">
          <div class="appointment-time">${b.time}</div>
          <span class="status-badge status-${statusClass}">${statusText}</span>
        </div>
        
        <div class="client-name">${clientName.toUpperCase()}</div>
        <div class="service-name">${serviceName}</div>
        
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
            class="btn-complete" 
            onclick="openCompleteModal('${b._id}')"
            ${!canComplete || b.status === 'completed' ? 'disabled' : ''}
          >
            ${b.status === 'completed' ? 'Completed' : 'Mark as Complete'}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Helper: Convert 12-hour time to 24-hour for sorting
function convertTo24Hour(timeStr) {
  const [time, period] = timeStr.split(' ');
  let [hours, minutes] = time.split(':').map(Number);
  
  if (period === 'PM' && hours !== 12) hours += 12;
  if (period === 'AM' && hours === 12) hours = 0;
  
  return hours * 60 + minutes;
}

// Calendar navigation
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

// Complete modal
function openCompleteModal(bookingId) {
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
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ status: 'completed' })
    });

    if (!res.ok) {
      throw new Error('Failed to complete appointment');
    }

    showNotification("✅ Appointment marked as completed!", 'success');
    document.getElementById("completeModal").classList.remove("active");
    appointmentToComplete = null;

    loadTherapistData();

  } catch (err) {
    console.error(err);
    alert("❌ Failed to complete appointment. Please try again.");
  }
});

// Logout
document.getElementById("logoutBtn").addEventListener("click", () => {
  socket.disconnect();
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  alert("Logged out successfully!");
  window.location.href = "login.html";
});

// Notification helper
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: ${type === 'success' ? '#4caf50' : type === 'warning' ? '#ff9800' : '#2196F3'};
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

function playNotificationSound() {
  const audio = new Audio('data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmwhBTGH0fPTgjMGHm7A7+OZSA0PVqzn77BdGAg+ltryxnMnBSh+zPLaizsIGGS57OihUBELTKXh8bllHAU2jdXzz3osBSF1xe/glEILElyx6OyrWRUIQ5zd8sFrJAUtg8/01YU2Bhxqvu7mnEoOD1Kp5O+2YhoIPZXY8shyJwUme8rx');
  audio.volume = 0.3;
  audio.play().catch(e => console.log('Could not play sound'));
}

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(400px); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  
  @keyframes slideOut {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(400px); opacity: 0; }
  }
  
  .calendar-day.selected {
    box-shadow: 0 0 0 3px white;
    transform: scale(1.1);
  }
`;
document.head.appendChild(style);

// Initialize
document.addEventListener("DOMContentLoaded", loadTherapistData);

// Make function global
window.openCompleteModal = openCompleteModal;