// spa-frontend/js/booking.js - WITH SUMMARY MODAL AND FIXED THERAPIST SELECTION

const API_URL = "http://localhost:5000/api";

document.addEventListener("DOMContentLoaded", async () => {
  const form = document.querySelector(".booking-form");
  const charCount = document.querySelector(".char-count");
  const textarea = form.querySelector("textarea");
  const totalBox = document.querySelector(".total-box span");
  const downNote = document.querySelector(".down-note");
  const numClientsInput = document.getElementById("numClients");
  const maxSelectionsSpan = document.getElementById("maxSelections");
  const dropdownDisplay = document.getElementById("dropdownDisplay");
  const dropdownOptions = document.getElementById("dropdownOptions");
  const therapistDropdown = document.getElementById("therapistDropdown");
  const preferredTimeSelect = document.getElementById("preferredTime");
  const endTimeDisplay = document.getElementById("end-time-display");

  // Summary modal elements
  const summaryModal = document.getElementById("summaryModal");
  const backToEditBtn = document.getElementById("backToEdit");
  const confirmBookingBtn = document.getElementById("confirmBookingBtn");

  // Load therapists dynamically
  await loadTherapists();

  // Character counter
  textarea.addEventListener("input", () => {
    charCount.textContent = `${textarea.value.length}/500 characters`;
  });

  // Initialize
  let selectedService = "";
  let selectedMinutes = "";
  let totalAmount = 0;
  let selectedTherapists = [];
  
  totalBox.textContent = "₱0";
  downNote.textContent = "A 25% down payment will be calculated after selecting a service.";

  // Pricing table
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

  // Load therapists from backend
  async function loadTherapists() {
    try {
      const res = await fetch(`${API_URL}/auth/therapists`);
      const therapists = await res.json();

      // Clear existing therapist options except "any"
      const existingOptions = dropdownOptions.querySelectorAll('.option-item');
      existingOptions.forEach((option, index) => {
        if (index > 0) option.remove();
      });

      // Add therapists from backend
      therapists.forEach(t => {
        const optionDiv = document.createElement('div');
        optionDiv.className = 'option-item';
        const id = t._id;
        optionDiv.innerHTML = `
          <input type="checkbox" id="therapist-${id}" value="${t.name}" data-id="${id}">
          <label for="therapist-${id}">${t.name}</label>
        `;
        dropdownOptions.appendChild(optionDiv);
      });

      console.log(`✅ Loaded ${therapists.length} therapists`);
      setupTherapistDropdown();
    } catch (err) {
      console.error('Failed to load therapists:', err);
    }
  }

  // Setup therapist dropdown functionality
  function setupTherapistDropdown() {
    const anyCheckbox = document.getElementById('any-therapist');
    const otherCheckboxes = Array.from(dropdownOptions.querySelectorAll('input[type="checkbox"]:not(#any-therapist)'));

    // Toggle dropdown
    dropdownDisplay.addEventListener('click', () => {
      dropdownOptions.classList.toggle('show');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!therapistDropdown.contains(e.target)) {
        dropdownOptions.classList.remove('show');
      }
    });

    // Disable/enable checkboxes based on selection limit
    function updateCheckboxStates() {
      const numClients = parseInt(numClientsInput.value);
      const maxSelections = numClients;
      
      selectedTherapists = otherCheckboxes
        .filter(cb => cb.checked)
        .map(cb => ({ name: cb.value, id: cb.dataset.id }));

      // If max selections reached, disable unchecked boxes
      if (selectedTherapists.length >= maxSelections) {
        otherCheckboxes.forEach(cb => {
          if (!cb.checked) {
            cb.disabled = true;
            cb.parentElement.style.opacity = '0.5';
            cb.parentElement.style.cursor = 'not-allowed';
          }
        });
      } else {
        // Enable all checkboxes if under the limit
        otherCheckboxes.forEach(cb => {
          cb.disabled = false;
          cb.parentElement.style.opacity = '1';
          cb.parentElement.style.cursor = 'pointer';
        });
      }
    }

    // Handle checkbox changes
    function updateTherapistSelection(e) {
      const numClients = parseInt(numClientsInput.value);
      const maxSelections = numClients;
      maxSelectionsSpan.textContent = maxSelections;

      // If this is a checkbox event (not initial load)
      if (e && e.target) {
        // Count checked BEFORE this change (excluding the current target)
        const currentlyCheckedCount = otherCheckboxes.filter(cb => cb.checked && cb !== e.target).length;
        
        // If trying to check a box and already at limit, prevent it
        if (e.target.checked && currentlyCheckedCount >= maxSelections) {
          e.target.checked = false;
          alert(`You can only select up to ${maxSelections} therapist(s) for ${numClients} client(s).`);
          return;
        }
      }

      selectedTherapists = otherCheckboxes
        .filter(cb => cb.checked)
        .map(cb => ({ name: cb.value, id: cb.dataset.id }));

      // Update "Any" checkbox
      if (selectedTherapists.length > 0) {
        anyCheckbox.checked = false;
      }

      // Update checkbox states (disable/enable)
      updateCheckboxStates();

      // Update display
      updateDropdownDisplay();
    }

    function updateDropdownDisplay() {
      if (anyCheckbox.checked) {
        dropdownDisplay.querySelector('.placeholder').textContent = 'Any available therapist';
      } else if (selectedTherapists.length === 0) {
        dropdownDisplay.querySelector('.placeholder').textContent = 'Select therapists...';
      } else {
        const names = selectedTherapists.map(t => t.name).join(', ');
        dropdownDisplay.querySelector('.placeholder').textContent = names;
      }
    }

    // Any therapist checkbox
    anyCheckbox.addEventListener('change', () => {
      if (anyCheckbox.checked) {
        otherCheckboxes.forEach(cb => {
          cb.checked = false;
          cb.disabled = false;
          cb.parentElement.style.opacity = '1';
          cb.parentElement.style.cursor = 'pointer';
        });
        selectedTherapists = [];
        updateDropdownDisplay();
      }
    });

    // Other checkboxes - pass event to handler
    otherCheckboxes.forEach(cb => {
      cb.addEventListener('change', (e) => updateTherapistSelection(e));
    });

    // Number of clients change - reset selections if needed
    numClientsInput.addEventListener('input', () => {
      const numClients = parseInt(numClientsInput.value);
      
      // If reducing number of clients, uncheck excess selections
      selectedTherapists = otherCheckboxes
        .filter(cb => cb.checked)
        .map(cb => ({ name: cb.value, id: cb.dataset.id }));

      if (selectedTherapists.length > numClients) {
        // Uncheck excess therapists
        let unchecked = 0;
        for (let i = otherCheckboxes.length - 1; i >= 0; i--) {
          if (otherCheckboxes[i].checked && unchecked < (selectedTherapists.length - numClients)) {
            otherCheckboxes[i].checked = false;
            unchecked++;
          }
        }
      }

      updateTherapistSelection(null);
    });

    // Initial state
    updateTherapistSelection(null);
  }

  // Service button selection
  document.querySelectorAll(".option-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const group = btn.parentElement;
      group.querySelectorAll(".option-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      if (group.classList.contains("small")) {
        selectedMinutes = btn.textContent;
        calculateEndTime();
      } else {
        selectedService = btn.textContent;
      }

      updateTotal();
    });
  });

  // Calculate end time
  function calculateEndTime() {
    const startTime = preferredTimeSelect.value;
    if (!startTime || startTime === 'Select time...' || !selectedMinutes) {
      endTimeDisplay.textContent = '';
      return;
    }

    const duration = parseInt(selectedMinutes);
    const [time, period] = startTime.split(' ');
    let [hours, minutes] = time.split(':').map(Number);

    // Convert to 24-hour format
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;

    // Add duration
    minutes += duration;
    hours += Math.floor(minutes / 60);
    minutes = minutes % 60;

    // Convert back to 12-hour format
    const endPeriod = hours >= 12 ? 'PM' : 'AM';
    const endHours = hours > 12 ? hours - 12 : (hours === 0 ? 12 : hours);
    const endMinutes = minutes.toString().padStart(2, '0');

    endTimeDisplay.textContent = `End time: ${endHours}:${endMinutes} ${endPeriod}`;
    endTimeDisplay.style.cssText = 'margin-top: 8px; color: #666; font-size: 0.9rem;';
  }

  preferredTimeSelect.addEventListener('change', calculateEndTime);

  // Update total
  function updateTotal() {
    if (selectedService && selectedMinutes && prices[selectedService]) {
      const basePrice = prices[selectedService][selectedMinutes] || 0;
      const numClients = parseInt(numClientsInput.value);
      totalAmount = basePrice * numClients;
      
      const downPayment = Math.round(totalAmount * 0.25);
      totalBox.textContent = `₱${totalAmount.toLocaleString()}`;
      downNote.textContent = `A 25% down payment (₱${downPayment.toLocaleString()}) is required to confirm your booking.`;
    } else {
      totalBox.textContent = "₱0";
      downNote.textContent = "A 25% down payment will be calculated after selecting a service.";
    }
  }

  numClientsInput.addEventListener('input', updateTotal);

  // Format date for display
  function formatDate(dateString) {
    const date = new Date(dateString);
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
  }

  // Populate summary modal
  function populateSummary() {
    const date = form.querySelector('input[type="date"]').value;
    const time = preferredTimeSelect.value;
    const notes = textarea.value.trim();
    const name = form.querySelector('input[placeholder="Enter your full name"]').value;
    const phone = form.querySelector('input[placeholder="(555) 123-4567"]').value;
    const numClients = parseInt(numClientsInput.value);

    // Calculate end time
    const duration = parseInt(selectedMinutes);
    const [timeStr, period] = time.split(' ');
    let [hours, minutes] = timeStr.split(':').map(Number);
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    minutes += duration;
    hours += Math.floor(minutes / 60);
    minutes = minutes % 60;
    const endPeriod = hours >= 12 ? 'PM' : 'AM';
    const endHours = hours > 12 ? hours - 12 : (hours === 0 ? 12 : hours);
    const endTime = `${endHours}:${minutes.toString().padStart(2, '0')} ${endPeriod}`;

    // Populate summary fields
    document.getElementById('summary-service').textContent = selectedService;
    document.getElementById('summary-duration').textContent = selectedMinutes;
    document.getElementById('summary-clients').textContent = numClients;
    
    const therapistNames = selectedTherapists.length > 0 
      ? selectedTherapists.map(t => t.name).join(', ')
      : 'Any available therapist';
    document.getElementById('summary-therapists').textContent = therapistNames;
    
    document.getElementById('summary-date').textContent = formatDate(date);
    document.getElementById('summary-time').textContent = time;
    document.getElementById('summary-endtime').textContent = endTime;
    document.getElementById('summary-name').textContent = name;
    document.getElementById('summary-phone').textContent = phone;
    
    // Show/hide notes section
    const notesSection = document.getElementById('notes-section');
    if (notes) {
      document.getElementById('summary-notes').textContent = notes;
      notesSection.style.display = 'block';
    } else {
      notesSection.style.display = 'none';
    }
    
    const downPayment = Math.round(totalAmount * 0.25);
    document.getElementById('summary-total').textContent = `₱${totalAmount.toLocaleString()}`;
    document.getElementById('summary-downpayment').textContent = `₱${downPayment.toLocaleString()}`;
  }

  // Show summary modal
  function showSummaryModal() {
    populateSummary();
    summaryModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  // Hide summary modal
  function hideSummaryModal() {
    summaryModal.style.display = 'none';
    document.body.style.overflow = 'auto';
  }

  // Back to edit button
  backToEditBtn.addEventListener('click', hideSummaryModal);

  // Form submit - show summary instead of immediate booking
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const date = form.querySelector('input[type="date"]').value;
    const time = preferredTimeSelect.value;
    const name = form.querySelector('input[placeholder="Enter your full name"]').value;
    const phone = form.querySelector('input[placeholder="(555) 123-4567"]').value;

    if (!selectedService || !selectedMinutes || !date || !time || time === 'Select time...' || !name || !phone) {
      alert("Please fill in all required fields!");
      return;
    }

    // Show summary modal instead of submitting immediately
    showSummaryModal();
  });

  // Confirm booking button in modal - actual submission
  confirmBookingBtn.addEventListener('click', async () => {
    const date = form.querySelector('input[type="date"]').value;
    const time = preferredTimeSelect.value;
    const notes = textarea.value;
    const name = form.querySelector('input[placeholder="Enter your full name"]').value;
    const phone = form.querySelector('input[placeholder="(555) 123-4567"]').value;
    const numClients = parseInt(numClientsInput.value);

    // Calculate end time for backend
    const duration = parseInt(selectedMinutes);
    const [timeStr, period] = time.split(' ');
    let [hours, minutes] = timeStr.split(':').map(Number);
    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    minutes += duration;
    hours += Math.floor(minutes / 60);
    minutes = minutes % 60;
    const endPeriod = hours >= 12 ? 'PM' : 'AM';
    const endHours = hours > 12 ? hours - 12 : (hours === 0 ? 12 : hours);
    const endTime = `${endHours}:${minutes.toString().padStart(2, '0')} ${endPeriod}`;

    const bookingData = {
      service: selectedService,
      minutes: selectedMinutes,
      therapists: selectedTherapists.length > 0 ? selectedTherapists : [{ name: 'Any available therapist' }],
      numberOfClients: numClients,
      date,
      time,
      endTime,
      notes,
      name,
      phone,
      totalAmount
    };

    console.log('📤 Submitting booking:', bookingData);

    // Disable button during submission
    confirmBookingBtn.disabled = true;
    confirmBookingBtn.textContent = 'Processing...';

    try {
      const response = await fetch(`${API_URL}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bookingData)
      });

      const data = await response.json();

      if (response.ok) {
        // Hide modal
        hideSummaryModal();
        
        // Show success message
        alert("✅ Booking confirmed successfully! We'll contact you soon to confirm your appointment.");
        
        // Reset form
        form.reset();
        document.querySelectorAll(".option-btn").forEach((b) => b.classList.remove("active"));
        document.querySelectorAll('input[type="checkbox"]').forEach(cb => {
          if (cb.id === 'any-therapist') cb.checked = true;
          else cb.checked = false;
        });
        selectedService = "";
        selectedMinutes = "";
        selectedTherapists = [];
        updateTotal();
        dropdownDisplay.querySelector('.placeholder').textContent = 'Select therapists...';
        endTimeDisplay.textContent = '';
      } else {
        alert(`⚠️ ${data.msg || "Booking failed. Please try again."}`);
      }
    } catch (error) {
      console.error("Error submitting booking:", error);
      alert("❌ Server error. Please try again later.");
    } finally {
      // Re-enable button
      confirmBookingBtn.disabled = false;
      confirmBookingBtn.textContent = 'Confirm Booking →';
    }
  });
});