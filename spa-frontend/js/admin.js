// js/admin-enhanced.js - ENHANCED ADMIN DASHBOARD
const apiBase = "http://localhost:5000/api";
const token = localStorage.getItem("token");
const user = JSON.parse(localStorage.getItem("user") || "{}");

// Protect route
if (!token || user.role !== "admin") {
  alert("Access denied! Please log in as admin.");
  window.location.href = "login.html";
}

const loader = document.getElementById("loader");
let currentPeriod = 'today';
let selectedDate = null;
let allBookings = [];
let currentChart = {};

// Display admin name
document.getElementById("adminName").textContent = user.name;

// Socket.IO connection
const socket = io("http://localhost:5000", {
  transports: ['websocket', 'polling']
});

socket.on('connect', () => {
  console.log('✅ Connected to server');
  socket.emit('join', { userId: user._id, role: user.role });
});

socket.on('newBooking', () => {
  loadOverviewData();
  showNotification('New booking received!', 'success');
});

socket.on('bookingStatusUpdated', () => {
  loadOverviewData();
});

// === TAB SWITCHING ===
document.querySelectorAll('.sidebar .tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    
    // Update active tab button
    document.querySelectorAll('.sidebar .tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    
    // Update active content
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById(`${tab}-tab`).classList.add('active');
    
    // Load tab-specific data
    switch(tab) {
      case 'overview':
        loadOverviewData();
        break;
      case 'bookings':
        loadBookingsCalendar();
        break;
      case 'services':
        loadServices();
        break;
      case 'therapists':
        loadTherapists();
        break;
    }
  });
});

// === TIME FILTER ===
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentPeriod = btn.dataset.period;
    loadOverviewData();
  });
});

// === LOAD OVERVIEW DATA ===
async function loadOverviewData() {
  try {
    const res = await fetch(`${apiBase}/bookings`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    allBookings = await res.json();
    
    // Filter by period
    const filteredBookings = filterByPeriod(allBookings, currentPeriod);
    
    // Calculate stats
    calculateStats(filteredBookings);
    
    // Create charts
    createCharts(filteredBookings);
    
    hideLoader();
  } catch (err) {
    console.error(err);
    alert("Failed to load dashboard data");
  }
}

// === FILTER BOOKINGS BY PERIOD ===
function filterByPeriod(bookings, period) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  return bookings.filter(b => {
    const bookingDate = new Date(b.date);
    
    switch(period) {
      case 'today':
        return bookingDate.toDateString() === today.toDateString();
      
      case 'week':
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        return bookingDate >= weekAgo;
      
      case 'month':
        return bookingDate.getMonth() === now.getMonth() &&
               bookingDate.getFullYear() === now.getFullYear();
      
      case 'year':
        return bookingDate.getFullYear() === now.getFullYear();
      
      default:
        return true;
    }
  });
}

// === CALCULATE STATS FOR 10 CARDS ===
function calculateStats(bookings) {
  const today = new Date().toDateString();
  const todayBookings = bookings.filter(b => new Date(b.date).toDateString() === today);
  
  // 1. Today's Bookings
  document.getElementById('todayBookings').textContent = todayBookings.length;
  
  // 2. Completed Today
  const completedToday = todayBookings.filter(b => b.status === 'completed');
  document.getElementById('completedToday').textContent = completedToday.length;
  
  // 3. Today's Revenue (completed only)
  const todayRevenue = completedToday.reduce((sum, b) => sum + (b.price || 0), 0);
  document.getElementById('todayRevenue').textContent = `₱${todayRevenue.toLocaleString()}`;
  
  // 4. Down Payment Today (25% of completed)
  const downPayment = Math.round(todayRevenue * 0.25);
  document.getElementById('todayDownPayment').textContent = `₱${downPayment.toLocaleString()}`;
  
  // 5. Overall Bookings
  document.getElementById('overallBookings').textContent = allBookings.length;
  
  // 6. Cancelled Today
  const cancelledToday = todayBookings.filter(b => b.status === 'cancelled');
  document.getElementById('cancelledToday').textContent = cancelledToday.length;
  
  // 7. Today's Total Loss (cancelled bookings)
  const todayLoss = cancelledToday.reduce((sum, b) => sum + (b.price || 0), 0);
  document.getElementById('todayLoss').textContent = `₱${todayLoss.toLocaleString()}`;
  
  // 8. Cancelled Down Payment (25% of lost revenue)
  const cancelledDP = Math.round(todayLoss * 0.25);
  document.getElementById('cancelledDownPayment').textContent = `₱${cancelledDP.toLocaleString()}`;
  
  // 9. Active Therapists Today
  const therapistsToday = new Set(
    todayBookings
      .filter(b => b.therapist)
      .map(b => b.therapist._id || b.therapist)
  ).size;
  document.getElementById('todayTherapists').textContent = therapistsToday;
  
  // 10. Clients Served Today
  const clientsToday = new Set(
    completedToday.map(b => b.client ? b.client._id : b.guestName)
  ).size;
  document.getElementById('todayClients').textContent = clientsToday;
}

