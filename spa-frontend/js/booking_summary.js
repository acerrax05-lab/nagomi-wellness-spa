document.addEventListener("DOMContentLoaded", () => {
  const form = document.querySelector(".booking-form");
  const totalBox = document.querySelector(".total-box span");
  const downNote = document.querySelector(".down-note");
  const textarea = form.querySelector("textarea");
  const charCount = document.querySelector(".char-count");
  const timeSelect = document.getElementById("preferredTime");
  const numClientsSelect = document.getElementById("numClients");
  const endTimeDisplay = document.getElementById("end-time-display");

  // === MODAL ELEMENTS ===
  const summaryModal = document.getElementById("summaryModal");
  const closeModalBtn = document.getElementById("closeModalBtn");
  const printBtn = document.getElementById("printBtn");

  // === THERAPIST SELECTOR ===
  const therapistDropdown = document.getElementById("therapistDropdown");
  const dropdownDisplay = document.getElementById("dropdownDisplay");
  const dropdownOptions = document.getElementById("dropdownOptions");
  const maxSelectionsSpan = document.getElementById("maxSelections");
  const selectionInfo = document.getElementById("selectionInfo");

  let selectedService = "";
  let selectedMinutes = "";
  let totalAmount = 0;
  let numClients = 1;
  let selectedTherapists = ["any"];
  let maxTherapists = 1;

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

  // === THERAPIST DROPDOWN LOGIC ===
  function initTherapistSelector() {
    updateMaxTherapists();
    updateTherapistDisplay();

    dropdownDisplay.addEventListener("click", (e) => {
      e.stopPropagation();
      therapistDropdown.classList.toggle("open");
    });

    document.addEventListener("click", (e) => {
      if (!therapistDropdown.contains(e.target)) therapistDropdown.classList.remove("open");
    });

    dropdownOptions.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.addEventListener("change", handleTherapistSelection);
    });
  }

  function updateMaxTherapists() {
    numClients = parseInt(numClientsSelect.value) || 1;
    maxTherapists = numClients;
    maxSelectionsSpan.textContent = maxTherapists;

    if (selectedTherapists.includes("any")) return;

    if (selectedTherapists.length > maxTherapists) {
      selectedTherapists = selectedTherapists.slice(0, maxTherapists);
      dropdownOptions.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.checked = selectedTherapists.includes(cb.value);
      });
    }

    updateTherapistDisplay();
    updateCheckboxStates();
  }

  function handleTherapistSelection(e) {
    const checkbox = e.target;
    const value = checkbox.value;
    const anyCheckbox = document.getElementById("any-therapist");

    if (value === "any") {
      if (checkbox.checked) {
        selectedTherapists = ["any"];
        dropdownOptions.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
          if (cb.id !== "any-therapist") cb.checked = false;
        });
      } else {
        selectedTherapists = [];
      }
    } else {
      if (checkbox.checked) {
        anyCheckbox.checked = false;
        selectedTherapists = selectedTherapists.filter((t) => t !== "any");

        if (selectedTherapists.length < maxTherapists) {
          selectedTherapists.push(value);
        } else {
          checkbox.checked = false;
          alert(`You can only select up to ${maxTherapists} therapist(s).`);
        }
      } else {
        selectedTherapists = selectedTherapists.filter((t) => t !== value);
        if (selectedTherapists.length === 0) {
          anyCheckbox.checked = true;
          selectedTherapists = ["any"];
        }
      }
    }

    updateTherapistDisplay();
    updateCheckboxStates();
  }

  function updateCheckboxStates() {
    const checkboxes = dropdownOptions.querySelectorAll('input[type="checkbox"]:not(#any-therapist)');
    const anySelected = selectedTherapists.includes("any");
    const limitReached = selectedTherapists.length >= maxTherapists && !anySelected;

    checkboxes.forEach((checkbox) => {
      const optionItem = checkbox.closest(".option-item");
      if (anySelected || (limitReached && !checkbox.checked)) {
        checkbox.disabled = true;
        optionItem.classList.add("disabled");
      } else {
        checkbox.disabled = false;
        optionItem.classList.remove("disabled");
      }
    });
  }

  function updateTherapistDisplay() {
    const placeholder = dropdownDisplay.querySelector(".placeholder");
    if (selectedTherapists.includes("any")) {
      placeholder.textContent = "Any available therapist";
      selectionInfo.textContent = "Any available therapist selected";
    } else if (selectedTherapists.length === 1) {
      placeholder.textContent = selectedTherapists[0];
      selectionInfo.textContent = `Select up to ${maxTherapists} therapist(s)`;
    } else {
      placeholder.textContent = `${selectedTherapists.length} therapists selected`;
      selectionInfo.textContent = `Maximum: ${maxTherapists} therapist(s)`;
    }
  }

  // === CHARACTER COUNTER ===
  textarea.addEventListener("input", () => {
    charCount.textContent = `${textarea.value.length}/500 characters`;
  });

  // === SERVICE & MINUTES SELECTION ===
  document.querySelectorAll(".option-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const group = btn.parentElement;
      const isSmall = group.classList.contains("small");
      const isActive = btn.classList.contains("active");

      if (isActive) {
        btn.classList.remove("active");
        if (isSmall) selectedMinutes = "";
        else selectedService = "";
      } else {
        group.querySelectorAll(".option-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        if (isSmall) selectedMinutes = btn.textContent;
        else selectedService = btn.textContent;
      }

      displayEndTime();
      updateTotal();
    });
  });

  numClientsSelect.addEventListener("change", () => {
    updateMaxTherapists();
    updateTotal();
  });

  // === CALCULATE END TIME ===
  function calculateEndTime(startTime, durationMinutes) {
    if (!startTime || startTime === "Select time..." || !durationMinutes) return "";
    const [time, period] = startTime.split(" ");
    const [hours, minutes] = time.split(":").map(Number);
    let hour24 = hours % 12 + (period === "PM" ? 12 : 0);
    const totalMinutes = hour24 * 60 + minutes + durationMinutes;
    const endHour24 = Math.floor(totalMinutes / 60);
    const finalMinutes = totalMinutes % 60;
    const endPeriod = endHour24 >= 12 ? "PM" : "AM";
    const endHour12 = endHour24 % 12 || 12;
    return `${endHour12}:${finalMinutes.toString().padStart(2, "0")} ${endPeriod}`;
  }

  function displayEndTime() {
    const startTime = timeSelect.value;
    const duration = parseInt(selectedMinutes);
    if (startTime && duration) {
      const endTime = calculateEndTime(startTime, duration);
      endTimeDisplay.textContent = `Session ends at: ${endTime}`;
    } else {
      endTimeDisplay.textContent = "";
    }
  }

  timeSelect.addEventListener("change", displayEndTime);

  // === UPDATE TOTAL ===
  function updateTotal() {
    numClients = parseInt(numClientsSelect.value) || 1;

    if (selectedService && selectedMinutes && prices[selectedService]) {
      const base = prices[selectedService][selectedMinutes];
      const total = base * numClients;
      const down = Math.round(total * 0.25);
      totalAmount = total;
      totalBox.textContent = `₱${total}`;
      downNote.textContent = `A 25% down payment (₱${down}) is required to confirm your booking.`;
    } else {
      totalAmount = 0;
      totalBox.textContent = "₱0";
      downNote.textContent = "A 25% down payment will be calculated after selecting a service.";
    }
  }

  // === BOOKING SUMMARY MODAL ===
  function generateBookingReference() {
    const year = new Date().getFullYear();
    const random = Math.floor(1000 + Math.random() * 9000);
    return `NGM-${year}-${random}`;
  }

  function formatDate(dateString) {
    if (!dateString) return "-";
    const date = new Date(dateString);
    const options = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
    return date.toLocaleDateString("en-US", options);
  }

  function populateSummary() {
    const fullName = document.getElementById("fullName").value;
    const phoneNumber = document.getElementById("phoneNumber").value;
    const preferredDate = document.getElementById("preferredDate").value;
    const preferredTime = timeSelect.value;
    const specialNotes = document.getElementById("specialNotes").value;

    document.getElementById("summaryService").textContent = selectedService || "-";
    document.getElementById("summaryDuration").textContent = selectedMinutes || "-";
    document.getElementById("summaryDate").textContent = formatDate(preferredDate);
    document.getElementById("summaryTime").textContent = preferredTime !== "Select time..." ? preferredTime : "-";
    document.getElementById("summaryClients").textContent = numClients;

    const therapistText = selectedTherapists.includes("any") ? "Any available therapist" : selectedTherapists.join(", ");
    document.getElementById("summaryTherapist").textContent = therapistText;

    document.getElementById("summaryName").textContent = fullName || "-";
    document.getElementById("summaryPhone").textContent = phoneNumber || "-";

    const notesSection = document.getElementById("notesSection");
    if (specialNotes.trim()) {
      document.getElementById("summaryNotes").textContent = specialNotes;
      notesSection.style.display = "block";
    } else {
      notesSection.style.display = "none";
    }

    const downPayment = Math.round(totalAmount * 0.25);
    document.getElementById("summaryTotal").textContent = `₱${totalAmount}`;
    document.getElementById("summaryDownPayment").textContent = `₱${downPayment}`;
    document.getElementById("bookingReference").textContent = generateBookingReference();
  }

  function showSummaryModal() {
    populateSummary();
    summaryModal.classList.add("show");
    document.body.style.overflow = "hidden";
  }

  function hideSummaryModal() {
    summaryModal.classList.remove("show");
    document.body.style.overflow = "auto";
  }

  function printSummary() {
    window.print();
  }

  // === RESET FORM ===
  function resetFormToDefault() {
    form.reset();
    selectedService = "";
    selectedMinutes = "";
    selectedTherapists = ["any"];
    numClients = 1;
    maxTherapists = 1;

    document.querySelectorAll(".option-btn").forEach((b) => b.classList.remove("active"));
    dropdownOptions.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
      cb.checked = cb.value === "any";
      cb.disabled = false;
      cb.closest(".option-item").classList.remove("disabled");
    });

    totalAmount = 0;
    totalBox.textContent = "₱0";
    downNote.textContent = "A 25% down payment will be calculated after selecting a service.";
    textarea.value = "";
    charCount.textContent = "0/500 characters";
    endTimeDisplay.textContent = "";
    timeSelect.value = "";
    numClientsSelect.value = "1";

    updateTherapistDisplay();
  }

  // === FORM SUBMIT ===
  form.addEventListener("submit", (e) => {
    e.preventDefault();

    if (!selectedService || !selectedMinutes) {
      alert("Please select a service and duration.");
      return;
    }

    const preferredTime = timeSelect.value;
    if (!preferredTime || preferredTime === "Select time...") {
      alert("Please select a preferred time.");
      return;
    }

    showSummaryModal();
  });

  // === MODAL EVENT LISTENERS ===
  closeModalBtn.addEventListener("click", () => {
    hideSummaryModal();
    resetFormToDefault();
  });

  printBtn.addEventListener("click", printSummary);

  summaryModal.addEventListener("click", (e) => {
    if (e.target === summaryModal) {
      hideSummaryModal();
      resetFormToDefault();
    }
  });

  // === INIT ===
  initTherapistSelector();
  updateTotal();
});
