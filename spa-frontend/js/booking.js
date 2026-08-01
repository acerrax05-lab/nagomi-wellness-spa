const API_URL = 'https://nagomi-backend.onrender.com/api';

// ─── apiFetch with retry + "server waking up" toast ──────────────────────────
const MAX_RETRIES    = 4;
const RETRY_DELAY_MS = 4000;

function _showWakeToast() {
  if (document.getElementById('_wakeToast')) return;
  const t = document.createElement('div');
  t.id = '_wakeToast';
  t.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:#4b2e1e;color:#fff;padding:14px 24px;border-radius:10px;
    font-size:0.95rem;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,0.25);
    display:flex;align-items:center;gap:10px;`;
  t.innerHTML = `<span style="font-size:1.2rem;">⏳</span><span>Server is waking up, please wait…</span>`;
  document.body.appendChild(t);
}
function _hideWakeToast() {
  const t = document.getElementById('_wakeToast');
  if (t) t.remove();
}

async function apiFetch(url, options = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, options);
      if ([502, 503, 504].includes(res.status) && attempt < MAX_RETRIES) {
        _showWakeToast();
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      _hideWakeToast();
      return res;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_RETRIES) {
        _showWakeToast();
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }
  _hideWakeToast();
  throw lastErr;
}

const CLOSING_HOUR = 23;
const CLOSING_MINS = 0;
const MAX_CLIENTS  = 6;

// ─── Category meta ────────────────────────────────────────────────────────────
const CAT_META = {
  'Massage Services':  { icon: '<i class=\'fa-solid fa-spa\'></i>',                    order: 1 },
  'Foot Treatment':    { icon: '<i class=\'fa-solid fa-shoe-prints\'></i>',             order: 2 },
  'Spot Massage':      { icon: '<i class=\'fa-solid fa-hand\'></i>',                   order: 3 },
  'Body Scrub':        { icon: '<i class=\'fa-solid fa-person-dots-from-line\'></i>',  order: 4 },
  'Facial Treatment':  { icon: '<i class=\'fa-solid fa-wand-magic-sparkles\'></i>',    order: 5 },
  'Packages':          { icon: '<i class=\'fa-solid fa-gift\'></i>',                   order: 6 },
  'Couples Packages':  { icon: '',                                                      order: 7 },
};

// ─── Global state ─────────────────────────────────────────────────────────────
let allServices        = [];
let filteredServices   = [];
let selectedCategory   = null;
let selectedService    = null;
let selectedMinutes    = null;
let totalAmount        = 0;
let numClients         = 1;
let selectedTherapists = [];
let allTherapists      = [];
let bookingType        = window.location.pathname.includes('walkin') ? 'walk-in' : 'online';
let dateSelected       = false;
let dateFullyBooked    = false;
let lastAvailableList  = null;
let currentSort        = 'name';
let currentStep        = 1;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
let categoryTabsEl, servicesGridEl, durationSectionEl, durationGridEl;
let summaryBarEl, ssbServiceNameEl, ssbDurationEl, ssbPriceEl;
let dateInputEl, timeSelectEl, endTimeBadgeEl;
let dropdownDisplayEl, dropdownOptionsEl, therapistDropdownEl, maxSelectionsSpan;
let totalDisplayEl, downPayNoteEl, charCountSmEl, guestNotesEl;
let summaryModalEl, confirmBookingBtn, backToEditBtn;
let btnStep1Next, btnStep2Next, btnReview;
let couplesNoticeEl;

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  bindDOMRefs();
  setupNavMobile();
  setupDateRestrictions();
  setupTimeListener();
  setupTherapistDropdown();
  setupCharCounter();
  setupTermsCheckbox();
  setupBackToEdit();
  setupConfirmBtn();
  setupStep1Validation();

  await loadServices();
  await loadTherapists();

  // Set default client count
  numClients = 1;
  updateClientCounterUI();

  // Auto-select first category
  if (allServices.length > 0) {
    const firstCat = Object.keys(CAT_META)[0];
    selectCategory(firstCat);
  }

  // Walk-in: unlock date/time immediately
  if (window.__isWalkIn) {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    if (dateInputEl) {
      dateInputEl.value = todayStr;
      dateInputEl.setAttribute('min', todayStr);
      dateInputEl.setAttribute('max', todayStr);
    }
    dateSelected = true;
    dateFullyBooked = false;
    unlockTimeField();
    applyDayOffGreyout(todayStr);
  }
});

// ─── DOM Binding ──────────────────────────────────────────────────────────────
function bindDOMRefs() {
  categoryTabsEl    = document.getElementById('categoryTabs');
  servicesGridEl    = document.getElementById('servicesGrid');
  durationSectionEl = document.getElementById('durationSection');
  durationGridEl    = document.getElementById('durationGrid');
  summaryBarEl      = document.getElementById('summaryBar');
  ssbServiceNameEl  = document.getElementById('ssbServiceName');
  ssbDurationEl     = document.getElementById('ssbDuration');
  ssbPriceEl        = document.getElementById('ssbPrice');
  dateInputEl       = document.getElementById('preferredDate');
  timeSelectEl      = document.getElementById('preferredTime');
  endTimeBadgeEl    = document.getElementById('endTimeBadge');
  dropdownDisplayEl = document.getElementById('dropdownDisplay');
  dropdownOptionsEl = document.getElementById('dropdownOptions');
  therapistDropdownEl = document.getElementById('therapistDropdown');
  maxSelectionsSpan = document.getElementById('maxSelections');
  totalDisplayEl    = document.getElementById('totalDisplay');
  downPayNoteEl     = document.getElementById('downPayNote');
  charCountSmEl     = document.getElementById('charCountSm');
  guestNotesEl      = document.getElementById('guestNotes');
  summaryModalEl    = document.getElementById('summaryModal');
  confirmBookingBtn = document.getElementById('confirmBookingBtn');
  backToEditBtn     = document.getElementById('backToEdit');
  btnStep1Next      = document.getElementById('btnStep1Next');
  btnStep2Next      = document.getElementById('btnStep2Next');
  btnReview         = document.getElementById('btnReview');
  couplesNoticeEl   = document.getElementById('couplesNotice');
}

// ─── Step 1 Validation (Your Info) ───────────────────────────────────────────
function setupStep1Validation() {
  ['guestName','guestPhone'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', validateStep1);
  });
}

function validateStep1() {
  const name  = document.getElementById('guestName')?.value?.trim();
  const phone = document.getElementById('guestPhone')?.value?.trim();
  if (btnStep1Next) btnStep1Next.disabled = !(name && phone);
}

// ─── Services ─────────────────────────────────────────────────────────────────
async function loadServices() {
  try {
    servicesGridEl.innerHTML = '<div class="services-loading">Loading services…</div>';
    const res = await apiFetch(`${API_URL}/services`);
    allServices = await res.json();
    buildCategoryTabs();
  } catch (err) {
    console.error('Failed to load services:', err);
    servicesGridEl.innerHTML = '<div class="services-loading" style="color:#e07b5a">Could not load services. Please refresh.</div>';
  }
}

// ─── Category Tabs ────────────────────────────────────────────────────────────
function buildCategoryTabs() {
  const catSet = new Set(allServices.map(s => s.category).filter(Boolean));
  const cats = [...catSet].sort((a, b) => {
    return (CAT_META[a]?.order ?? 99) - (CAT_META[b]?.order ?? 99);
  });
  categoryTabsEl.innerHTML = '';
  cats.forEach(cat => {
    const meta = CAT_META[cat] || { icon: '' };
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cat-tab';
    btn.dataset.cat = cat;
    btn.innerHTML = `<span class="cat-icon">${meta.icon}</span> ${cat}`;
    btn.addEventListener('click', () => selectCategory(cat));
    categoryTabsEl.appendChild(btn);
  });
}

function selectCategory(cat) {
  selectedCategory = cat;
  categoryTabsEl.querySelectorAll('.cat-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.cat === cat);
  });
  const isCouples = cat === 'Couples Packages';
  couplesNoticeEl.classList.toggle('visible', isCouples);
  renderServices();
  clearServiceSelection();
}

function renderServices() {
  const sortVal = document.getElementById('sortFilter')?.value || 'name';
  let list = allServices.filter(s => s.category === selectedCategory);
  list = sortServices(list, sortVal);
  filteredServices = list;
  servicesGridEl.innerHTML = '';
  if (list.length === 0) {
    servicesGridEl.innerHTML = '<div class="services-loading">No services in this category.</div>';
    return;
  }
  list.forEach(svc => servicesGridEl.appendChild(buildServiceCard(svc)));
}

function sortServices(list, sortVal) {
  const copy = [...list];
  switch (sortVal) {
    case 'popular':    copy.sort((a, b) => (b.bookingCount||0) - (a.bookingCount||0)); break;
    case 'rating':     copy.sort((a, b) => (b.averageRating||0) - (a.averageRating||0)); break;
    case 'price-low':  copy.sort((a, b) => getMinPrice(a) - getMinPrice(b)); break;
    case 'price-high': copy.sort((a, b) => getMinPrice(b) - getMinPrice(a)); break;
    default:           copy.sort((a, b) => a.name.localeCompare(b.name));
  }
  return copy;
}

function getMinPrice(svc) {
  if (svc.price && svc.price > 0) return svc.price;
  const pricing = svc.pricing;
  if (!pricing) return 0;
  const vals = typeof pricing.toObject === 'function' ? Object.values(pricing.toObject()) : Object.values(pricing);
  return vals.length ? Math.min(...vals) : 0;
}

function buildServiceCard(svc) {
  const card = document.createElement('div');
  card.className = 'service-card';
  card.dataset.id = svc._id;

  const ratingStr = svc.averageRating > 0
    ? `⭐ ${svc.averageRating.toFixed(1)} · ${svc.bookingCount || 0} bookings`
    : (svc.bookingCount > 0 ? `${svc.bookingCount} bookings` : '');

  const BACKEND = 'https://nagomi-backend.onrender.com';
  const PLACEHOLDER = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E%3Crect fill='%234b2e1e' width='120' height='120'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='Poppins,sans-serif' font-size='11' fill='%23f7c6a5'%3ESpa%3C/text%3E%3C/svg%3E`;
  let imgSrc = PLACEHOLDER;
  if (svc.image && svc.image.trim()) {
    imgSrc = svc.image.startsWith('/') ? `${BACKEND}${svc.image}` : svc.image;
  }

  const pricing   = svc.pricing || {};
  const durations = svc.allowedDurations || [60, 90, 120];
  const pricePills = durations.map(d => {
    const p = pricing[d] || pricing[String(d)] || svc.price || 0;
    return `<span class="svc-price-pill">${d} min: ₱${Number(p).toLocaleString()}</span>`;
  }).join('');

  const availNote = durations.length === 1
    ? `<div class="svc-avail-note">ℹ️ Available: ${durations[0]} minutes only</div>` : '';

  card.innerHTML = `
    <img class="service-card-img" src="${imgSrc}" alt="${svc.name}"
      loading="lazy" onerror="this.src='${PLACEHOLDER}';this.onerror=null;">
    <div class="service-card-body">
      <div class="service-card-name">${svc.name}</div>
      ${svc.description ? `<div class="service-card-desc">${svc.description}</div>` : ''}
      <div class="svc-price-row">${pricePills}</div>
      ${availNote}
      ${ratingStr ? `<div class="service-card-ratings">${ratingStr}</div>` : ''}
    </div>`;

  card.addEventListener('click', () => onServiceCardClick(svc, card));
  return card;
}

