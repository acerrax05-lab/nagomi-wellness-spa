// js/therapist.js
const apiBase = "http://localhost:5000/api";
const token = localStorage.getItem("token");
const user = JSON.parse(localStorage.getItem("user") || "{}");

// Protect route - only therapists can access
if (!token || user.role !== "therapist") {
  alert("Access denied! Please log in as a therapist.");
  window.location.href = "login.html";
}

const loader = document.getElementById("loader");
let allBookings = [];
let appointmentToComplete = null;
let currentFilter = 'today';

// Display welcome message and date
document.getElementById("welcomeText").textContent = `Welcome, ${user.name}!`;
document.getElementById("dateDisplay").textContent = new Date().toLocaleDateString('en-US', {
  weekday: 'long',
  year: 'numeric',
  month: 'long',
  day: 'numeric'
});

// Load therapist appointments
async function loadTherapistAppointments() {
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
    const todayEarnings = completedToday.reduce((sum, b) => sum + (b.price || 0), 0);

    // Update stats
    document.getElementById("todayCount").textContent = todayBookings.length;
    document.getElementById("upcomingCount").textContent = upcomingBookings.length;
    document.getElementById("completedCount").textContent = completedToday.length;
    document.getElementById("totalEarnings").textContent = `₱${todayEarnings.toLocaleString()}`;

    // Display appointments based on current filter
    displayAppointments(currentFilter);

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

// Display appointments based on filter
function displayAppointments(filter) {
  currentFilter = filter;
  const container = document.getElementById("appointmentsList");
  
  let filteredBookings = [];
  let title = "";

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  switch(filter) {
    case 'today':
      filteredBookings = allBookings.filter(b => {
        const bookingDate = new Date(b.date);
        bookingDate.setHours(0, 0, 0, 0);
        return bookingDate.getTime() === today.getTime();
      });
      title = "Today's Appointments";
      break;
    
    case 'upcoming':
      filteredBookings = allBookings.filter(b => 
        (b.status === 'pending' || b.status === 'confirmed') && 
        new Date(b.date) >= new Date()
      );
      title = "Upcoming Appointments";
      break;
    
    case 'completed':
      filteredBookings = allBookings.filter(b => b.status === 'completed');
      title = "Completed Appointments";
      break;
    
    case 'all':
      filteredBookings = allBookings;
      title = "All Appointments";
      break;
  }

  document.getElementById("sectionTitle").textContent = title;

  // Sort by date and time
  filteredBookings.sort((a, b) => new Date(a.date) - new Date(b.date));

  if (filteredBookings.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📅</div>
        <p>No appointments found</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filteredBookings.map(b => {
    const clientName = b.client ? b.client.name : (b.guestName || "Guest");
    const serviceName = b.service ? b.service.name : "Service";
    const duration = b.service ? b.service.durationMinutes : 0;
    const bookingDate = new Date(b.date);
    const dateStr = bookingDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });

    const canComplete = (b.status === 'pending' || b.status === 'confirmed') && 
                        new Date(b.date) <= new Date();

    return `
      <div class="appointment-card">
        <div class="time-badge">
          <span class="time">${b.time}</span>
          <span class="date">${dateStr}</span>
        </div>

        <div class="appointment-info">
          <div class="client-name">${clientName}</div>
          
          <div class="service-info">
            <span>💆</span>
            <span>${serviceName}</span>
            ${duration ? `<span style="color: #999;">• ${duration} mins</span>` : ''}
          </div>

          <div class="appointment-details">
            <div class="detail-item">
              <span class="detail-icon">💰</span>
              <span>₱${(b.price || 0).toLocaleString()}</span>
            </div>
            ${b.client && b.client.phone ? `
            <div class="detail-item">
              <span class="detail-icon">📞</span>
              <span>${b.client.phone}</span>
            </div>
            ` : ''}
            ${b.guestPhone ? `
            <div class="detail-item">
              <span class="detail-icon">📞</span>
              <span>${b.guestPhone}</span>
            </div>
            ` : ''}
          </div>

          ${b.notes ? `
          <div class="notes-section">
            <div class="notes-label">Client Notes:</div>
            <div>${b.notes}</div>
          </div>
          ` : ''}
        </div>

        <div class="appointment-actions">
          <span class="status-badge status-${b.status}">${b.status}</span>
          <button 
            class="btn-complete" 
            onclick="openCompleteModal('${b._id}')"
            ${!canComplete ? 'disabled' : ''}
          >
            ${canComplete ? 'Mark Complete' : 'Completed'}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Filter tabs
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // Update active tab
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Filter appointments
    const filter = btn.dataset.filter;
    displayAppointments(filter);
  });
});

// Open complete modal
function openCompleteModal(bookingId) {
  appointmentToComplete = bookingId;
  document.getElementById("completeModal").classList.add("active");
}

// Close modal
document.getElementById("closeCompleteModal").addEventListener("click", () => {
  document.getElementById("completeModal").classList.remove("active");
  appointmentToComplete = null;
});

// Confirm completion
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

    alert("✅ Appointment marked as completed!");
    document.getElementById("completeModal").classList.remove("active");
    appointmentToComplete = null;

    // Reload appointments
    loadTherapistAppointments();

  } catch (err) {
    console.error(err);
    alert("❌ Failed to complete appointment. Please try again.");
  }
});

// Logout
document.getElementById("logoutBtn").addEventListener("click", (e) => {
  e.preventDefault();
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  alert("Logged out successfully!");
  window.location.href = "login.html";
});

// Load data on page load
document.addEventListener("DOMContentLoaded", loadTherapistAppointments);