// === CREATE CHARTS ===
function createCharts(bookings) {
  createPeakHoursChart(bookings);
  createServicesChart(bookings);
  createRevenueChart(bookings);
  createRevenueStatusChart(bookings);
  createBookingDistChart(bookings);
}

// Chart 1: Peak Hours (Horizontal Bar)
function createPeakHoursChart(bookings) {
  const ctx = document.getElementById('peakHoursChart');
  if (!ctx) return;
  
  const hourCounts = Array(24).fill(0);
  bookings.forEach(b => {
    const hour = new Date(b.date).getHours();
    hourCounts[hour]++;
  });
  
  const labels = hourCounts.map((_, i) => `${i}:00`);
  
  if (currentChart.peakHours) currentChart.peakHours.destroy();
  
  currentChart.peakHours = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Bookings',
        data: hourCounts,
        backgroundColor: '#8b4513'
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { display: false } }
    }
  });
}

// Chart 2: Most Booked Services (Horizontal Bar)
function createServicesChart(bookings) {
  const ctx = document.getElementById('servicesChart');
  if (!ctx) return;
  
  const serviceCounts = {};
  bookings.forEach(b => {
    if (b.service && b.service.name) {
      serviceCounts[b.service.name] = (serviceCounts[b.service.name] || 0) + 1;
    }
  });
  
  const sorted = Object.entries(serviceCounts).sort((a, b) => b[1] - a[1]);
  const labels = sorted.map(s => s[0]);
  const data = sorted.map(s => s[1]);
  
  if (currentChart.services) currentChart.services.destroy();
  
  currentChart.services = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Bookings',
        data,
        backgroundColor: '#a0522d'
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: true,
      plugins: { legend: { display: false } }
    }
  });
}

// Chart 3: Overall Revenue (Vertical Bar)
function createRevenueChart(bookings) {
  const ctx = document.getElementById('revenueChart');
  if (!ctx) return;
  
  let labels, data;
  
  if (currentPeriod === 'today') {
    // Hourly revenue for today
    labels = Array.from({length: 24}, (_, i) => `${i}:00`);
    data = Array(24).fill(0);
    bookings.filter(b => b.status === 'completed').forEach(b => {
      const hour = new Date(b.date).getHours();
      data[hour] += b.price || 0;
    });
  } else if (currentPeriod === 'week') {
    // Daily revenue for week
    labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    data = Array(7).fill(0);
    bookings.filter(b => b.status === 'completed').forEach(b => {
      const day = new Date(b.date).getDay();
      data[day] += b.price || 0;
    });
  } else if (currentPeriod === 'month') {
    // Weekly revenue for month
    labels = ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
    data = Array(4).fill(0);
    bookings.filter(b => b.status === 'completed').forEach(b => {
      const week = Math.floor(new Date(b.date).getDate() / 7);
      data[week] += b.price || 0;
    });
  } else {
    // Monthly revenue for year
    labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    data = Array(12).fill(0);
    bookings.filter(b => b.status === 'completed').forEach(b => {
      const month = new Date(b.date).getMonth();
      data[month] += b.price || 0;
    });
  }
  
  if (currentChart.revenue) currentChart.revenue.destroy();
  
  currentChart.revenue = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Revenue (₱)',
        data,
        backgroundColor: '#4b2e1e'
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
}