// ─── Service Selection ────────────────────────────────────────────────────────
function onServiceCardClick(svc, card) {
  servicesGridEl.querySelectorAll('.service-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  selectedService = svc;
  selectedMinutes = null;

  // Couples: min 2 clients
  if (svc.category === 'Couples Packages') {
    if (numClients < 2) { numClients = 2; updateClientCounterUI(); }
  }
  updateTotal();

  if (svc.isFixedPrice) {
    selectedMinutes = (svc.allowedDurations && svc.allowedDurations[0]) || 60;
    hideDurationSection();
    updateSummaryBar();
    updateTotal();
    enableStep2Next(true);
  } else {
    buildDurationButtons(svc);
    showDurationSection();
    hideSummaryBar();
    enableStep2Next(false);
  }
}

function clearServiceSelection() {
  selectedService = null;
  selectedMinutes = null;
  servicesGridEl.querySelectorAll('.service-card').forEach(c => c.classList.remove('selected'));
  hideDurationSection();
  hideSummaryBar();
  enableStep2Next(false);
  totalDisplayEl.textContent = '₱0';
}

function buildDurationButtons(svc) {
  durationGridEl.innerHTML = '';
  const durations = svc.allowedDurations || [60, 90, 120];
  let pricing = svc.pricing || {};
  if (typeof pricing === 'string') { try { pricing = JSON.parse(pricing); } catch(e) { pricing = {}; } }
  if (typeof pricing.toObject === 'function') pricing = pricing.toObject();

  durations.forEach(mins => {
    const price = pricing[mins] || pricing[String(mins)] || pricing[Number(mins)] || svc.price || 0;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dur-btn';
    btn.dataset.mins = mins;

    let label = mins === 60 ? '1 hour' : mins === 90 ? '1 hour and 30 minutes' : mins === 120 ? '2 hours' : `${mins} min`;
    btn.innerHTML = `<span class="dur-min">${label}</span>`;

    btn.addEventListener('click', () => {
      durationGridEl.querySelectorAll('.dur-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedMinutes = mins;
      if (!validateClosingTime()) {
        selectedMinutes = null;
        btn.classList.remove('active');
        return;
      }
      updateSummaryBar();
      updateTotal();
      filterTimeOptions();
      enableStep2Next(true);
    });
    durationGridEl.appendChild(btn);
  });
}

function showDurationSection() { durationSectionEl.classList.add('visible'); }
function hideDurationSection()  { durationSectionEl.classList.remove('visible'); }
function showSummaryBar()       { summaryBarEl.classList.add('visible'); }
function hideSummaryBar()       { summaryBarEl.classList.remove('visible'); }
function enableStep2Next(val)   { if (btnStep2Next) btnStep2Next.disabled = !val; }

// ─── Summary bar ──────────────────────────────────────────────────────────────
function updateSummaryBar() {
  if (!selectedService) { hideSummaryBar(); return; }
  ssbServiceNameEl.textContent = selectedService.name;
  ssbDurationEl.textContent = selectedMinutes ? `${selectedMinutes} min · ${selectedService.category}` : 'Choose duration above';
  ssbPriceEl.textContent = totalAmount ? '₱' + totalAmount.toLocaleString() : '₱—';
  showSummaryBar();
}

// ─── Total ────────────────────────────────────────────────────────────────────
function updateTotal() {
  if (!selectedService || !selectedMinutes) {
    totalAmount = 0;
    totalDisplayEl.textContent = '₱0';
    if (downPayNoteEl) downPayNoteEl.style.display = 'none';
    ssbPriceEl.textContent = '₱—';
    return;
  }

  let pricing = selectedService.pricing || {};
  if (typeof pricing === 'string') { try { pricing = JSON.parse(pricing); } catch(e) { pricing = {}; } }
  if (typeof pricing.toObject === 'function') pricing = pricing.toObject();
  if (pricing instanceof Map) {
    const mapObj = {};
    pricing.forEach((v, k) => { mapObj[k] = v; });
    pricing = mapObj;
  }

  let basePrice = pricing[selectedMinutes] || pricing[String(selectedMinutes)] || pricing[Number(selectedMinutes)] || null;
  if (!basePrice && selectedService.price && selectedService.price > 0) basePrice = selectedService.price;
  if (!basePrice && selectedService.prices) {
    const idx = (selectedService.allowedDurations || []).indexOf(selectedMinutes);
    if (idx >= 0) basePrice = selectedService.prices[idx];
  }
  basePrice = basePrice || 0;

  const clientCount = numClients > 0 ? numClients : 1;
  totalAmount = basePrice * clientCount;

  totalDisplayEl.textContent = '₱' + totalAmount.toLocaleString();
  if (downPayNoteEl) downPayNoteEl.style.display = 'none';
  ssbPriceEl.textContent = basePrice > 0 ? '₱' + totalAmount.toLocaleString() : '₱—';
}

// ─── Unified Client Counter ───────────────────────────────────────────────────
function updateClientCounterUI() {
  const isCouples = selectedService?.category === 'Couples Packages';
  const min = isCouples ? 2 : 1;

  document.getElementById('ccValue').textContent = numClients;
  document.getElementById('ccMinus').disabled = numClients <= min;
  document.getElementById('ccPlus').disabled  = numClients >= MAX_CLIENTS;
  if (maxSelectionsSpan) maxSelectionsSpan.textContent = numClients;

  const warning = document.getElementById('totalClientsWarning');
  if (warning) warning.style.display = numClients < 1 ? 'flex' : 'none';

  // Update therapist selection limit
  trimTherapistSelections();
  updateTherapistGreyout();
  checkStep3Ready();
}

function adjustClients(delta) {
  const isCouples = selectedService?.category === 'Couples Packages';
  const min = isCouples ? 2 : 1;
  numClients = Math.max(min, Math.min(MAX_CLIENTS, numClients + delta));
  updateClientCounterUI();
  updateTotal();
}
window.adjustClients = adjustClients;

// ─── Step Navigation ──────────────────────────────────────────────────────────
function goToStep(step) {
  // Validate leaving step 1 → 2 (Your Info)
  if (step === 2) {
    const name  = document.getElementById('guestName')?.value?.trim();
    const phone = document.getElementById('guestPhone')?.value?.trim();
    if (!name || !phone) {
      showNotification('Please enter your name and phone number to continue.', 'error');
      return;
    }
  }

  // Validate leaving step 2 → 3 (Service)
  if (step === 3) {
    if (!selectedService || !selectedMinutes) {
      showNotification('Please select a service and duration first.', 'error');
      return;
    }
    // Couples: enforce min 2
    if (selectedService.category === 'Couples Packages' && numClients < 2) {
      numClients = 2;
      updateClientCounterUI();
      updateTotal();
    }
    // Lock time until date selected
    if (!dateSelected) lockTimeField();
  }

  currentStep = step;

  document.querySelectorAll('.booking-step').forEach((el, i) => {
    el.classList.toggle('active', i + 1 === step);
  });

  for (let i = 1; i <= 3; i++) {
    const stepEl = document.getElementById(`pStep${i}`);
    const connEl = document.getElementById(`pConn${i}`);
    stepEl.classList.toggle('active', i === step);
    stepEl.classList.toggle('done', i < step);
    if (connEl) connEl.classList.toggle('done', i < step);
  }

  document.querySelector('.booking-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Step 3 Ready Check ───────────────────────────────────────────────────────
function checkStep3Ready() {
  const hasDate    = !!dateInputEl?.value;
  const hasTime    = !!timeSelectEl?.value;
  const hasClients = numClients >= 1;
  const notFull    = !dateFullyBooked;

  if (btnReview) btnReview.disabled = !(hasDate && hasTime && hasClients && notFull);
}

// ─── submitStep3 (go to summary) ─────────────────────────────────────────────
function submitStep3() {
  if (!dateInputEl.value) { showNotification('Please select a date.', 'error'); return; }
  if (!timeSelectEl.value) { showNotification('Please select a time.', 'error'); return; }
  if (numClients < 1) { showNotification('Please add at least 1 client.', 'error'); return; }
  if (selectedService?.category === 'Couples Packages' && numClients < 2) {
    showNotification('Couples Package requires at least 2 clients.', 'warning'); return;
  }
  populateSummaryModal();
  showSummaryModal();
}

// ─── Date ─────────────────────────────────────────────────────────────────────
function setupDateRestrictions() {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  dateInputEl.min = todayStr;

  dateInputEl.addEventListener('change', async function() {
    hideDateWarning();
    if (dateInputEl.value) {
      showDateChecking(true);
      await checkDateAvailability(dateInputEl.value);
      showDateChecking(false);
      if (!dateFullyBooked) {
        dateSelected = true;
        unlockTimeField();
      } else {
        dateSelected = false;
        lockTimeField();
      }
      applyDayOffGreyout(dateInputEl.value);
    } else {
      dateSelected = false;
      dateFullyBooked = false;
      lockTimeField();
      hideDateWarning();
      resetTherapistAvailability();
    }
    validateTimeForToday();
    checkStep3Ready();
    await checkAvailability();
    if (dateInputEl.value) applyDayOffGreyout(dateInputEl.value);
  });
}

// ─── Time ─────────────────────────────────────────────────────────────────────
function setupTimeListener() {
  timeSelectEl.addEventListener('change', async () => {
    if (!validateClosingTime()) {
      timeSelectEl.value = '';
      endTimeBadgeEl.classList.remove('visible');
      lockTherapistField();
      return;
    }
    calculateEndTime();
    validateTimeForToday();
    checkStep3Ready();
    if (timeSelectEl.value) unlockTherapistField();
    await checkAvailability();
  });
}

function validateClosingTime() {
  if (!timeSelectEl.value || !selectedMinutes) return true;
  const startMins = parseTimeToMinutes(timeSelectEl.value);
  const endMins   = startMins + selectedMinutes;
  const closeMin  = CLOSING_HOUR * 60 + CLOSING_MINS;
  if (endMins > closeMin) {
    const latest = formatTimeFromMinutes(closeMin - selectedMinutes);
    showNotification(`Service would end after closing time. Latest start: ${latest}.`, 'error');
    return false;
  }
  return true;
}

function calculateEndTime() {
  if (!timeSelectEl.value || !selectedMinutes) { endTimeBadgeEl.classList.remove('visible'); return; }
  const endMins = parseTimeToMinutes(timeSelectEl.value) + selectedMinutes;
  endTimeBadgeEl.textContent = `⏱ End time: ${formatTimeFromMinutes(endMins)}`;
  endTimeBadgeEl.classList.add('visible');
}

function filterTimeOptions() {
  if (!selectedMinutes) return;
  const opts = timeSelectEl.querySelectorAll('option');
  opts.forEach(opt => {
    if (!opt.value) return;
    const endMins  = parseTimeToMinutes(opt.value) + selectedMinutes;
    const closeMin = CLOSING_HOUR * 60 + CLOSING_MINS;
    opt.disabled = endMins > closeMin;
  });
}

function validateTimeForToday() {
  if (!dateInputEl.value || !timeSelectEl.value) return;
  const today   = new Date();
  const booking = new Date(dateInputEl.value + 'T00:00:00');
  if (booking.toDateString() !== today.toDateString()) return;
  const selMins = parseTimeToMinutes(timeSelectEl.value);
  const nowMins = today.getHours() * 60 + today.getMinutes();
  if (selMins < nowMins) {
    showNotification('Cannot book for a time that has already passed today.', 'error');
    timeSelectEl.value = '';
    endTimeBadgeEl.classList.remove('visible');
    checkStep3Ready();
  }
}

// ─── Date Availability ────────────────────────────────────────────────────────
async function checkDateAvailability(dateStr) {
  if (!selectedMinutes) return;
  try {
    const res = await apiFetch(`${API_URL}/bookings/date-availability?date=${dateStr}&duration=${selectedMinutes}`);
    if (!res.ok) return;
    const data = await res.json();
    if (data.fullyBooked) {
      dateFullyBooked = true;
      if (data.blockedByAdmin) {
        const title = data.blockReason === 'vacation'
          ? `The spa is closed: "${data.blockLabel}"`
          : `${data.blockLabel || 'Store Holiday'}`;
        showDateWarning(title, 'Please choose another date.', 'caution');
      } else {
        showDateWarning('This date is fully booked', `All therapists are occupied for ${selectedMinutes}-minute services. Please select a different date.`, 'error');
      }
      lockTimeField();
    } else {
      dateFullyBooked = false;
      if (data.busySlots && data.busySlots.length > 0) {
        disableFullyBookedTimes(data.busySlots);
        if (data.busySlots.length >= 6) {
          showDateWarning('Some times are unavailable', 'Greyed-out slots have no available therapists.', 'warning');
        } else { hideDateWarning(); }
      } else {
        hideDateWarning();
        resetTimeOptions();
      }
    }
  } catch (err) {
    console.error('Date availability check failed:', err);
    dateFullyBooked = false;
  }
}

function disableFullyBookedTimes(busySlots) {
  if (!timeSelectEl) return;
  timeSelectEl.querySelectorAll('option').forEach(opt => {
    if (!opt.value) return;
    const isBusy = busySlots.includes(opt.value);
    opt.disabled = isBusy;
    opt.textContent = isBusy ? opt.value + ' (fully booked)' : opt.value;
  });
}

function resetTimeOptions() {
  if (!timeSelectEl) return;
  timeSelectEl.querySelectorAll('option').forEach(opt => {
    opt.disabled = false;
    if (opt.value) opt.textContent = opt.value;
  });
}

function showDateWarning(title, detail, type) {
  const el = document.getElementById('dateAvailWarning');
  if (!el) return;
  el.className = `date-avail-warning ${type === 'error' ? 'daw-error' : 'daw-caution'}`;
  el.innerHTML = `<span class="daw-icon">${type === 'error' ? '🚫' : '⚠️'}</span>
    <div><strong>${title}</strong>${detail ? `<br><span class="daw-detail">${detail}</span>` : ''}</div>`;
  el.style.display = 'flex';
}
function hideDateWarning() {
  const el = document.getElementById('dateAvailWarning');
  if (el) el.style.display = 'none';
  resetTimeOptions();
}
function showDateChecking(show) {
  const el = document.getElementById('dateAvailWarning');
  if (!el) return;
  if (show) {
    el.className = 'date-avail-warning daw-checking';
    el.innerHTML = '<span class="daw-icon">⏳</span><div><strong>Checking availability…</strong></div>';
    el.style.display = 'flex';
  } else {
    if (el.className.includes('daw-checking')) el.style.display = 'none';
  }
}

// ─── Therapist Dropdown ───────────────────────────────────────────────────────
async function loadTherapists() {
  try {
    const res = await apiFetch(`${API_URL}/auth/therapists`);
    allTherapists = await res.json();
    populateTherapistDropdown(allTherapists);
    if (dateInputEl && dateInputEl.value) applyDayOffGreyout(dateInputEl.value);
  } catch (err) {
    console.error('Failed to load therapists:', err);
  }
}

function populateTherapistDropdown(therapists) {
  const optionsEl = document.getElementById('dropdownOptions');
  if (!optionsEl) return;
  // Remove existing non-"any" options
  Array.from(optionsEl.querySelectorAll('.option-item')).forEach((el, i) => { if (i > 0) el.remove(); });

  therapists.forEach(t => {
    const div = document.createElement('div');
    div.className = 'option-item';
    div.innerHTML = `
      <input type="checkbox" id="therapist-${t._id}" value="${t.name}"
        data-id="${t._id}"
        data-expertise='${JSON.stringify(t.expertise || [])}'
        data-schedule='${JSON.stringify(t.weeklySchedule || [])}'>
      <label for="therapist-${t._id}">${t.name}</label>`;
    div.addEventListener('click', e => {
      const cb = div.querySelector('input[type="checkbox"]');
      if (!cb || cb.disabled) return;
      if (e.target !== cb) cb.click();
    });
    optionsEl.appendChild(div);
  });

  refreshTherapistDropdownListeners();
}

function setupTherapistDropdown() {
  const displayEl  = document.getElementById('dropdownDisplay');
  const optionsEl  = document.getElementById('dropdownOptions');
  const dropdownEl = document.getElementById('therapistDropdown');
  if (!displayEl || !optionsEl || !dropdownEl) return;

  displayEl.addEventListener('click', () => {
    optionsEl.classList.toggle('show');
    if (optionsEl.classList.contains('show') && lastAvailableList !== null) {
      applyBookingAvailabilityGreyout(lastAvailableList);
      if (dateInputEl.value) applyDayOffGreyout(dateInputEl.value);
    }
  });

  document.addEventListener('click', e => {
    if (!dropdownEl.contains(e.target)) optionsEl.classList.remove('show');
  });
}

function refreshTherapistDropdownListeners() {
  const anyCheckbox = document.getElementById('any-therapist');
  const optionsEl   = document.getElementById('dropdownOptions');
  if (!anyCheckbox || !optionsEl) return;

  const otherCBs = () => Array.from(optionsEl.querySelectorAll('input[type="checkbox"]:not(#any-therapist)'));

  anyCheckbox.removeEventListener('change', anyCheckbox._handler || (() => {}));
  anyCheckbox._handler = () => {
    if (anyCheckbox.checked) {
      otherCBs().forEach(cb => { cb.checked = false; });
      selectedTherapists = [];
      updateDropdownDisplay();
      updateTherapistGreyout();
      checkStep3Ready();
    }
  };
  anyCheckbox.addEventListener('change', anyCheckbox._handler);

  optionsEl.removeEventListener('change', optionsEl._handler || (() => {}));
  optionsEl._handler = e => {
    const cb = e.target;
    if (!cb || cb.id === 'any-therapist') return;

    const checked = otherCBs().filter(c => c.checked);
    if (cb.checked && checked.length > numClients) {
      cb.checked = false;
      showNotification(`You can only select up to ${numClients} therapist(s).`, 'warning');
      return;
    }

    selectedTherapists = otherCBs()
      .filter(c => c.checked)
      .map(c => ({ name: c.value, id: c.dataset.id }));

    if (selectedTherapists.length > 0) anyCheckbox.checked = false;
    else anyCheckbox.checked = true;

    updateDropdownDisplay();
    updateTherapistGreyout();
    checkStep3Ready();
  };
  optionsEl.addEventListener('change', optionsEl._handler);
}

function updateDropdownDisplay() {
  const displayEl   = document.getElementById('dropdownDisplay');
  const anyCheckbox = document.getElementById('any-therapist');
  const ph = displayEl?.querySelector('.placeholder');
  if (!ph) return;
  if (anyCheckbox?.checked || selectedTherapists.length === 0) {
    ph.textContent = 'Any Available Therapist';
  } else {
    ph.textContent = selectedTherapists.map(t => t.name).join(', ');
  }
}

function updateTherapistGreyout() {
  const optionsEl  = document.getElementById('dropdownOptions');
  const anyId      = 'any-therapist';
  if (!optionsEl) return;
  const otherCBs   = Array.from(optionsEl.querySelectorAll(`input[type="checkbox"]:not(#${anyId})`));
  const checkedCount = otherCBs.filter(cb => cb.checked).length;
  const limitReached = checkedCount >= numClients;

  otherCBs.forEach(cb => {
    if (cb.parentElement.dataset.available === 'false') return;
    if (cb.parentElement.dataset.booked === 'true') return;
    const lbl = cb.parentElement.querySelector('label');
    if (cb.checked) {
      cb.disabled = false;
      cb.parentElement.style.opacity = '1';
      cb.parentElement.style.cursor  = 'pointer';
      if (lbl) { lbl.style.color = ''; lbl.style.textDecoration = ''; }
    } else if (limitReached) {
      cb.disabled = true;
      cb.parentElement.style.opacity = '0.4';
      cb.parentElement.style.cursor  = 'not-allowed';
      if (lbl) lbl.style.color = 'rgba(75,46,30,0.35)';
    } else {
      cb.disabled = false;
      cb.parentElement.style.opacity = '1';
      cb.parentElement.style.cursor  = 'pointer';
      if (lbl) { lbl.style.color = ''; lbl.style.textDecoration = ''; }
    }
  });
}

function trimTherapistSelections() {
  if (selectedTherapists.length > numClients) {
    selectedTherapists = selectedTherapists.slice(0, numClients);
    const optionsEl = document.getElementById('dropdownOptions');
    if (optionsEl) {
      const keepIds = new Set(selectedTherapists.map(t => t.id));
      optionsEl.querySelectorAll('input[type="checkbox"]:not(#any-therapist)')
        .forEach(cb => { if (!keepIds.has(cb.dataset.id)) cb.checked = false; });
    }
    updateDropdownDisplay();
  }
}

function resetTherapistAvailability() {
  const optionsEl = document.getElementById('dropdownOptions');
  if (!optionsEl) return;
  optionsEl.querySelectorAll('input[type="checkbox"]:not(#any-therapist)').forEach(cb => {
    if (cb.parentElement.dataset.available === 'false') return;
    cb.disabled = false;
    cb.parentElement.dataset.booked = 'false';
    cb.parentElement.style.opacity  = '1';
    cb.parentElement.style.cursor   = 'pointer';
    const lbl = cb.parentElement.querySelector('label');
    if (lbl) { lbl.style.color = ''; lbl.style.textDecoration = ''; lbl.title = ''; }
  });
  updateTherapistGreyout();
}

// ─── Day-off Greyout ─────────────────────────────────────────────────────────
function applyDayOffGreyout(dateStr) {
  if (!dateStr) { resetTherapistAvailability(); return; }
  const [year, month, day] = dateStr.split('-').map(Number);
  const localDate = new Date(year, month - 1, day);
  const dayNames  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const dayName   = dayNames[localDate.getDay()];

  const optionsEl = document.getElementById('dropdownOptions');
  if (!optionsEl) return;
  const cbs = Array.from(optionsEl.querySelectorAll('input[type="checkbox"]:not(#any-therapist)'));

  cbs.forEach(cb => {
    let schedule = [];
    try { schedule = JSON.parse(cb.dataset.schedule || '[]'); } catch(e) {}
    const dayEntry   = schedule.find(s => s.dayOfWeek === dayName);
    const isWorking  = dayEntry ? dayEntry.isWorking : true;
    const item = cb.parentElement;
    const lbl  = item.querySelector('label');

    if (!isWorking) {
      cb.disabled = true;
      item.dataset.available = 'false';
      item.style.opacity = '0.4';
      item.style.cursor  = 'not-allowed';
      if (lbl) { lbl.style.color = 'rgba(75,46,30,0.3)'; lbl.title = `Day off on ${dayName}`; }
      if (cb.checked) {
        cb.checked = false;
        selectedTherapists = selectedTherapists.filter(t => t.id !== cb.dataset.id);
        updateDropdownDisplay();
      }
    } else {
      item.dataset.available = 'true';
      if (item.dataset.booked !== 'true' && !cb.checked) {
        cb.disabled = false;
        item.style.opacity = '1';
        item.style.cursor  = 'pointer';
        if (lbl) { lbl.style.color = ''; lbl.title = ''; }
      }
    }
  });
  updateTherapistGreyout();
  checkTherapistAvailability();
}

// ─── Booking Availability Greyout ─────────────────────────────────────────────
async function checkAvailability() {
  if (!selectedService || !selectedMinutes || !dateInputEl.value || !timeSelectEl.value) {
    lastAvailableList = null;
    resetTherapistAvailability();
    if (dateInputEl.value) applyDayOffGreyout(dateInputEl.value);
    return;
  }
  try {
    const res = await apiFetch(`${API_URL}/bookings/check-availability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        service: selectedService.name,
        date: dateInputEl.value,
        time: timeSelectEl.value,
        durationMinutes: selectedMinutes
      })
    });
    if (!res.ok) { lastAvailableList = null; resetTherapistAvailability(); }
    else {
      const data = await res.json();
      lastAvailableList = data.available || [];
      applyBookingAvailabilityGreyout(lastAvailableList);
    }
  } catch (err) {
    console.error('Availability check error:', err);
    lastAvailableList = null;
    resetTherapistAvailability();
  }
  if (dateInputEl.value) applyDayOffGreyout(dateInputEl.value);
}

function applyBookingAvailabilityGreyout(availableList) {
  const availIds = new Set(availableList.map(t => String(t.id || t._id || '').trim().toLowerCase()));
  const optionsEl = document.getElementById('dropdownOptions');
  if (!optionsEl) return;

  Array.from(optionsEl.querySelectorAll('input[type="checkbox"]:not(#any-therapist)')).forEach(cb => {
    const id      = (cb.dataset.id || '').trim().toLowerCase();
    const isAvail = availIds.has(id);
    const item    = cb.parentElement;
    const lbl     = item.querySelector('label');

    if (!isAvail) {
      cb.disabled = true;
      item.dataset.booked = 'true';
      item.style.opacity  = '0.4';
      item.style.cursor   = 'not-allowed';
      if (lbl) { lbl.style.color = 'rgba(75,46,30,0.3)'; lbl.style.textDecoration = 'line-through'; lbl.title = 'Already booked at this time'; }
      if (cb.checked) {
        cb.checked = false;
        selectedTherapists = selectedTherapists.filter(t => t.id !== id);
        updateDropdownDisplay();
      }
    } else {
      item.dataset.booked = 'false';
      if (item.dataset.available !== 'false') {
        cb.disabled = false;
        item.style.opacity = '1';
        item.style.cursor  = 'pointer';
        if (lbl) { lbl.style.color = ''; lbl.style.textDecoration = ''; lbl.title = ''; }
      }
    }
  });
  updateTherapistGreyout();
  checkTherapistAvailability();
}

function checkTherapistAvailability() {
  const optionsEl = document.getElementById('dropdownOptions');
  const overlay   = document.getElementById('noAvailOverlay');
  if (!optionsEl || !overlay) return;
  if (!dateInputEl?.value || !timeSelectEl?.value) { overlay.style.display = 'none'; return; }

  const cbs = Array.from(optionsEl.querySelectorAll('input[type="checkbox"]:not(#any-therapist)'));
  const actualAvailable = cbs.filter(cb =>
    cb.parentElement.dataset.available !== 'false' &&
    cb.parentElement.dataset.booked !== 'true'
  ).length;

  overlay.style.display = actualAvailable < numClients ? 'block' : 'none';
}

// ─── Lock/Unlock helpers ──────────────────────────────────────────────────────
function unlockTimeField() {
  const el   = document.getElementById('timeFieldGroup');
  const hint = document.getElementById('timeLockHint');
  if (!el) return;
  el.classList.remove('field-group-locked');
  el.classList.add('field-group-unlocking');
  if (hint) hint.style.display = 'none';
  setTimeout(() => el.classList.remove('field-group-unlocking'), 500);
}
function lockTimeField() {
  const el   = document.getElementById('timeFieldGroup');
  const hint = document.getElementById('timeLockHint');
  if (el) { el.classList.add('field-group-locked'); el.classList.remove('field-group-unlocking'); }
  if (hint) hint.style.display = '';
  if (timeSelectEl) timeSelectEl.value = '';
  if (endTimeBadgeEl) endTimeBadgeEl.classList.remove('visible');
  lockTherapistField();
  checkStep3Ready();
}
function unlockTherapistField() {
  const el = document.getElementById('therapistSection');
  if (el) { el.style.opacity = '1'; el.style.pointerEvents = ''; }
}
function lockTherapistField() {
  const el = document.getElementById('therapistSection');
  if (el) { el.style.opacity = '0.45'; el.style.pointerEvents = 'none'; }
}

// ─── Summary Modal ────────────────────────────────────────────────────────────
function populateSummaryModal() {
  document.getElementById('summary-name').textContent  = document.getElementById('guestName')?.value || '—';
  document.getElementById('summary-phone').textContent = document.getElementById('guestPhone')?.value || '—';
  document.getElementById('summary-category').textContent = selectedService?.category || '—';
  document.getElementById('summary-service').textContent  = selectedService?.name || '—';
  document.getElementById('summary-duration').textContent = selectedMinutes ? `${selectedMinutes} minutes` : '—';
  document.getElementById('summary-clients').textContent  = `${numClients} client${numClients > 1 ? 's' : ''}`;

  const anyChecked = document.getElementById('any-therapist')?.checked;
  document.getElementById('summary-therapists').textContent = selectedTherapists.length > 0
    ? selectedTherapists.map(t => t.name).join(', ')
    : 'Any Available Therapist';

  document.getElementById('summary-date').textContent = dateInputEl.value
    ? new Date(dateInputEl.value).toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })
    : '—';
  document.getElementById('summary-time').textContent = timeSelectEl.value || '—';

  if (timeSelectEl.value && selectedMinutes) {
    const endMins = parseTimeToMinutes(timeSelectEl.value) + selectedMinutes;
    document.getElementById('summary-endtime').textContent = formatTimeFromMinutes(endMins);
  } else {
    document.getElementById('summary-endtime').textContent = '—';
  }

  const notes    = guestNotesEl?.value?.trim() || '';
  const notesSec = document.getElementById('notes-section');
  if (notes) { document.getElementById('summary-notes').textContent = notes; notesSec.style.display = 'block'; }
  else notesSec.style.display = 'none';

  document.getElementById('summary-total').textContent = '₱' + totalAmount.toLocaleString();
}

function showSummaryModal() {
  summaryModalEl.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  const sc = summaryModalEl.querySelector('.summary-content');
  if (sc) sc.scrollTop = 0;
  const cb = document.getElementById('termsCheckbox');
  if (cb) {
    cb.checked = false;
    confirmBookingBtn.disabled = true;
    confirmBookingBtn.style.opacity = '0.5';
    confirmBookingBtn.style.cursor  = 'not-allowed';
  }
}

function hideSummaryModal() {
  summaryModalEl.style.display = 'none';
  document.body.style.overflow = 'auto';
}

function setupBackToEdit() {
  backToEditBtn?.addEventListener('click', () => { hideSummaryModal(); goToStep(3); });
}

// ─── Terms ────────────────────────────────────────────────────────────────────
function setupTermsCheckbox() {
  const cb = document.getElementById('termsCheckbox');
  if (!cb) return;
  cb.addEventListener('change', () => {
    confirmBookingBtn.disabled = !cb.checked;
    confirmBookingBtn.style.opacity = cb.checked ? '1' : '0.5';
    confirmBookingBtn.style.cursor  = cb.checked ? 'pointer' : 'not-allowed';
  });
}
function showTermsModal(e) {
  e.preventDefault();
  const m = document.getElementById('termsModal');
  if (m) { m.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
}
function closeTermsModal() {
  const m = document.getElementById('termsModal');
  if (m) { m.style.display = 'none'; document.body.style.overflow = 'auto'; }
}
function acceptTerms() {
  const cb = document.getElementById('termsCheckbox');
  if (cb) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
  closeTermsModal();
}
window.showTermsModal  = showTermsModal;
window.closeTermsModal = closeTermsModal;
window.acceptTerms     = acceptTerms;

// ─── Confirm Booking ──────────────────────────────────────────────────────────
function setupConfirmBtn() {
  confirmBookingBtn?.addEventListener('click', async () => {
    const termsCheckbox = document.getElementById('termsCheckbox');
    if (!termsCheckbox?.checked) {
      showNotification('Please accept the Terms and Conditions to proceed.', 'error');
      return;
    }

    const name  = document.getElementById('guestName')?.value?.trim();
    const phone = document.getElementById('guestPhone')?.value?.trim();
    const notes = guestNotesEl?.value?.trim() || '';
    const date  = dateInputEl.value;
    const time  = timeSelectEl.value;

    if (!selectedService || !selectedMinutes || !date || !time || !name || !phone) {
      showNotification('Please complete all required fields.', 'error');
      return;
    }

    const endMins = parseTimeToMinutes(time) + selectedMinutes;
    const endTime = formatTimeFromMinutes(endMins);

    const bookingData = {
      service:         selectedService.name,
      minutes:         String(selectedMinutes),
      therapists:      selectedTherapists.length > 0 ? selectedTherapists : [{ name: 'Any available therapist' }],
      numberOfClients: numClients,
      femaleClients:   0,
      maleClients:     0,
      date,
      time,
      endTime,
      notes,
      name,
      phone,
      totalAmount,
      paymentMethod:  bookingType === 'walk-in' ? 'Cash on Arrival' : 'Not specified',
      termsAccepted:  true,
      bookingType,
    };

    confirmBookingBtn.disabled    = true;
    confirmBookingBtn.textContent = 'Processing…';

    try {
      const response = await apiFetch(`${API_URL}/bookings`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(bookingData),
      });
      const data = await response.json();
      if (response.ok) {
        hideSummaryModal();
        const txn = data.booking?.transactionNumber || data.booking?._id?.substring(0, 8).toUpperCase();
        showSuccessMessage(txn);
        resetForm();
      } else {
        showNotification(`${data.msg || 'Booking failed. Please try again.'}`, 'error');
      }
    } catch (err) {
      console.error('Booking submit error:', err);
      showNotification('Server error. Please try again later.', 'error');
    } finally {
      confirmBookingBtn.disabled    = false;
      confirmBookingBtn.textContent = 'Confirm Booking →';
    }
  });
}

function showSuccessMessage(txn) {
  const el = document.createElement('div');
  el.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
    background:white;padding:40px;border-radius:20px;
    box-shadow:0 10px 40px rgba(0,0,0,0.3);z-index:10002;
    text-align:center;max-width:480px;width:90%;`;
  el.innerHTML = `
    <div style="font-size:3rem;margin-bottom:20px">🌸</div>
    <h3 style="color:#28a745;margin-bottom:15px;font-size:1.5rem">Booking Confirmed!</h3>
    <p style="color:#666;margin-bottom:20px">Your appointment has been successfully booked.</p>
    <div style="background:#f8f9fa;padding:20px;border-radius:10px;margin-bottom:20px">
      <p style="color:#666;font-size:0.9rem;margin-bottom:10px">Your Transaction Number:</p>
      <p style="color:#4b2e1e;font-size:1.8rem;font-weight:700;letter-spacing:2px">#${txn}</p>
      <p style="color:#999;font-size:0.85rem;margin-top:10px">Save this number to manage your booking</p>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center">
      <button onclick="window.location.href='manage-booking.html'"
        style="padding:12px 24px;background:linear-gradient(135deg,#6b3f2a,#4b2e1e);color:#f5e6cc;border:none;border-radius:8px;font-weight:600;cursor:pointer">
        Manage Booking
      </button>
      <button onclick="window.location.href='index.html'"
        style="padding:12px 24px;background:#e8d9c4;color:#4b2e1e;border:1.5px solid #d4c0a0;border-radius:8px;font-weight:600;cursor:pointer">
        Back to Home
      </button>
    </div>`;
  document.body.appendChild(el);
}

function resetForm() {
  selectedService    = null;
  selectedMinutes    = null;
  selectedTherapists = [];
  numClients         = 1;
  totalAmount        = 0;

  document.getElementById('ccValue').textContent = '1';
  document.getElementById('ccMinus').disabled    = true;
  document.getElementById('ccPlus').disabled     = false;
  if (maxSelectionsSpan) maxSelectionsSpan.textContent = '1';

  dateInputEl.value = '';
  timeSelectEl.value = '';
  endTimeBadgeEl.classList.remove('visible');

  document.getElementById('guestName').value  = '';
  document.getElementById('guestPhone').value = '';
  guestNotesEl.value = '';
  charCountSmEl.textContent = '0 / 500';
  totalDisplayEl.textContent = '₱0';

  const anyTherapist = document.getElementById('any-therapist');
  if (anyTherapist) anyTherapist.checked = true;
  const optionsEl = document.getElementById('dropdownOptions');
  if (optionsEl) optionsEl.querySelectorAll('input[type="checkbox"]:not(#any-therapist)')
    .forEach(cb => { cb.checked = false; });
  updateDropdownDisplay();

  hideDurationSection();
  hideSummaryBar();
  if (btnStep1Next) btnStep1Next.disabled = true;
  enableStep2Next(false);
  if (btnReview) btnReview.disabled = true;

  goToStep(1);
  if (selectedCategory) renderServices();
}

// ─── Sort filter ──────────────────────────────────────────────────────────────
document.addEventListener('change', e => {
  if (e.target.id === 'sortFilter') {
    currentSort = e.target.value;
    if (selectedCategory) renderServices();
  }
});

// ─── Char counter ─────────────────────────────────────────────────────────────
function setupCharCounter() {
  guestNotesEl?.addEventListener('input', () => {
    charCountSmEl.textContent = `${guestNotesEl.value.length} / 500`;
  });
}

// ─── Mobile nav ───────────────────────────────────────────────────────────────
function setupNavMobile() {
  const hamburger = document.getElementById('hamburger');
  const navLinks  = document.getElementById('navLinks');
  if (!hamburger || !navLinks) return;
  hamburger.addEventListener('click', () => {
    hamburger.classList.toggle('active');
    navLinks.classList.toggle('active');
    document.body.style.overflow = navLinks.classList.contains('active') ? 'hidden' : '';
  });
  navLinks.querySelectorAll('a').forEach(a => {
    a.addEventListener('click', () => {
      hamburger.classList.remove('active');
      navLinks.classList.remove('active');
      document.body.style.overflow = '';
    });
  });
}

// ─── Notification ─────────────────────────────────────────────────────────────
function showNotification(message, type = 'info') {
  document.querySelectorAll('.booking-notification').forEach(n => n.remove());
  const el = document.createElement('div');
  el.className = 'booking-notification';
  const bg = type === 'success' ? '#28a745' : type === 'error' ? '#dc3545' : type === 'warning' ? '#e68a00' : '#007bff';
  el.style.cssText = `position:fixed;top:20px;right:20px;background:${bg};color:white;
    padding:14px 22px;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,0.18);
    z-index:10005;max-width:380px;font-family:'Poppins',sans-serif;font-size:0.88rem;
    animation:slideInRight 0.3s ease;`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, 5000);
}

const notifStyle = document.createElement('style');
notifStyle.textContent = `@keyframes slideInRight { from { transform:translateX(400px);opacity:0; } to { transform:translateX(0);opacity:1; } }`;
document.head.appendChild(notifStyle);

// ─── Time helpers ─────────────────────────────────────────────────────────────
function parseTimeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [tp, per] = timeStr.split(' ');
  let [h, m] = tp.split(':').map(Number);
  if (per === 'PM' && h !== 12) h += 12;
  if (per === 'AM' && h === 12) h = 0;
  return h * 60 + m;
}

function formatTimeFromMinutes(total) {
  const h24  = Math.floor(total / 60) % 24;
  const mins = total % 60;
  const per  = h24 >= 12 ? 'PM' : 'AM';
  const h12  = h24 > 12 ? h24 - 12 : (h24 === 0 ? 12 : h24);
  return `${h12}:${String(mins).padStart(2, '0')} ${per}`;
}