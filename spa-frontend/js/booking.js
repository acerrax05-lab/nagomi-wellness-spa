// js/booking.js - FIXED VERSION
const API_URL = "http://localhost:5000/api";

// State variables 
let selectedService = "";
let selectedMinutes = "";
let totalAmount = 0;
let selectedTherapists = [];
let allTherapists = [];
let bookedDates = [];
let services = [];

// DOM elements 
let form, charCount, textarea, totalBox, downNote, numClientsInput;
let maxSelectionsSpan, dropdownDisplay, dropdownOptions, therapistDropdown;
let preferredTimeSelect, endTimeDisplay, dateInput, summaryModal;
let backToEditBtn, confirmBookingBtn;

document.addEventListener("DOMContentLoaded", async () => {
  // Initialize DOM elements
  form = document.querySelector(".booking-form");
  charCount = document.querySelector(".char-count");
  textarea = form.querySelector("textarea");
  totalBox = document.querySelector(".total-box span");
  downNote = document.querySelector(".down-note");
  numClientsInput = document.getElementById("numClients");
  maxSelectionsSpan = document.getElementById("maxSelections");
  dropdownDisplay = document.getElementById("dropdownDisplay");
  dropdownOptions = document.getElementById("dropdownOptions");
  therapistDropdown = document.getElementById("therapistDropdown");
  preferredTimeSelect = document.getElementById("preferredTime");
  endTimeDisplay = document.getElementById("end-time-display");
  dateInput = form.querySelector('input[type="date"]');
  summaryModal = document.getElementById("summaryModal");
  backToEditBtn = document.getElementById("backToEdit");
  confirmBookingBtn = document.getElementById("confirmBookingBtn");
  
  totalBox.textContent = "₱0";
  downNote.textContent = "A 25% down payment will be calculated after selecting a service.";

  // Mobile menu functionality
  const hamburger = document.getElementById('hamburger');
  const navLinks = document.getElementById('navLinks');
  const navItems = navLinks.querySelectorAll('a');
  
  if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('active');
      navLinks.classList.toggle('active');
      document.body.style.overflow = navLinks.classList.contains('active') ? 'hidden' : '';
    });
    
    navItems.forEach(item => {
      item.addEventListener('click', () => {
        hamburger.classList.remove('active');
        navLinks.classList.remove('active');
        document.body.style.overflow = '';
      });
    });
    
    document.addEventListener('click', (e) => {
      const navbar = document.getElementById('navbar');
      if (navbar && !navbar.contains(e.target) && navLinks.classList.contains('active')) {
        hamburger.classList.remove('active');
        navLinks.classList.remove('active');
        document.body.style.overflow = '';
      }
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 768 && navLinks.classList.contains('active')) {
        hamburger.classList.remove('active');
        navLinks.classList.remove('active');
        document.body.style.overflow = '';
      }
    });
  }

  // Character counter
  textarea.addEventListener("input", () => {
    charCount.textContent = `${textarea.value.length}/500 characters`;
  });

  // Load services from backend
  async function loadServices() {
    try {
      const res = await fetch(`${API_URL}/services`);
      services = await res.json();
      console.log('✅ Loaded services:', services.length);
    } catch (err) {
      console.error('Failed to load services:', err);
    }
  }

  // Load therapists from backend
  async function loadTherapists() {
    try {
      const res = await fetch(`${API_URL}/auth/therapists`);
      allTherapists = await res.json();

      const existingOptions = dropdownOptions.querySelectorAll('.option-item');
      existingOptions.forEach((option, index) => {
        if (index > 0) option.remove();
      });

      allTherapists.forEach(t => {
        const optionDiv = document.createElement('div');
        optionDiv.className = 'option-item';
        const id = t._id;
        optionDiv.innerHTML = `
          <input type="checkbox" id="therapist-${id}" value="${t.name}" 
            data-id="${id}" 
            data-expertise='${JSON.stringify(t.expertise || [])}' 
            data-schedule='${JSON.stringify(t.weeklySchedule || [])}'>
          <label for="therapist-${id}">${t.name}</label>
        `;
        dropdownOptions.appendChild(optionDiv);
      });

      console.log(`✅ Loaded ${allTherapists.length} therapists`);
      setupTherapistDropdown();
    } catch (err) {
      console.error('Failed to load therapists:', err);
    }
  }

  // Load booked dates for calendar highlighting
  async function loadBookedDates() {
    try {
      const now = new Date();
      const year = now.getFullYear();
      const month = now.getMonth();
      
      const res = await fetch(`${API_URL}/bookings/booked-dates?year=${year}&month=${month}`);
      const data = await res.json();
      bookedDates = data.bookedDates || [];
      
      console.log('✅ Loaded booked dates:', bookedDates.length);
      highlightBookedDatesOnCalendar();
    } catch (err) {
      console.error('Failed to load booked dates:', err);
    }
  }

  function highlightBookedDatesOnCalendar() {
    if (dateInput && bookedDates.length > 0) {
      dateInput.addEventListener('change', () => {
        const selected = dateInput.value;
        let indicator = document.getElementById('date-indicator');
        
        if (bookedDates.includes(selected)) {
          if (!indicator) {
            indicator = document.createElement('div');
            indicator.id = 'date-indicator';
            indicator.style.cssText = `
              background: #d4edda;
              color: #155724;
              padding: 8px 12px;
              border-radius: 6px;
              margin-top: 8px;
              font-size: 0.85rem;
              font-weight: 500;
              border-left: 3px solid #28a745;
            `;
            indicator.innerHTML = '✓ This date has existing bookings';
            dateInput.parentElement.appendChild(indicator);
          }
        } else {
          if (indicator) indicator.remove();
        }
      });
    }
  }

  // Check availability
  async function checkAvailability() {
    // Don't check if required fields are missing
    if (!selectedService || !selectedMinutes || !dateInput.value || 
        !preferredTimeSelect.value || preferredTimeSelect.value === 'Select time...') {
      // Reset therapist list when fields are incomplete
      resetTherapistAvailability();
      return;
    }

    try {
      const res = await fetch(`${API_URL}/bookings/check-availability`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service: selectedService,
          date: dateInput.value,
          time: preferredTimeSelect.value,
          durationMinutes: parseInt(selectedMinutes)
        })
      });

      if (!res.ok) {
        console.error('Availability check failed:', res.status);
        resetTherapistAvailability();
        return;
      }

      const data = await res.json();
      const availableTherapists = data.available || [];
      
      console.log('✅ Available therapists:', availableTherapists.length);
      console.log('📋 Details:', availableTherapists.map(t => t.name));
      
      updateTherapistAvailability(availableTherapists);
      
      if (availableTherapists.length === 0) {
        showNotification('⚠️ No therapists available for this service at the selected time. Please choose a different time or date.', 'warning');
      }
      
    } catch (err) {
      console.error('Availability check error:', err);
      resetTherapistAvailability();
    }
  }

  function resetTherapistAvailability() {
    const otherCheckboxes = Array.from(dropdownOptions.querySelectorAll('input[type="checkbox"]:not(#any-therapist)'));
    
    otherCheckboxes.forEach(cb => {
      cb.disabled = false;
      cb.parentElement.style.opacity = '1';
      cb.parentElement.style.cursor = 'pointer';
      cb.parentElement.style.background = '';
      
      const label = cb.parentElement.querySelector('label');
      label.style.color = '#333';
      label.style.textDecoration = 'none';
      label.title = '';
    });
    
    console.log('🔄 Reset therapist availability to default');
  }

  // Update therapist dropdown based on availability
  function updateTherapistAvailability(availableTherapists) {
    const availableIds = availableTherapists.map(t => t.id);
    const otherCheckboxes = Array.from(dropdownOptions.querySelectorAll('input[type="checkbox"]:not(#any-therapist)'));
    
    console.log('🔍 Updating therapist availability');
    console.log('✅ Available IDs:', availableIds);
    
    otherCheckboxes.forEach(cb => {
      const therapistId = cb.dataset.id;
      const therapistName = cb.value;
      const therapistExpertise = JSON.parse(cb.dataset.expertise || '[]');
      
      // Check expertise first
      const hasExpertise = therapistExpertise.length === 0 || therapistExpertise.includes(selectedService);
      
      // Then check time availability
      const isAvailableAtTime = availableIds.includes(therapistId);
      
      console.log(`👤 ${therapistName}:`, {
        hasExpertise,
        isAvailableAtTime,
        expertise: therapistExpertise
      });
      
      // Disable if either expertise OR time availability fails
      if (!hasExpertise || !isAvailableAtTime) {
        cb.disabled = true;
        cb.checked = false;
        cb.parentElement.style.opacity = '0.5';
        cb.parentElement.style.cursor = 'not-allowed';
        cb.parentElement.style.background = '#f5f5f5';
        
        const label = cb.parentElement.querySelector('label');
        label.style.color = '#999';
        label.style.textDecoration = 'line-through';
        
        // Show appropriate message
        if (!hasExpertise) {
          label.title = `❌ Not qualified for ${selectedService}`;
          console.log(`  └─ ❌ No expertise`);
        } else {
          label.title = '⏰ Not available at this time (booked/break/off)';
          console.log(`  └─ ⏰ Not available at selected time`);
        }
      } else {
        // Both expertise AND time availability passed
        cb.disabled = false;
        cb.parentElement.style.opacity = '1';
        cb.parentElement.style.cursor = 'pointer';
        cb.parentElement.style.background = '';
        
        const label = cb.parentElement.querySelector('label');
        label.style.color = '#333';
        label.style.textDecoration = 'none';
        label.title = '✅ Available';
        console.log(`  └─ ✅ Available (expertise + time)`);
      }
    });
    
    // Remove selected therapists that are no longer available
    selectedTherapists = selectedTherapists.filter(st => {
      const cb = otherCheckboxes.find(checkbox => checkbox.dataset.id === st.id);
      return cb && !cb.disabled;
    });
    
    // Uncheck disabled therapists
    otherCheckboxes.forEach(cb => {
      if (cb.disabled && cb.checked) {
        cb.checked = false;
      }
    });
    
    updateDropdownDisplay();
  }

  // Filter therapists by expertise
  function filterTherapistsByExpertise() {
    if (!selectedService) {
      resetTherapistAvailability();
      return;
    }
    
    const otherCheckboxes = Array.from(dropdownOptions.querySelectorAll('input[type="checkbox"]:not(#any-therapist)'));
    
    console.log('🔍 Filtering by expertise for:', selectedService);
    
    otherCheckboxes.forEach(cb => {
      const therapistName = cb.value;
      const therapistExpertise = JSON.parse(cb.dataset.expertise || '[]');
      
      const hasExpertise = therapistExpertise.length === 0 || therapistExpertise.includes(selectedService);
      
      if (!hasExpertise) {
        cb.disabled = true;
        cb.checked = false;
        cb.parentElement.style.opacity = '0.5';
        cb.parentElement.style.cursor = 'not-allowed';
        cb.parentElement.style.background = '#f5f5f5';
        
        const label = cb.parentElement.querySelector('label');
        label.style.color = '#999';
        label.style.textDecoration = 'line-through';
        label.title = `❌ Not qualified for ${selectedService}`;
        
        console.log(`  ❌ ${therapistName}: No expertise in ${selectedService}`);
      } else {
        cb.disabled = false;
        cb.parentElement.style.opacity = '1';
        cb.parentElement.style.cursor = 'pointer';
        cb.parentElement.style.background = '';
        
        const label = cb.parentElement.querySelector('label');
        label.style.color = '#333';
        label.style.textDecoration = 'none';
        label.title = '';
        
        console.log(`  ✅ ${therapistName}: Has expertise`);
      }
    });
    
    updateDropdownDisplay();
  }
  
  // Update dropdown display text
  function updateDropdownDisplay() {
    const anyCheckbox = document.getElementById('any-therapist');
    
    if (anyCheckbox && anyCheckbox.checked) {
      dropdownDisplay.querySelector('.placeholder').textContent = 'Any available therapist';
    } else if (selectedTherapists.length === 0) {
      dropdownDisplay.querySelector('.placeholder').textContent = 'Select therapists...';
    } else {
      const names = selectedTherapists.map(t => t.name).join(', ');
      dropdownDisplay.querySelector('.placeholder').textContent = names;
    }
  }

  // Update duration buttons based on service restrictions
  function updateDurationButtons() {
    const durationButtons = document.querySelectorAll('.option-grid.small .option-btn');
    
    if (!selectedService) {
      durationButtons.forEach(btn => {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
        btn.style.background = '#fff';
        btn.title = '';
      });
      return;
    }
    
    const service = services.find(s => s.name === selectedService);
    
    if (!service || !service.allowedDurations || service.allowedDurations.length === 0) {
      durationButtons.forEach(btn => {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
        btn.style.background = '#fff';
        btn.title = '';
      });
      return;
    }
    
    durationButtons.forEach(btn => {
      const btnText = btn.textContent.trim();
      const duration = parseInt(btnText);
      
      if (service.allowedDurations.includes(duration)) {
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.cursor = 'pointer';
        btn.style.background = '#fff';
        btn.title = '';
      } else {
        btn.disabled = true;
        btn.style.opacity = '0.4';
        btn.style.cursor = 'not-allowed';
        btn.style.background = '#e0e0e0';
        btn.title = `❌ Not available for ${selectedService}`;
        btn.classList.remove('active');
        
        if (selectedMinutes === btnText) {
          selectedMinutes = "";
          updateTotal();
          endTimeDisplay.textContent = '';
        }
      }
    });
  }

  // Setup therapist dropdown
  function setupTherapistDropdown() {
    const anyCheckbox = document.getElementById('any-therapist');
    const otherCheckboxes = Array.from(dropdownOptions.querySelectorAll('input[type="checkbox"]:not(#any-therapist)'));

    // Dropdown toggle
    dropdownDisplay.addEventListener('click', () => {
      dropdownOptions.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
      if (!therapistDropdown.contains(e.target)) {
        dropdownOptions.classList.remove('show');
      }
    });

    // Update therapist selection function
    function updateTherapistSelection(e) {
      const numClients = parseInt(numClientsInput.value);
      const maxSelections = numClients;
      maxSelectionsSpan.textContent = maxSelections;

      if (e && e.target) {
        const currentlyCheckedCount = otherCheckboxes.filter(cb => cb.checked && cb !== e.target).length;
        
        if (e.target.checked && currentlyCheckedCount >= maxSelections) {
          e.target.checked = false;
          showNotification(`You can only select up to ${maxSelections} therapist(s) for ${numClients} client(s).`, 'warning');
          return;
        }
      }

      selectedTherapists = otherCheckboxes
        .filter(cb => cb.checked)
        .map(cb => ({ name: cb.value, id: cb.dataset.id }));

      if (selectedTherapists.length > 0) {
        anyCheckbox.checked = false;
      }

      updateDropdownDisplay();
    }

    // Event listeners
    anyCheckbox.addEventListener('change', () => {
      if (anyCheckbox.checked) {
        otherCheckboxes.forEach(cb => {
          cb.checked = false;
        });
        selectedTherapists = [];
        updateDropdownDisplay();
      }
    });

    otherCheckboxes.forEach(cb => {
      cb.addEventListener('change', (e) => updateTherapistSelection(e));
    });

    numClientsInput.addEventListener('input', () => {
      const numClients = parseInt(numClientsInput.value);
      
      selectedTherapists = otherCheckboxes
        .filter(cb => cb.checked)
        .map(cb => ({ name: cb.value, id: cb.dataset.id }));

      if (selectedTherapists.length > numClients) {
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

    updateTherapistSelection(null);
  }

  // Service button selection with immediate expertise filter
  document.querySelectorAll(".option-grid:not(.small) .option-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const group = btn.parentElement;
      group.querySelectorAll(".option-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedService = btn.textContent;
      
      console.log('🎯 Service selected:', selectedService);
      
      updateDurationButtons();
      updateTotal();
      
      // Filter therapists by expertise IMMEDIATELY
      filterTherapistsByExpertise();
      
      // Only check full availability if ALL required fields are filled
      if (selectedMinutes && dateInput.value && preferredTimeSelect.value && preferredTimeSelect.value !== 'Select time...') {
        console.log('✅ All fields filled, checking full availability');
        checkAvailability();
      } else {
        console.log('⏳ Waiting for time/date selection to check availability');
      }
    });
  });

  // Minutes button selection
  document.querySelectorAll(".option-grid.small .option-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) {
        showNotification(`❌ This duration is not available for ${selectedService}`, 'error');
        return;
      }
      
      const group = btn.parentElement;
      group.querySelectorAll(".option-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      selectedMinutes = btn.textContent;
      
      calculateEndTime();
      updateTotal();
      checkAvailability();
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

    if (period === 'PM' && hours !== 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;

    minutes += duration;
    hours += Math.floor(minutes / 60);
    minutes = minutes % 60;

    const endPeriod = hours >= 12 ? 'PM' : 'AM';
    const endHours = hours > 12 ? hours - 12 : (hours === 0 ? 12 : hours);
    const endMinutes = minutes.toString().padStart(2, '0');

    endTimeDisplay.textContent = `End time: ${endHours}:${endMinutes} ${endPeriod}`;
    endTimeDisplay.style.cssText = 'margin-top: 8px; color: #f7c6a5; font-size: 0.9rem; font-weight: 500;';
  }

  preferredTimeSelect.addEventListener('change', () => {
    calculateEndTime();
    
    // Only check availability if service and duration are selected
    if (selectedService && selectedMinutes && dateInput.value) {
      console.log('⏰ Time selected, checking availability...');
      checkAvailability();
    } else {
      console.log('⏳ Service or duration not selected yet');
    }
  });

  dateInput.addEventListener('change', () => {
    checkAvailability();
  });

  // Update total price
  function updateTotal() {
    if (selectedService && selectedMinutes) {
      const service = services.find(s => s.name === selectedService);
      
      if (!service) {
        totalBox.textContent = "₱0";
        return;
      }
      
      const duration = parseInt(selectedMinutes);
      let basePrice = 0;
      
      if (service.pricing && service.pricing[duration]) {
        basePrice = service.pricing[duration];
      } else if (service.price) {
        basePrice = service.price;
      }
      
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
    const date = dateInput.value;
    const time = preferredTimeSelect.value;
    const notes = textarea.value.trim();
    const name = form.querySelector('input[placeholder="Enter your full name"]').value;
    const phone = form.querySelector('input[placeholder="(555) 123-4567"]').value;
    const numClients = parseInt(numClientsInput.value);

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
    
    // Reset payment method selection
    document.querySelectorAll('input[name="paymentMethod"]').forEach(radio => {
      radio.checked = false;
    });
  }

  // Show/hide summary modal
  function showSummaryModal() {
  populateSummary();
  summaryModal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  
  // RESET SCROLL TO TOP when modal opens
  const summaryContent = document.querySelector('.summary-content');
  if (summaryContent) {
    summaryContent.scrollTop = 0;
  }
  
  // Also reset the entire modal scroll if needed
  const summaryContainer = document.querySelector('.summary-container');
  if (summaryContainer) {
    summaryContainer.scrollTop = 0;
  }
}


  function hideSummaryModal() {
  summaryModal.style.display = 'none';
  document.body.style.overflow = 'auto';
  
  // ✅ RESET SCROLL when closing modal (for next time)
  const summaryContent = document.querySelector('.summary-content');
  if (summaryContent) {
    summaryContent.scrollTop = 0;
  }
}

  backToEditBtn.addEventListener('click', () => {
  hideSummaryModal();

   const bookingForm = document.querySelector('.booking-form');
  if (bookingForm) {
    bookingForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
});

  // Form submit
  form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const date = dateInput.value;
  const time = preferredTimeSelect.value;
  const name = form.querySelector('input[placeholder="Enter your full name"]').value;
  const phone = form.querySelector('input[placeholder="(555) 123-4567"]').value;

  if (!selectedService) {
    showNotification("❌ Please select a service!", 'error');
    return;
  }
  
  if (!selectedMinutes) {
    showNotification("❌ Please select duration!", 'error');
    return;
  }
  
  if (!date) {
    showNotification("❌ Please select a date!", 'error');
    return;
  }
  
  if (!time || time === 'Select time...') {
    showNotification("❌ Please select a time!", 'error');
    return;
  }
  
  if (!name || !phone) {
    showNotification("❌ Please fill in your name and phone number!", 'error');
    return;
  }

  showSummaryModal(); // This will now reset scroll automatically
});

  // SINGLE Confirm booking handler (with validation)
  confirmBookingBtn.addEventListener('click', async () => {
    // Validate terms checkbox
    const termsCheckbox = document.getElementById('termsCheckbox');
  if (!termsCheckbox.checked) {
    showNotification('❌ Please accept the Terms and Conditions to proceed', 'error');
    termsCheckbox.focus();
    
    // ✅ Scroll to terms checkbox in modal
    termsCheckbox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  
  const selectedPayment = document.querySelector('input[name="paymentMethod"]:checked');
  if (!selectedPayment) {
    showNotification('❌ Please select a payment method', 'error');
    
    // ✅ Scroll to payment section in modal
    const paymentSection = document.querySelector('.payment-section');
    if (paymentSection) {
      paymentSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return;
  }
    
    const paymentMethod = selectedPayment.value;
    
    const date = dateInput.value;
    const time = preferredTimeSelect.value;
    const notes = textarea.value;
    const name = form.querySelector('input[placeholder="Enter your full name"]').value;
    const phone = form.querySelector('input[placeholder="(555) 123-4567"]').value;
    const numClients = parseInt(numClientsInput.value);

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
      totalAmount,
      paymentMethod, // ✅ NOW INCLUDED
      termsAccepted: true // ✅ NOW INCLUDED
    };

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
      hideSummaryModal(); // This will reset scroll
      showNotification("✅ Booking confirmed successfully! We'll contact you soon.", 'success');
      
      // Reset form and scroll to top of page
      form.reset();
      window.scrollTo({ top: 0, behavior: 'smooth' });
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
    
    // Reset terms and payment
    termsCheckbox.checked = false;
    document.querySelectorAll('input[name="paymentMethod"]').forEach(radio => {
      radio.checked = false;
    });
    
    loadBookedDates();
  } else {
    showNotification(`⚠️ ${data.msg || "Booking failed. Please try again."}`, 'error');
  }
  } catch (error) {
    console.error("Error submitting booking:", error);
    showNotification("❌ Server error. Please try again later.", 'error');
  } finally {
    confirmBookingBtn.disabled = false;
    confirmBookingBtn.textContent = 'Confirm Booking →';
  }
});
// Notification helper
function showNotification(message, type = 'info') {
const existing = document.querySelectorAll('.booking-notification');
existing.forEach(n => n.remove());
const notification = document.createElement('div');
notification.className = 'booking-notification';
notification.style.cssText = `
  position: fixed;
  top: 20px;
  right: 20px;
  background: ${type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : type === 'warning' ? '#ffc107' : '#007bff'};
  color: white;
  padding: 16px 24px;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  z-index: 10001;
  animation: slideInRight 0.3s;
  max-width: 400px;
`;
notification.textContent = message;
document.body.appendChild(notification);

setTimeout(() => {
  notification.style.animation = 'slideOutRight 0.3s';
  setTimeout(() => notification.remove(), 300);
}, 5000);
}
// Add notification animations
const style = document.createElement('style');
style.textContent = `
@keyframes slideInRight {
from { transform: translateX(400px); opacity: 0; }
to { transform: translateX(0); opacity: 1; }
}
@keyframes slideOutRight {
  from { transform: translateX(0); opacity: 1; }
  to { transform: translateX(400px); opacity: 0; }
}
`;
document.head.appendChild(style);
// Add payment option hover effects
const paymentOptions = document.querySelectorAll('.payment-option');
paymentOptions.forEach(option => {
option.addEventListener('mouseenter', () => {
option.style.borderColor = '#4b2e1e';
option.style.background = '#f5f1eb';
});
option.addEventListener('mouseleave', () => {
  if (!option.querySelector('input[type="radio"]').checked) {
    option.style.borderColor = '#e0e0e0';
    option.style.background = 'white';
  }
});

const radio = option.querySelector('input[type="radio"]');
radio.addEventListener('change', () => {
  // Reset all options
  paymentOptions.forEach(opt => {
    opt.style.borderColor = '#e0e0e0';
    opt.style.background = 'white';
  });
  
  // Highlight selected
  if (radio.checked) {
    option.style.borderColor = '#4b2e1e';
    option.style.background = '#f5f1eb';
  }
});
});
// Initialize
await loadServices();
await loadTherapists();
await loadBookedDates();
});
// Show terms modal
function showTermsModal(e) {
e.preventDefault();
const termsModal = document.getElementById('termsModal');
termsModal.style.display = 'flex';
document.body.style.overflow = 'hidden';
}
// Close terms modal
function closeTermsModal() {
const termsModal = document.getElementById('termsModal');
termsModal.style.display = 'none';
document.body.style.overflow = 'auto';
}
// Accept terms from modal
function acceptTerms() {
document.getElementById('termsCheckbox').checked = true;
closeTermsModal();
}
// Make functions global
window.showTermsModal = showTermsModal;
window.closeTermsModal = closeTermsModal;
window.acceptTerms = acceptTerms;