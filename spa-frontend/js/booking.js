// spa-frontend/js/booking.js

document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector(".booking-form");
  const charCount = document.querySelector(".char-count");
  const textarea = form.querySelector("textarea");
  const totalBox = document.querySelector(".total-box span");
  const downNote = document.querySelector(".down-note");
  const API_URL = "http://localhost:5000/api/bookings";

  // === Character Counter ===
  textarea.addEventListener("input", () => {
    charCount.textContent = `${textarea.value.length}/500 characters`;
  });

  // === Initialize totals ===
  let selectedService = "";
  let selectedMinutes = "";
  let totalAmount = 0;
  totalBox.textContent = "₱0";
  downNote.textContent = "A 25% down payment will be calculated after selecting a service.";

  // === Pricing Table ===
  const prices = {
    "Nagomi Massage": { "60 minutes": 1199, "90 minutes": 1499, "120 minutes": 1799 },
    "Ventosa or Cupping Therapy": { "60 minutes": 999, "90 minutes": 1299, "120 minutes": 1599 },
    "Shiatsu Massage": { "60 minutes": 1099, "90 minutes": 1399, "120 minutes": 1699 },
    "Aromatherapy Massage": { "60 minutes": 1299, "90 minutes": 1599, "120 minutes": 1899 },
    "Combination Massage": { "60 minutes": 1399, "90 minutes": 1699, "120 minutes": 1999 },
    "Ayurvedic Massage": { "60 minutes": 1499, "90 minutes": 1799, "120 minutes": 2099 },
    "Deep Tissue Massage": { "60 minutes": 1299, "90 minutes": 1599, "120 minutes": 1899 },
    "Mandara Massage": { "60 minutes": 1399, "90 minutes": 1699, "120 minutes": 1999 },
    "Pre Natal Massage": { "60 minutes": 1199, "90 minutes": 1499, "120 minutes": 1799 },
    "Jade and Lavastone": { "60 minutes": 1499, "90 minutes": 1799, "120 minutes": 2099 },
    "Swedish Massage": { "60 minutes": 1099, "90 minutes": 1399, "120 minutes": 1699 },
    "Thai Massage": { "60 minutes": 1199, "90 minutes": 1499, "120 minutes": 1799 }
  };

  // === Option Buttons Behavior ===
  document.querySelectorAll(".option-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const group = btn.parentElement;
      group.querySelectorAll(".option-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      // Detect if service or minutes
      if (group.classList.contains("small")) {
        selectedMinutes = btn.textContent;
      } else {
        selectedService = btn.textContent;
      }

      updateTotal();
    });
  });

  // === Update Total and Down Payment ===
  function updateTotal() {
    if (selectedService && selectedMinutes && prices[selectedService]) {
      totalAmount = prices[selectedService][selectedMinutes] || 0;
      const downPayment = Math.round(totalAmount * 0.25);
      totalBox.textContent = `₱${totalAmount}`;
      downNote.textContent = `A 25% down payment (₱${downPayment}) is required to confirm your booking.`;
    } else {
      totalBox.textContent = "₱0";
      downNote.textContent = "A 25% down payment will be calculated after selecting a service.";
    }
  }

  // === Submit Form ===
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const therapist = form.querySelector("select").value;
    const date = form.querySelector('input[type="date"]').value;
    const time = form.querySelector('select[required]').value;
    const notes = textarea.value;
    const name = form.querySelector('input[placeholder="Enter your full name"]').value;
    const phone = form.querySelector('input[placeholder="(555) 123-4567"]').value;

    if (!selectedService || !selectedMinutes || !date || !time || !name || !phone) {
      alert("Please fill in all required fields!");
      return;
    }

    const bookingData = {
      service: selectedService,
      minutes: selectedMinutes,
      therapist,
      date,
      time,
      notes,
      name,
      phone,
      totalAmount
    };

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bookingData)
      });

      const data = await response.json();

      if (response.ok) {
        alert("✅ Booking confirmed! We'll contact you soon.");
        form.reset();
        document.querySelectorAll(".option-btn").forEach((b) => b.classList.remove("active"));
        selectedService = "";
        selectedMinutes = "";
        updateTotal(); // reset totals visually
      } else {
        alert(`⚠️ ${data.msg || "Booking failed. Please try again."}`);
      }
    } catch (error) {
      console.error("Error submitting booking:", error);
      alert("❌ Server error. Please try again later.");
    }
  });
});
