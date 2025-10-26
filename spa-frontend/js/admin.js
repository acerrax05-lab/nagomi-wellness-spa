// js/admin.js
const apiBase = "http://localhost:5000/api";
const token = localStorage.getItem("token");
const user = JSON.parse(localStorage.getItem("user") || "{}");

// Protect route — only admin can access
if (!token || user.role !== "admin") {
  alert("Access denied! Please log in as admin.");
  window.location.href = "login.html";
}

// Loader element reference
const loader = document.getElementById("loader");

async function loadDashboard() {
  try {
    const res = await fetch(`${apiBase}/bookings`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      throw new Error('Failed to fetch bookings');
    }

    const bookings = await res.json();

    // === OVERVIEW STATS ===
    const today = new Date().toDateString();
    const todayBookings = bookings.filter(b => new Date(b.date).toDateString() === today);
    const totalRevenue = todayBookings.reduce((sum, b) => sum + (b.price || 0), 0);
    
    // Get unique therapists
    const activeTherapists = new Set(
      bookings
        .filter(b => b.therapist && b.therapist._id)
        .map(b => b.therapist._id)
    ).size;

    // Service popularity
    const servicePopularity = {};
    bookings.forEach(b => {
      if (b.service && b.service.name) {
        const serviceName = b.service.name;
        servicePopularity[serviceName] = (servicePopularity[serviceName] || 0) + 1;
      }
    });

    const topService = Object.entries(servicePopularity).sort((a, b) => b[1] - a[1])[0];

    // === UPDATE OVERVIEW CARDS ===
    document.getElementById("todayBookings").textContent = `Today's Bookings: ${todayBookings.length}`;
    document.getElementById("totalRevenue").textContent = `Daily Revenue: ₱${totalRevenue.toLocaleString()}`;
    document.getElementById("activeTherapists").textContent = `Active Therapists: ${activeTherapists}`;
    document.getElementById("completionRate").textContent = `Top Service: ${topService ? topService[0] : "N/A"}`;

    // === BOOKINGS TABLE ===
    const tbody = document.querySelector("#bookingsTable tbody");
    tbody.innerHTML = bookings.slice(-10).reverse().map(b => {
      // Handle both registered clients and guest bookings
      const clientName = b.client ? b.client.name : (b.guestName || "Guest");
      const serviceName = b.service ? b.service.name : "N/A";
      const therapistName = b.therapist ? b.therapist.name : "Unassigned";
      const bookingDate = new Date(b.date).toLocaleString();
      
      return `
        <tr>
          <td>${clientName}</td>
          <td>${serviceName}</td>
          <td>${therapistName}</td>
          <td>${bookingDate}</td>
          <td><span class="status-${b.status.toLowerCase()}">${b.status}</span></td>
          <td>₱${(b.price || 0).toLocaleString()}</td>
        </tr>
      `;
    }).join('');

    // === CHARTS ===
    makeRevenueChart(bookings);
    makePeakHoursChart(bookings);
    makeServiceChart(bookings);

    // Hide loader after charts load
    setTimeout(() => {
      loader.style.opacity = 0;
      setTimeout(() => loader.style.display = "none", 600);
    }, 800);

  } catch (err) {
    console.error(err);
    alert("Failed to load dashboard data. Please check your connection and try again.");
    loader.style.display = "none";
  }
}

// === REVENUE CHART ===
function makeRevenueChart(bookings) {
  const monthlyRevenue = {};
  bookings.forEach(b => {
    const date = new Date(b.date);
    const month = date.toLocaleString("en-US", { month: "short" });
    monthlyRevenue[month] = (monthlyRevenue[month] || 0) + (b.price || 0);
  });

  const months = Object.keys(monthlyRevenue);
  const values = Object.values(monthlyRevenue);

  new Chart(document.getElementById("revenueChart"), {
    type: 'bar',
    data: {
      labels: months,
      datasets: [{
        label: "Revenue (₱)",
        data: values,
        backgroundColor: "#f7a9a8",
        borderRadius: 6,
        barThickness: 30
      }]
    },
    options: {
      plugins: {
        tooltip: {
          backgroundColor: "#fff",
          titleColor: "#111",
          bodyColor: "#111",
          borderColor: "#f7a9a8",
          borderWidth: 1,
          callbacks: {
            label: function(context) {
              return '₱' + context.parsed.y.toLocaleString();
            }
          }
        },
        legend: { display: false }
      },
      scales: {
        y: { 
          beginAtZero: true, 
          grid: { color: "#f2f2f2" },
          ticks: {
            callback: function(value) {
              return '₱' + value.toLocaleString();
            }
          }
        },
        x: { grid: { display: false } }
      }
    }
  });
}

// === PEAK HOURS CHART ===
function makePeakHoursChart(bookings) {
  const hourlyCount = Array(24).fill(0);
  bookings.forEach(b => {
    const hour = new Date(b.date).getHours();
    hourlyCount[hour]++;
  });

  const labels = hourlyCount.map((_, i) => `${i}:00`);

  new Chart(document.getElementById("peakHoursChart"), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: "Bookings",
        data: hourlyCount,
        backgroundColor: "#ffc3c3",
        borderRadius: 6
      }]
    },
    options: {
      indexAxis: 'y',
      plugins: {
        tooltip: {
          backgroundColor: "#fff",
          titleColor: "#111",
          bodyColor: "#111",
          borderColor: "#f7a9a8",
          borderWidth: 1
        },
        legend: { display: false }
      },
      scales: {
        x: { beginAtZero: true, grid: { color: "#f2f2f2" } },
        y: { grid: { display: false } }
      }
    }
  });
}

// === MOST BOOKED SERVICES CHART ===
function makeServiceChart(bookings) {
  const serviceCount = {};
  bookings.forEach(b => {
    if (b.service && b.service.name) {
      const name = b.service.name;
      serviceCount[name] = (serviceCount[name] || 0) + 1;
    }
  });

  new Chart(document.getElementById("servicesChart"), {
    type: 'bar',
    data: {
      labels: Object.keys(serviceCount),
      datasets: [{
        label: "Service Popularity",
        data: Object.values(serviceCount),
        backgroundColor: ["#ffb6b6", "#f9d5bb", "#f7a9a8", "#fddbb0"],
        borderRadius: 6
      }]
    },
    options: {
      indexAxis: 'y',
      plugins: {
        tooltip: {
          backgroundColor: "#fff",
          titleColor: "#111",
          bodyColor: "#111",
          borderColor: "#f7a9a8",
          borderWidth: 1
        },
        legend: { display: false }
      },
      scales: {
        x: { beginAtZero: true, grid: { color: "#f2f2f2" } },
        y: { grid: { display: false } }
      }
    }
  });
}

// === LOGOUT HANDLER ===
document.getElementById("logoutBtn").addEventListener("click", (e) => {
  e.preventDefault();
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  alert("Logged out successfully!");
  window.location.href = "login.html";
});

document.addEventListener("DOMContentLoaded", loadDashboard);