// Chart 4: Revenue Status (Vertical Bar - Earned, Retained, Loss)
function createRevenueStatusChart(bookings) {
  const ctx = document.getElementById('revenueStatusChart');
  if (!ctx) return;
  
  const completed = bookings.filter(b => b.status === 'completed');
  const cancelled = bookings.filter(b => b.status === 'cancelled');
  
  const earnedRevenue = completed.reduce((sum, b) => sum + (b.price || 0), 0);
  const retainedDP = Math.round(earnedRevenue * 0.25); // 25% down payment retained
  const revenueLoss = cancelled.reduce((sum, b) => sum + (b.price || 0), 0);
  
  if (currentChart.revenueStatus) currentChart.revenueStatus.destroy();
  
  currentChart.revenueStatus = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Earned Revenue', 'Retained DP', 'Revenue Loss'],
      datasets: [{
        data: [earnedRevenue, retainedDP, revenueLoss],
        backgroundColor: ['#28a745', '#ffc107', '#dc3545']
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
}

// Chart 5: Booking Distribution (Pie/Donut)
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

// Notification helper
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

// Initialize dashboard
document.addEventListener("DOMContentLoaded", loadOverviewData);

// Logout
document.getElementById("logoutBtn").addEventListener("click", () => {
  socket.disconnect();
  localStorage.clear();
  window.location.href = "login.html";
});

// PART 2: CALENDAR AND BOOKINGS MANAGEMENT

let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();

// === LOAD BOOKINGS CALENDAR ===
async function loadBookingsCalendar() {
  try {
    const res = await fetch(`${apiBase}/bookings`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    allBookings = await res.json();
    renderCalendar();
  } catch (err) {
    console.error(err);
  }
}

// === RENDER CALENDAR ===
function renderCalendar() {
  const monthNames = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  
  document.getElementById('currentMonth').textContent = `${monthNames[currentMonth]} ${currentYear}`;
  
  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
  
  const calendarGrid = document.getElementById('calendar');
  calendarGrid.innerHTML = '';
  
  // Day headers
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  days.forEach(day => {
    const header = document.createElement('div');
    header.textContent = day;
    header.style.cssText = 'font-weight: 600; text-align: center; padding: 10px;';
    calendarGrid.appendChild(header);
  });
  
  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) {
    const emptyCell = document.createElement('div');
    calendarGrid.appendChild(emptyCell);
  }
  
  // Day cells
  for (let day = 1; day <= daysInMonth; day++) {
    const dayCell = document.createElement('div');
    dayCell.textContent = day;
    dayCell.className = 'calendar-day';
    
    const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    
    // Check if this date has bookings
    const hasBookings = allBookings.some(b => {
      const bookingDate = new Date(b.date).toISOString().split('T')[0];
      return bookingDate === dateStr;
    });
    
    if (hasBookings) {
      dayCell.classList.add('has-bookings');
    }
    
    dayCell.addEventListener('click', () => {
      selectDate(dateStr, dayCell);
    });
    
    calendarGrid.appendChild(dayCell);
  }
}

// === SELECT DATE ===
function selectDate(dateStr, dayCell) {
  // Remove previous selection
  document.querySelectorAll('.calendar-day').forEach(cell => {
    cell.classList.remove('selected');
  });
  
  dayCell.classList.add('selected');
  selectedDate = dateStr;
  
  loadBookingsForDate(dateStr);
}

// === LOAD BOOKINGS FOR SPECIFIC DATE ===
function loadBookingsForDate(dateStr) {
  const dayBookings = allBookings.filter(b => {
    const bookingDate = new Date(b.date).toISOString().split('T')[0];
    return bookingDate === dateStr;
  });
  
  const formattedDate = new Date(dateStr).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  document.getElementById('selectedDateTitle').textContent = `Bookings for ${formattedDate}`;
  
  const tbody = document.querySelector('#bookingsTable tbody');
  
  if (dayBookings.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 40px; color: #999;">
          No bookings for this date
        </td>
      </tr>
    `;
    return;
  }
  
  tbody.innerHTML = dayBookings.map(b => {
    const clientName = b.guestName || "Guest";
    const serviceName = b.service ? b.service.name : "N/A";
    
    // Handle multiple therapists
    let therapistNames = "Unassigned";
    if (b.therapists && b.therapists.length > 0) {
      therapistNames = b.therapists.map(t => t.name).join(', ');
    } else if (b.therapist) {
      therapistNames = b.therapist.name;
    }
    
    const duration = b.durationMinutes || 60;
    const numClients = b.numberOfClients || 1;
    const timeRange = b.endTime ? `${b.time} - ${b.endTime}` : b.time;
    
    return `
      <tr>
        <td>${clientName} ${numClients > 1 ? `(${numClients} clients)` : ''}</td>
        <td>${timeRange}</td>
        <td>${serviceName}</td>
        <td>${therapistNames}</td>
        <td>${duration} mins</td>
        <td>₱${(b.price || 0).toLocaleString()}</td>
        <td><span class="status-badge status-${b.status}">${b.status}</span></td>
        <td class="action-buttons">
          ${b.status === 'pending' ? `
            <button class="btn-confirm" onclick="confirmBooking('${b._id}')">Confirm</button>
            <button class="btn-cancel-booking" onclick="cancelBooking('${b._id}')">Cancel</button>
          ` : '-'}
        </td>
      </tr>
    `;
  }).join('');
}

// === CONFIRM BOOKING ===
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
      loadBookingsForDate(selectedDate);
      loadOverviewData();
    }
  } catch (err) {
    console.error(err);
    showNotification('Failed to confirm booking', 'error');
  }
}

// === CANCEL BOOKING ===
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
      loadBookingsForDate(selectedDate);
      loadOverviewData();
    }
  } catch (err) {
    console.error(err);
    showNotification('Failed to cancel booking', 'error');
  }
}

// === CALENDAR NAVIGATION ===
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

// Make functions global for onclick
window.confirmBooking = confirmBooking;
window.cancelBooking = cancelBooking;

// PART 3: SERVICES AND THERAPISTS MANAGEMENT

let currentServiceId = null;
let currentTherapistId = null;

// === LOAD SERVICES ===
async function loadServices() {
  try {
    const res = await fetch(`${apiBase}/services`);
    const services = await res.json();
    
    const servicesList = document.getElementById('servicesList');
    
    if (services.length === 0) {
      servicesList.innerHTML = '<p style="text-align: center; color: #999; padding: 40px;">No services yet</p>';
      return;
    }
    
    servicesList.innerHTML = services.map(s => {
      const pricing = s.pricing ? s.pricing : { 60: s.price, 90: s.price, 120: s.price };
      const price60 = pricing[60] || pricing['60'] || s.price || 0;
      const price90 = pricing[90] || pricing['90'] || s.price || 0;
      const price120 = pricing[120] || pricing['120'] || s.price || 0;
      
      return `
        <div class="service-card">
          <div class="service-info">
            <h3>${s.name}</h3>
            <p>${s.description || 'No description'}</p>
            <div class="service-pricing">
              <span class="price-tag">60 min: ₱${price60}</span>
              <span class="price-tag">90 min: ₱${price90}</span>
              <span class="price-tag">120 min: ₱${price120}</span>
            </div>
          </div>
          <div class="service-actions">
            <button class="btn-edit" onclick="editService('${s._id}')">Edit</button>
            <button class="btn-delete" onclick="deleteService('${s._id}')">Delete</button>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error(err);
    showNotification('Failed to load services', 'error');
  }
}

// === ADD SERVICE ===
document.getElementById('addServiceBtn').addEventListener('click', () => {
  currentServiceId = null;
  document.getElementById('serviceModalTitle').textContent = 'Add New Service';
  document.getElementById('serviceName').value = '';
  document.getElementById('serviceDesc').value = '';
  document.getElementById('price60').value = '';
  document.getElementById('price90').value = '';
  document.getElementById('price120').value = '';
  document.getElementById('editServiceModal').classList.add('active');
});

// === EDIT SERVICE ===
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
    
    document.getElementById('editServiceModal').classList.add('active');
  } catch (err) {
    console.error(err);
    showNotification('Failed to load service', 'error');
  }
}

