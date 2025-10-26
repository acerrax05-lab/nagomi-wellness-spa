// js/client.js
const apiBase = "http://localhost:5000/api";
const token = localStorage.getItem("token");
const user = JSON.parse(localStorage.getItem("user") || "{}");

// Protect route - only clients can access
if (!token || !user._id) {
  alert("Please log in to access this page");
  window.location.href = "login.html";
}

const loader = document.getElementById("loader");
let bookingToCancel = null;

// Display welcome message
document.getElementById("welcomeText").textContent = `Welcome, ${user.name}!`;

// Load client bookings
async function loadClientBookings() {
  try {
    const res = await fetch(`${apiBase}/bookings/my-bookings`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      throw new Error('Failed to fetch bookings');
    }

    const bookings = await res.json();

    // Calculate stats
    const upcoming = bookings.filter(b => 
      b.status !== 'completed' && b.status !== 'cancelled' && new Date(b.date) >= new Date()
    );
    const completed = bookings.filter(b => b.status === 'completed');
    const totalSpent = completed.reduce((sum, b) => sum + (b.price || 0), 0);

    // Update stats cards
    document.getElementById("upcomingCount").textContent = upcoming.length;
    document.getElementById("completedCount").textContent = completed.length;
    document.getElementById("totalSpent").textContent = `₱${totalSpent.toLocaleString()}`;

    // Display upcoming bookings
    displayUpcomingBookings(upcoming);

    // Display booking history
    displayBookingHistory(bookings);

    // Hide loader
    setTimeout(() => {
      loader.style.opacity = 0;
      setTimeout(() => loader.style.display = "none", 600);
    }, 800);

  } catch (err) {
    console.error(err);
    alert("Failed to load your bookings. Please try again.");
    loader.style.display = "none";
  }
}

// Display upcoming bookings as cards
function displayUpcomingBookings(bookings) {
  const container = document.getElementById("upcomingBookings");

  if (bookings.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📅</div>
        <p>No upcoming appointments</p>
        <a href="booking.html" class="btn-book-new">Book Your First Session</a>
      </div>
    `;
    return;
  }

  container.innerHTML = bookings.map(b => {
    const serviceName = b.service ? b.service.name : "Service";
    const therapistName = b.therapist ? b.therapist.name : "To be assigned";
    const bookingDate = new Date(b.date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    const canCancel = b.status === 'pending' || b.status === 'confirmed';

    return `
      <div class="booking-card">
        <div class="booking-header">
          <div class="service-name">${serviceName}</div>
          <span class="status-badge status-${b.status}">${b.status}</span>
        </div>

        <div class="booking-details">
          <div class="booking-detail">
            <span class="detail-icon">📅</span>
            <span>${bookingDate}</span>
          </div>
          <div class="booking-detail">
            <span class="detail-icon">⏰</span>
            <span>${b.time}</span>
          </div>
          <div class="booking-detail">
            <span class="detail-icon">💆</span>
            <span>${therapistName}</span>
          </div>
          ${b.notes ? `
          <div class="booking-detail">
            <span class="detail-icon">📝</span>
            <span>${b.notes}</span>
          </div>
          ` : ''}
        </div>

        <div class="booking-footer">
          <div class="price">₱${(b.price || 0).toLocaleString()}</div>
          <button 
            class="btn-cancel" 
            onclick="openCancelModal('${b._id}')"
            ${!canCancel ? 'disabled' : ''}
          >
            ${canCancel ? 'Cancel' : 'Cannot Cancel'}
          </button>
        </div>
      </div>
    `;
  }).join('');
}

// Display booking history in table
function displayBookingHistory(bookings) {
  const tbody = document.querySelector("#historyTable tbody");

  // Sort by date (newest first)
  const sortedBookings = bookings.sort((a, b) => new Date(b.date) - new Date(a.date));

  if (sortedBookings.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="5" style="text-align: center; padding: 40px; color: #999;">
          No booking history yet
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = sortedBookings.map(b => {
    const serviceName = b.service ? b.service.name : "N/A";
    const therapistName = b.therapist ? b.therapist.name : "Unassigned";
    const bookingDate = new Date(b.date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

    return `
      <tr>
        <td>${bookingDate}</td>
        <td>${serviceName}</td>
        <td>${therapistName}</td>
        <td><span class="status-badge status-${b.status}">${b.status}</span></td>
        <td>₱${(b.price || 0).toLocaleString()}</td>
      </tr>
    `;
  }).join('');
}

// Open cancel modal
function openCancelModal(bookingId) {
  bookingToCancel = bookingId;
  document.getElementById("cancelModal").classList.add("active");
}

// Close modal
document.getElementById("closeModal").addEventListener("click", () => {
  document.getElementById("cancelModal").classList.remove("active");
  bookingToCancel = null;
});

// Confirm cancellation
document.getElementById("confirmCancel").addEventListener("click", async () => {
  if (!bookingToCancel) return;

  try {
    const res = await fetch(`${apiBase}/bookings/${bookingToCancel}/status`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ status: 'cancelled' })
    });

    if (!res.ok) {
      throw new Error('Failed to cancel booking');
    }

    alert("✅ Booking cancelled successfully");
    document.getElementById("cancelModal").classList.remove("active");
    bookingToCancel = null;

    // Reload bookings
    loadClientBookings();

  } catch (err) {
    console.error(err);
    alert("❌ Failed to cancel booking. Please try again.");
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
document.addEventListener("DOMContentLoaded", loadClientBookings);