// js/app.js
const apiBase = "http://localhost:5000/api";

async function loadServices() {
  try {
    const res = await fetch(`${apiBase}/services`);
    const services = await res.json();
    const container = document.getElementById("service-list");

    container.innerHTML = services.map(s => `
      <div class="service-card">
        <h3>${s.name}</h3>
        <p>${s.description}</p>
        <p><strong>${s.price} PHP</strong> — ${s.durationMinutes} mins</p>
      </div>
    `).join('');
  } catch (err) {
    console.error(err);
  }
}

document.addEventListener("DOMContentLoaded", loadServices);