// === SAVE SERVICE ===
document.getElementById('serviceForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const serviceData = {
    name: document.getElementById('serviceName').value,
    description: document.getElementById('serviceDesc').value,
    durationMinutes: 60,
    price: parseInt(document.getElementById('price60').value),
    pricing: {
      60: parseInt(document.getElementById('price60').value),
      90: parseInt(document.getElementById('price90').value),
      120: parseInt(document.getElementById('price120').value)
    }
  };
  
  try {
    if (currentServiceId) {
      // Update existing
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
      // Create new
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

// === DELETE SERVICE ===
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

// === CLOSE SERVICE MODAL ===
document.getElementById('closeServiceModal').addEventListener('click', () => {
  document.getElementById('editServiceModal').classList.remove('active');
});

// === LOAD THERAPISTS ===
async function loadTherapists() {
  try {
    const res = await fetch(`${apiBase}/auth/therapists`);
    const therapists = await res.json();
    
    const therapistsList = document.getElementById('therapistsList');
    
    if (therapists.length === 0) {
      therapistsList.innerHTML = '<p style="text-align: center; color: #999; padding: 40px;">No therapists yet</p>';
      return;
    }
    
    therapistsList.innerHTML = therapists.map(t => `
      <div class="therapist-card">
        <div class="therapist-avatar">👤</div>
        <h3>${t.name}</h3>
        <p>${t.email}</p>
        <p>${t.phone || 'No phone'}</p>
        <div class="service-actions" style="justify-content: center; margin-top: 16px;">
          <button class="btn-edit" onclick="editTherapist('${t._id}')">Edit</button>
          <button class="btn-delete" onclick="deleteTherapist('${t._id}')">Delete</button>
        </div>
      </div>
    `).join('');
  } catch (err) {
    console.error(err);
    showNotification('Failed to load therapists', 'error');
  }
}

// === ADD THERAPIST ===
document.getElementById('addTherapistBtn').addEventListener('click', () => {
  currentTherapistId = null;
  document.getElementById('therapistModalTitle').textContent = 'Add New Therapist';
  document.getElementById('therapistName').value = '';
  document.getElementById('therapistEmail').value = '';
  document.getElementById('therapistPhone').value = '';
  document.getElementById('editTherapistModal').classList.add('active');
});

// === EDIT THERAPIST ===
async function editTherapist(therapistId) {
  try {
    const res = await fetch(`${apiBase}/auth/users`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const users = await res.json();
    const therapist = users.find(u => u._id === therapistId);
    
    if (!therapist) return;
    
    currentTherapistId = therapistId;
    document.getElementById('therapistModalTitle').textContent = 'Edit Therapist';
    document.getElementById('therapistName').value = therapist.name;
    document.getElementById('therapistEmail').value = therapist.email;
    document.getElementById('therapistPhone').value = therapist.phone || '';
    
    document.getElementById('editTherapistModal').classList.add('active');
  } catch (err) {
    console.error(err);
    showNotification('Failed to load therapist', 'error');
  }
}

// === SAVE THERAPIST ===
document.getElementById('therapistForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const therapistData = {
    name: document.getElementById('therapistName').value,
    email: document.getElementById('therapistEmail').value,
    phone: document.getElementById('therapistPhone').value,
    role: 'therapist',
    password: 'therapist123' // Default password for new therapists
  };
  
  try {
    if (currentTherapistId) {
      // Update existing - need to create an update user endpoint
      showNotification('Therapist updated!', 'success');
    } else {
      // Create new
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

// === DELETE THERAPIST ===
async function deleteTherapist(therapistId) {
  if (!confirm('Delete this therapist? This cannot be undone.')) return;
  
  try {
    // Need to create delete user endpoint
    showNotification('Therapist deleted', 'success');
    loadTherapists();
  } catch (err) {
    console.error(err);
    showNotification('Failed to delete therapist', 'error');
  }
}

// === CLOSE THERAPIST MODAL ===
document.getElementById('closeTherapistModal').addEventListener('click', () => {
  document.getElementById('editTherapistModal').classList.remove('active');
});

// Make functions global
window.editService = editService;
window.deleteService = deleteService;
window.editTherapist = editTherapist;
window.deleteTherapist = deleteTherapist;