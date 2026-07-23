const API_URL = 'https://nagomi-backend.onrender.com/api';

// ─── apiFetch with retry + "server waking up" toast ──────────────────────────
const MAX_RETRIES    = 4;
const RETRY_DELAY_MS = 4000;

function _showWakeToast() {
  if (document.getElementById('_wakeToast')) return;
  const t = document.createElement('div');
  t.id = '_wakeToast';
  t.style.cssText = `
    position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
    background:#4b2e1e;color:#fff;padding:14px 24px;border-radius:10px;
    font-size:0.95rem;z-index:99999;box-shadow:0 4px 16px rgba(0,0,0,0.25);
    display:flex;align-items:center;gap:10px;`;
  t.innerHTML = `<span style="font-size:1.2rem;">⏳</span>
    <span>Server is waking up, please wait…</span>`;
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
      // 502/503/504 = Render still booting
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
const CLOSING_HOUR   = 23;   // 11 PM
const CLOSING_MINS   = 0;
const MAX_CLIENTS    = 6;

// ─── Category meta (icons + ordering) ────────────────────────────────────────
const CAT_META = {
  'Massage Services':  { icon: '💆', order: 1 },
  'Foot Treatment':    { icon: '🦶', order: 2 },
  'Spot Massage':      { icon: '✋', order: 3 },
  'Body Scrub':        { icon: '🧖', order: 4 },
  'Facial Treatment':  { icon: '✨', order: 5 },
  'Packages':          { icon: '🎁', order: 6 },
  'Couples Packages':  { icon: '👫', order: 7 },
};

// ─── Global state ─────────────────────────────────────────────────────────────
let allServices      = [];      // Full service list from API
let filteredServices = [];      // Currently displayed services
let selectedCategory = null;    // Current category filter
let selectedService  = null;    // Full service object
let selectedMinutes  = null;    // Number (30, 60, 90, 120)
let totalAmount      = 0;
let numClients       = 1;
let femaleClients    = 0;
let maleClients      = 0;
let selectedTherapists = [];
let selectedFemaleTherapists = [];
let selectedMaleTherapists   = [];
let allTherapists    = [];
let bookingType = window.location.pathname.includes('walkin') ? 'walk-in' : 'online';
let dateSelected     = false;
let therapistConfirmed = false;
let femaleTherapistConfirmed = false;
let maleTherapistConfirmed   = false;
let lastAvailableList = null; // cache last availability result for dropdown open
let currentSort      = 'name';
let currentStep      = 1;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
let categoryTabsEl, servicesGridEl, durationSectionEl, durationGridEl;
let summaryBarEl, ssbServiceNameEl, ssbDurationEl, ssbPriceEl;
let ccValueEl, ccMinusBtn, ccPlusBtn;
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

  await loadServices();
  await loadTherapists();

  // Initialize gender counters: default 0 female, 0 male
  femaleClients = 0;
  maleClients   = 0;
  numClients    = 0;
  updateGenderCounterUI();

  // Auto-select first category
  if (allServices.length > 0) {
    const firstCat = Object.keys(CAT_META)[0];
    selectCategory(firstCat);
  }

  // If this is the walk-in page, unlock time + therapist fields immediately
  if (window.__isWalkIn) {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const todayStr = `${y}-${m}-${d}`;
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
  ccValueEl         = document.getElementById('ccValue'); // kept for compat
  ccMinusBtn        = document.getElementById('ccMinus');
  ccPlusBtn         = document.getElementById('ccPlus');
  dateInputEl       = document.getElementById('preferredDate');
  timeSelectEl      = document.getElementById('preferredTime');
  endTimeBadgeEl    = document.getElementById('endTimeBadge');
  // Female dropdown refs
  dropdownDisplayEl   = document.getElementById('femaleDropdownDisplay');
  dropdownOptionsEl   = document.getElementById('femaleDropdownOptions');
  therapistDropdownEl = document.getElementById('femaleTherapistDropdown');
  maxSelectionsSpan   = document.getElementById('femaleMaxSelections');
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

// ─── Services ─────────────────────────────────────────────────────────────────
async function loadServices() {
  try {
    servicesGridEl.innerHTML = '<div class="services-loading">Loading services…</div>';
    const res = await apiFetch(`${API_URL}/services`);
    allServices = await res.json();
    buildCategoryTabs();
  } catch (err) {
    console.error('❌ Failed to load services:', err);
    servicesGridEl.innerHTML = '<div class="services-loading" style="color:#e07b5a">Could not load services. Please refresh.</div>';
  }
}

// ─── Category Tabs ────────────────────────────────────────────────────────────
function buildCategoryTabs() {
  // Derive categories from loaded services
  const catSet = new Set(allServices.map(s => s.category).filter(Boolean));
  const cats = [...catSet].sort((a, b) => {
    const oa = CAT_META[a]?.order ?? 99;
    const ob = CAT_META[b]?.order ?? 99;
    return oa - ob;
  });

  categoryTabsEl.innerHTML = '';
  cats.forEach(cat => {
    const meta = CAT_META[cat] || { icon: '🌿' };
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

  // Update tab highlight
  categoryTabsEl.querySelectorAll('.cat-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.cat === cat);
  });

  // Show couples notice if relevant
  const isCouples = cat === 'Couples Packages';
  couplesNoticeEl.classList.toggle('visible', isCouples);

  // Filter + render services
  renderServices();

  // Reset selection when category changes
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

  list.forEach(svc => {
    const card = buildServiceCard(svc);
    servicesGridEl.appendChild(card);
  });
}

function sortServices(list, sortVal) {
  const copy = [...list];
  switch (sortVal) {
    case 'popular':  copy.sort((a, b) => (b.bookingCount || 0) - (a.bookingCount || 0)); break;
    case 'rating':   copy.sort((a, b) => (b.averageRating || 0) - (a.averageRating || 0)); break;
    case 'price-low': copy.sort((a, b) => getMinPrice(a) - getMinPrice(b)); break;
    case 'price-high': copy.sort((a, b) => getMinPrice(b) - getMinPrice(a)); break;
    default:         copy.sort((a, b) => a.name.localeCompare(b.name));
  }
  return copy;
}

function getMinPrice(svc) {
  if (svc.price && svc.price > 0) return svc.price;
  const pricing = svc.pricing;
  if (!pricing) return 0;
  const vals = typeof pricing.toObject === 'function'
    ? Object.values(pricing.toObject())
    : Object.values(pricing);
  return vals.length ? Math.min(...vals) : 0;
}

function buildServiceCard(svc) {
  const card = document.createElement('div');
  card.className = 'service-card';
  card.dataset.id = svc._id;

  const ratingStr = svc.averageRating > 0
    ? `⭐ ${svc.averageRating.toFixed(1)}  ·  ${svc.bookingCount || 0} bookings`
    : (svc.bookingCount > 0 ? `${svc.bookingCount} bookings` : '');

  // Resolve image URL
  const BACKEND = 'https://nagomi-backend.onrender.com';
  const PLACEHOLDER = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E%3Crect fill='%234b2e1e' width='120' height='120'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' font-family='Poppins,sans-serif' font-size='11' fill='%23f7c6a5'%3ESpa%3C/text%3E%3C/svg%3E`;
  let imgSrc = PLACEHOLDER;
  if (svc.image && svc.image.trim()) {
    imgSrc = svc.image.startsWith('/') ? `${BACKEND}${svc.image}` : svc.image;
  }

  // Build pricing pills
  const pricing = svc.pricing || {};
  const durations = svc.allowedDurations || [60, 90, 120];
  const pricePills = durations.map(d => {
    const p = pricing[d] || pricing[String(d)] || svc.price || 0;
    return `<span class="svc-price-pill">
      ${d} min: ₱${Number(p).toLocaleString()}
    </span>`;
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
    </div>
  `;

  card.addEventListener('click', () => onServiceCardClick(svc, card));
  return card;
}

function buildPriceLabel(svc) {
  return 'Price may vary';
}

// ─── Service Selection ────────────────────────────────────────────────────────
function onServiceCardClick(svc, card) {
  // Highlight card
  servicesGridEl.querySelectorAll('.service-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');

  selectedService = svc;
  selectedMinutes = null;   // reset until user picks duration

  // For Couples Packages, enforce min 2 clients
if (svc.category === 'Couples Packages') {
  // Couples: at least 1 female + 1 male
  if (femaleClients < 1) femaleClients = 1;
  if (maleClients < 1)   maleClients   = 1;
  numClients = femaleClients + maleClients;
  updateGenderCounterUI();
} else {
  // Reset to 0 for both when switching away from Couples
  femaleClients = 0;
  maleClients   = 0;
  numClients    = 0;
  updateGenderCounterUI();
}
updateTotal();

  if (svc.isFixedPrice) {
    // Auto-select the only duration
    selectedMinutes = (svc.allowedDurations && svc.allowedDurations[0]) || 60;
    hideDurationSection();
    updateSummaryBar();
    updateTotal();
    enableStep1Next(true);
  } else {
    // Show duration picker
    buildDurationButtons(svc);
    showDurationSection();
    hideSummaryBar();
    enableStep1Next(false);
  }
}

function clearServiceSelection() {
  selectedService = null;
  selectedMinutes = null;
  servicesGridEl.querySelectorAll('.service-card').forEach(c => c.classList.remove('selected'));
  hideDurationSection();
  hideSummaryBar();
  enableStep1Next(false);
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

    let label = '';
    if (mins === 60)  label = '1 hour';
    else if (mins === 90)  label = '1 hour and 30 minutes';
    else if (mins === 120) label = '2 hours';
    else                   label = `${mins} min`;

    btn.innerHTML = `<span class="dur-min">${label}</span>`;

    btn.addEventListener('click', () => {
      durationGridEl.querySelectorAll('.dur-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedMinutes = mins;

      // Validate closing time
      if (!validateClosingTime()) {
        selectedMinutes = null;
        btn.classList.remove('active');
        return;
      }

      updateSummaryBar();
      updateTotal();
      filterTimeOptions();
      enableStep1Next(true);
    });

    durationGridEl.appendChild(btn);
  });
}

// ─── Duration section visibility ─────────────────────────────────────────────
function showDurationSection() { durationSectionEl.classList.add('visible'); }
function hideDurationSection()  { durationSectionEl.classList.remove('visible'); }
function showSummaryBar()       { summaryBarEl.classList.add('visible'); }
function hideSummaryBar()       { summaryBarEl.classList.remove('visible'); }
function enableStep1Next(val)   { btnStep1Next.disabled = !val; }

// ─── Summary bar ──────────────────────────────────────────────────────────────
function updateSummaryBar() {
  if (!selectedService) { hideSummaryBar(); return; }
  ssbServiceNameEl.textContent = selectedService.name;
  ssbDurationEl.textContent = selectedMinutes
    ? `${selectedMinutes} min · ${selectedService.category}`
    : 'Choose duration above';
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

  // Handle pricing as plain object, Map, MongoDB object, or JSON string
  let pricing = selectedService.pricing || {};
  if (typeof pricing === 'string') {
    try { pricing = JSON.parse(pricing); } catch(e) { pricing = {}; }
  }
  if (typeof pricing.toObject === 'function') pricing = pricing.toObject();
  if (pricing instanceof Map) {
    const mapObj = {};
    pricing.forEach((v, k) => { mapObj[k] = v; });
    pricing = mapObj;
  }

  // Try all key formats: number, string, and also check allowedDurations+price fallback
  let basePrice = pricing[selectedMinutes]
    || pricing[String(selectedMinutes)]
    || pricing[Number(selectedMinutes)]
    || null;

  // Fallback: if service has a flat price field
  if (!basePrice && selectedService.price && selectedService.price > 0) {
    basePrice = selectedService.price;
  }

  // Fallback: if allowedDurations has only one option and prices is an array
  if (!basePrice && selectedService.prices) {
    const idx = (selectedService.allowedDurations || []).indexOf(selectedMinutes);
    if (idx >= 0) basePrice = selectedService.prices[idx];
  }

  basePrice = basePrice || 0;

  // Use max(1, numClients) so price shows even when no clients selected yet
  const clientCount = numClients > 0 ? numClients : 1;
  totalAmount = basePrice * clientCount;

  totalDisplayEl.textContent = '₱' + totalAmount.toLocaleString();
  if (downPayNoteEl) downPayNoteEl.style.display = 'none';
  ssbPriceEl.textContent = basePrice > 0
    ? '₱' + totalAmount.toLocaleString()
    : '₱—';

  console.log('💰 Price debug:', { pricing, selectedMinutes, basePrice, clientCount, totalAmount });

  validateStep3();
}

// ─── Step Navigation ──────────────────────────────────────────────────────────
function goToStep(step) {
  if (step === 2) {
    // Validate step 1
    if (!selectedService || !selectedMinutes) {
      showNotification('❌ Please select a service and duration first.', 'error');
      return;
    }
    // For couples, ensure min 1 female + 1 male
    if (selectedService.category === 'Couples Packages') {
      if (femaleClients < 1) femaleClients = 1;
      if (maleClients < 1)   maleClients   = 1;
      numClients = femaleClients + maleClients;
      updateGenderCounterUI();
      updateTotal();
    }
    // Re-apply progressive lock state
    if (!dateSelected) lockTimeField();
    else if (!timeSelectEl.value) lockTherapistFields();

    // Lock gender columns until date + time both selected
    if (!dateInputEl.value || !timeSelectEl.value) lockGenderSection();
    else unlockGenderSection();
  }

  if (step === 3) {
    if (!dateInputEl.value) {
      showNotification('❌ Please select a date.', 'error');
      return;
    }
    if (!timeSelectEl.value) {
      showNotification('❌ Please select a time.', 'error');
      return;
    }
    if (numClients < 1) {
      showNotification('❌ Please add at least 1 client.', 'error');
      return;
    }
    // Couples: must have at least 1 female + 1 male
    if (selectedService?.category === 'Couples Packages') {
      if (femaleClients < 1 || maleClients < 1) {
        showNotification('👫 Couples Package requires at least 1 female and 1 male client.', 'warning');
        return;
      }
    }
  }

  currentStep = step;

  // Show/hide step panels
  document.querySelectorAll('.booking-step').forEach((el, i) => {
    el.classList.toggle('active', i + 1 === step);
  });

  // Update progress bar
  for (let i = 1; i <= 3; i++) {
    const stepEl = document.getElementById(`pStep${i}`);
    const connEl = document.getElementById(`pConn${i}`);
    stepEl.classList.toggle('active', i === step);
    stepEl.classList.toggle('done', i < step);
    if (connEl) connEl.classList.toggle('done', i < step);
  }

  // Scroll to top of booking container
  document.querySelector('.booking-container').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Booking type ─────────────────────────────────────────────────────────────
function setBookingType(type) {
  bookingType = type;
  document.getElementById('btnOnline')?.classList.toggle('active', type === 'online');
  document.getElementById('btnWalkin')?.classList.toggle('active', type === 'walk-in');
  document.getElementById('walkinNotice')?.classList.toggle('visible', type === 'walk-in');
}
window.setBookingType = setBookingType;

// ─── Gender Client Counters ───────────────────────────────────────────────────
const MAX_FEMALE = 4;
const MAX_MALE   = 2;

function updateGenderCounterUI() {
  const isCouples = selectedService?.category === 'Couples Packages';
  const fMin = isCouples ? 1 : 0;
  const mMin = isCouples ? 1 : 0;

  document.getElementById('ccFValue').textContent = femaleClients;
  document.getElementById('ccFMinus').disabled = (femaleClients <= fMin);
  document.getElementById('ccFPlus').disabled  = (femaleClients >= MAX_FEMALE);
  document.getElementById('femaleMaxSelections').textContent = femaleClients;

  document.getElementById('ccMValue').textContent = maleClients;
  document.getElementById('ccMMinus').disabled = (maleClients <= mMin);
  document.getElementById('ccMPlus').disabled  = (maleClients >= MAX_MALE);
  document.getElementById('maleMaxSelections').textContent = maleClients;

  numClients = femaleClients + maleClients;
  document.getElementById('totalClientsDisplay').textContent = numClients;

  const warning = document.getElementById('totalClientsWarning');
  if (warning) warning.style.display = numClients < 1 ? '' : 'none';

  // Lock/unlock therapist dropdowns based on client counts
  if (femaleClients > 0) unlockFemaleTherapistField();
  else lockFemaleTherapistField();

  if (maleClients > 0) unlockMaleTherapistField();
  else lockMaleTherapistField();

  // Trim selected therapists if over new limit
  trimTherapistSelections();

  // Always re-apply greyout for both columns when counts change
  updateGenderGreyout('female');
  updateGenderGreyout('male');

  checkStep2Ready();
}

function adjustFemaleClients(delta) {
  const isCouples = selectedService?.category === 'Couples Packages';
  const min = isCouples ? 1 : 0;
  femaleClients = Math.max(min, Math.min(MAX_FEMALE, femaleClients + delta));
  updateGenderCounterUI();
  updateTotal();
}

function adjustMaleClients(delta) {
  const isCouples = selectedService?.category === 'Couples Packages';
  const min = isCouples ? 1 : 0;
  maleClients = Math.max(min, Math.min(MAX_MALE, maleClients + delta));
  updateGenderCounterUI();
  updateTotal();
}

// Keep legacy adjustClients as alias (used by couples reset logic)
function adjustClients(delta) { adjustFemaleClients(delta); }

window.adjustFemaleClients = adjustFemaleClients;
window.adjustMaleClients   = adjustMaleClients;
window.adjustClients       = adjustClients;

// ─── Date ─────────────────────────────────────────────────────────────────────
function setupDateRestrictions() {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  dateInputEl.min = `${y}-${m}-${d}`;

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
        therapistConfirmed = false;
        lockTimeField();
      }
      // Grey out therapists who are off on the selected day
      applyDayOffGreyout(dateInputEl.value);
    } else {
      dateSelected = false;
      therapistConfirmed = false;
      dateFullyBooked = false;
      lockTherapistField();
      hideDateWarning();
      resetTherapistAvailability();
      lockGenderSection(); // lock gender section when date is cleared
    }
    validateTimeForToday();
    checkStep2Ready();
    await checkAvailability();
    if (dateInputEl.value) applyDayOffGreyout(dateInputEl.value);

    // Unlock gender section only when BOTH date and time are selected
    if (dateInputEl.value && timeSelectEl.value) unlockGenderSection();
    else lockGenderSection();
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
    checkStep2Ready();

    // Unlock therapist field FIRST so dropdowns are visible
    if (timeSelectEl.value) unlockTherapistField();

    // Unlock gender section now that both date and time are set
    if (dateInputEl.value && timeSelectEl.value) unlockGenderSection();
    else lockGenderSection();

    // Then check availability (awaited so greyouts apply in correct order)
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
    showNotification(
      `❌ Service would end after closing time (11:00 PM). Latest start time for ${selectedMinutes} min is ${latest}.`,
      'error'
    );
    return false;
  }
  return true;
}

function calculateEndTime() {
  if (!timeSelectEl.value || !selectedMinutes) {
    endTimeBadgeEl.classList.remove('visible');
    return;
  }
  const endMins = parseTimeToMinutes(timeSelectEl.value) + selectedMinutes;
  endTimeBadgeEl.textContent = `⏱ End time: ${formatTimeFromMinutes(endMins)}`;
  endTimeBadgeEl.classList.add('visible');
}

function filterTimeOptions() {
  if (!selectedMinutes) return;
  const opts = timeSelectEl.querySelectorAll('option');
  opts.forEach(opt => {
    if (!opt.value) return;
    const startMins = parseTimeToMinutes(opt.value);
    const endMins   = startMins + selectedMinutes;
    const closeMin  = CLOSING_HOUR * 60 + CLOSING_MINS;
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
    showNotification('❌ Cannot book for a time that has already passed today.', 'error');
    timeSelectEl.value = '';
    endTimeBadgeEl.classList.remove('visible');
    checkStep2Ready();
  }
}

function checkStep2Ready() {
  const hasDateTime = dateInputEl.value && timeSelectEl.value;
  const hasClients  = numClients >= 1;

  const femaleOverlay = document.getElementById('femaleNoAvailOverlay');
  const maleOverlay   = document.getElementById('maleNoAvailOverlay');

  const femaleAllUnavailable = femaleOverlay && femaleOverlay.style.display === 'flex';
  const maleAllUnavailable   = maleOverlay && maleOverlay.style.display === 'flex';

  const anyFemaleChecked = document.getElementById('any-female-therapist')?.checked;
  const anyMaleChecked   = document.getElementById('any-male-therapist')?.checked;

  const femaleOk = femaleClients === 0 || (!femaleAllUnavailable && (selectedFemaleTherapists.length > 0 || anyFemaleChecked));
  const maleOk   = maleClients   === 0 || (!maleAllUnavailable && (selectedMaleTherapists.length > 0 || anyMaleChecked));

  btnStep2Next.disabled = !(hasDateTime && hasClients && femaleOk && maleOk) || dateFullyBooked;
}

// ─── Availability check ───────────────────────────────────────────────────────
// ─── Day-off Greyout ─────────────────────────────────────────────────────────
// Grey out therapists who are not working on the selected date
function applyDayOffGreyout(dateStr) {
  if (!dateStr) { resetTherapistAvailability(); return; }

  // Get day name from date — use local date to avoid UTC offset issues
  const [year, month, day] = dateStr.split('-').map(Number);
  const localDate = new Date(year, month - 1, day);
  const dayNames  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const dayName   = dayNames[localDate.getDay()];

  ['female', 'male'].forEach(gender => {
    const anyId     = gender === 'female' ? 'any-female-therapist' : 'any-male-therapist';
    const optionsEl = document.getElementById(gender === 'female' ? 'femaleDropdownOptions' : 'maleDropdownOptions');
    if (!optionsEl) return;

    const cbs = Array.from(optionsEl.querySelectorAll(`input[type="checkbox"]:not(#${anyId})`));
    cbs.forEach(cb => {
      let schedule = [];
      try { schedule = JSON.parse(cb.dataset.schedule || '[]'); } catch(e) {}

      // Find this day in weeklySchedule
      const dayEntry = schedule.find(s => s.dayOfWeek === dayName);
      const isWorking = dayEntry ? dayEntry.isWorking : true; // default to working if no schedule

      const item = cb.parentElement;
      const lbl  = item.querySelector('label');

      if (!isWorking) {
        // Day off — grey out
        cb.disabled = true;
        item.dataset.available = 'false';
        item.style.opacity = '0.4';
        item.style.cursor  = 'not-allowed';
        if (lbl) {
          lbl.style.color = 'rgba(247,198,165,0.4)';
          lbl.title = `Day off on ${dayName}`;
        }
        // Uncheck if was selected
        if (cb.checked) {
          cb.checked = false;
          if (gender === 'female') {
            selectedFemaleTherapists = selectedFemaleTherapists.filter(t => t.id !== cb.dataset.id);
          } else {
            selectedMaleTherapists = selectedMaleTherapists.filter(t => t.id !== cb.dataset.id);
          }
          selectedTherapists = [...selectedFemaleTherapists, ...selectedMaleTherapists];
          updateGenderDropdownDisplay(gender);
        }
      } else {
        // Working day — restore, BUT only if not booked at the selected time
        item.dataset.available = 'true';
        if (item.dataset.booked === 'true') return; // booked greyout wins — don't restore
        if (!cb.checked) {
          const limit        = gender === 'female' ? femaleClients : maleClients;
          const checkedCount = cbs.filter(c => c.checked).length;
          if (checkedCount < limit || limit === 0) {
            cb.disabled = false;
            item.style.opacity = '1';
            item.style.cursor  = 'pointer';
            if (lbl) { lbl.style.color = ''; lbl.title = ''; lbl.style.textDecoration = ''; }
          }
        }
      }
    });

    // Re-apply limit greyout on top
    updateGenderGreyout(gender);
    checkGenderColAvailability(gender);
  });
}

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

    if (!res.ok) {
      lastAvailableList = null;
      resetTherapistAvailability();
    } else {
      const data = await res.json();
      lastAvailableList = data.available || [];
      applyBookingAvailabilityGreyout(lastAvailableList);
    }
  } catch (err) {
    console.error('Availability check error:', err);
    lastAvailableList = null;
    resetTherapistAvailability();
  }

  // Always re-apply day-off LAST so it wins over booking availability
  if (dateInputEl.value) applyDayOffGreyout(dateInputEl.value);
}

// Grey out therapists who are booked at the selected time
// availableList = therapists who ARE free (from API)
function applyBookingAvailabilityGreyout(availableList) {
  // Always convert to plain lowercase string for reliable comparison
  const availIds = new Set(
    availableList.map(t => String(t.id || t._id || '').trim().toLowerCase())
  );

  ['female', 'male'].forEach(gender => {
    const anyId     = gender === 'female' ? 'any-female-therapist' : 'any-male-therapist';
    const optionsEl = document.getElementById(gender === 'female' ? 'femaleDropdownOptions' : 'maleDropdownOptions');
    if (!optionsEl) return;

    const cbs = Array.from(optionsEl.querySelectorAll(`input[type="checkbox"]:not(#${anyId})`));
    cbs.forEach(cb => {
      const id      = (cb.dataset.id || '').trim().toLowerCase();
      const isAvail = availIds.has(id);
      const item    = cb.parentElement;
      const lbl     = item.querySelector('label');

      if (!isAvail) {
        // Already booked at this time — grey out
        cb.disabled = true;
        item.dataset.booked = 'true';
        item.style.opacity  = '0.4';
        item.style.cursor   = 'not-allowed';
        if (lbl) {
          lbl.style.color           = 'rgba(247,198,165,0.4)';
          lbl.style.textDecoration  = 'line-through';
          lbl.title = 'Already booked at this time';
        }
        // Deselect if was selected
        if (cb.checked) {
          cb.checked = false;
          if (gender === 'female') selectedFemaleTherapists = selectedFemaleTherapists.filter(t => t.id !== id);
          else                     selectedMaleTherapists   = selectedMaleTherapists.filter(t => t.id !== id);
          selectedTherapists = [...selectedFemaleTherapists, ...selectedMaleTherapists];
          updateGenderDropdownDisplay(gender);
        }
      } else {
        // Free — restore (unless day-off, handled after)
        item.dataset.booked = 'false';
        if (item.dataset.available !== 'false') {
          cb.disabled         = false;
          item.style.opacity  = '1';
          item.style.cursor   = 'pointer';
          if (lbl) { lbl.style.color = ''; lbl.style.textDecoration = ''; lbl.title = ''; }
        }
      }
    });

    updateGenderGreyout(gender);
    checkGenderColAvailability(gender);
  });
}

// ── Show/hide the "no therapists available" overlay on each gender column ──
function checkGenderColAvailability(gender) {
  const anyId     = gender === 'female' ? 'any-female-therapist' : 'any-male-therapist';
  const optionsEl = document.getElementById(gender === 'female' ? 'femaleDropdownOptions' : 'maleDropdownOptions');
  const overlay   = document.getElementById(gender === 'female' ? 'femaleNoAvailOverlay' : 'maleNoAvailOverlay');
  const col       = document.getElementById(gender === 'female' ? 'femaleGenderCol' : 'maleGenderCol');
  if (!optionsEl || !overlay) return;

  const cbs = Array.from(optionsEl.querySelectorAll(`input[type="checkbox"]:not(#${anyId})`));
  if (cbs.length === 0) { overlay.style.display = 'none'; return; }

  // Only show overlay when both date AND time are selected
  if (!dateInputEl?.value || !timeSelectEl?.value || timeSelectEl.value === 'Select time...') {
    overlay.style.display = 'none';
    if (col) col.style.opacity = '1';
    return;
  }

  const allUnavailable = cbs.every(cb => cb.disabled);
  overlay.style.display = allUnavailable ? 'flex' : 'none';
  if (col) col.style.opacity = allUnavailable ? '0.75' : '1';
}
function unlockFemaleTherapistField() {
  var el   = document.getElementById('femaleTherapistFieldGroup');
  var hint = document.getElementById('femaleTherapistLockHint');
  if (!el) return;
  el.classList.remove('field-group-locked');
  el.classList.add('field-group-unlocking');
  if (hint) hint.style.display = 'none';
  setTimeout(function(){ el.classList.remove('field-group-unlocking'); }, 500);
}
function unlockMaleTherapistField() {
  var el   = document.getElementById('maleTherapistFieldGroup');
  var hint = document.getElementById('maleTherapistLockHint');
  if (!el) return;
  el.classList.remove('field-group-locked');
  el.classList.add('field-group-unlocking');
  if (hint) hint.style.display = 'none';
  setTimeout(function(){ el.classList.remove('field-group-unlocking'); }, 500);
}
// ─── Gender section lock (until date + time selected) ─────────────────────────
function lockGenderSection() {
  ['female', 'male'].forEach(g => {
    const col = document.querySelector(`.gender-col--${g}`);
    if (!col) return;
    col.style.opacity     = '0.45';
    col.style.pointerEvents = 'none';
    col.style.userSelect  = 'none';
    col.title = 'Please select a date and time first';
  });
}

function unlockGenderSection() {
  ['female', 'male'].forEach(g => {
    const col = document.querySelector(`.gender-col--${g}`);
    if (!col) return;
    col.style.opacity       = '1';
    col.style.pointerEvents = '';
    col.style.userSelect    = '';
    col.title = '';
  });
}

function lockFemaleTherapistField() {
  var el   = document.getElementById('femaleTherapistFieldGroup');
  var hint = document.getElementById('femaleTherapistLockHint');
  if (el) { el.classList.add('field-group-locked'); el.classList.remove('field-group-unlocking'); }
  if (hint) hint.style.display = '';
}
function lockMaleTherapistField() {
  var el   = document.getElementById('maleTherapistFieldGroup');
  var hint = document.getElementById('maleTherapistLockHint');
  if (el) { el.classList.add('field-group-locked'); el.classList.remove('field-group-unlocking'); }
  if (hint) hint.style.display = '';
}
// Unified helpers used in setupTimeListener / date change
function unlockTherapistField()  { if (femaleClients > 0) unlockFemaleTherapistField(); if (maleClients > 0) unlockMaleTherapistField(); }
function lockTherapistField()    { lockFemaleTherapistField(); lockMaleTherapistField(); }
function lockTherapistFields()   { lockTherapistField(); }
function unlockTherapistFields() { unlockTherapistField(); }

function unlockTimeField() {
  var el   = document.getElementById('timeFieldGroup');
  var hint = document.getElementById('timeLockHint');
  if (!el) return;
  el.classList.remove('field-group-locked');
  el.classList.add('field-group-unlocking');
  if (hint) hint.style.display = 'none';
  setTimeout(function(){ el.classList.remove('field-group-unlocking'); }, 500);
}
function lockTimeField() {
  var el   = document.getElementById('timeFieldGroup');
  var hint = document.getElementById('timeLockHint');
  if (el) { el.classList.add('field-group-locked'); el.classList.remove('field-group-unlocking'); }
  if (hint) hint.style.display = '';
  if (timeSelectEl) timeSelectEl.value = '';
  if (endTimeBadgeEl) endTimeBadgeEl.classList.remove('visible');
  femaleTherapistConfirmed = false;
  maleTherapistConfirmed   = false;
  therapistConfirmed       = false;
  lockTherapistField();
  checkStep2Ready();
}

// ─── Date-level Availability Check ─────────────────────────────────────────
async function checkDateAvailability(dateStr) {
  if (!selectedMinutes) return;
  try {
    var res = await apiFetch(API_URL + "/bookings/date-availability?date=" + dateStr + "&duration=" + selectedMinutes);
    if (!res.ok) return;
    var data = await res.json();
   if (data.fullyBooked) {
  dateFullyBooked = true;

  if (data.blockedByAdmin) {
    const title = data.blockReason === 'vacation'
      ? `🏖️ The spa is closed: "${data.blockLabel}"`
      : `🚫 ${data.blockLabel || 'Store Holiday'}`;
    showDateWarning(title, 'Please choose another date to continue.', 'caution');
    lockTimeField();
    updateStep2Next(); // re-evaluate button
    return;
  }

  // Fully booked by appointments
  showDateWarning(
    "⛔ This date is fully booked",
    "All therapists are occupied for " + selectedMinutes + "-minute services on this day. Please select a different date to continue.",
    "error"
  );
  lockTimeField();
  updateStep2Next(); // re-evaluate button — will disable it
} else {
      dateFullyBooked = false;
      if (data.busySlots && data.busySlots.length > 0) {
        disableFullyBookedTimes(data.busySlots);
        if (data.busySlots.length >= 6) {
          showDateWarning(
            "Some times are unavailable",
            "Greyed-out slots have no available therapists. Choose from the remaining times.",
            "warning"
          );
        } else {
          hideDateWarning();
        }
      } else {
        hideDateWarning();
        resetTimeOptions();
      }
    }
  } catch (err) {
    console.error("Date availability check failed:", err);
    dateFullyBooked = false;
  }
}

function disableFullyBookedTimes(busySlots) {
  if (!timeSelectEl) return;
  var opts = timeSelectEl.querySelectorAll("option");
  opts.forEach(function(opt) {
    if (!opt.value) return;
    var isBusy = busySlots.indexOf(opt.value) !== -1;
    opt.disabled = isBusy;
    opt.textContent = isBusy ? opt.value + " (fully booked)" : opt.value;
  });
}

function resetTimeOptions() {
  if (!timeSelectEl) return;
  var opts = timeSelectEl.querySelectorAll("option");
  opts.forEach(function(opt) {
    opt.disabled = false;
    if (opt.value) opt.textContent = opt.value;
  });
}

function showDateWarning(title, detail, type) {
  var el = document.getElementById("dateAvailWarning");
  if (!el) return;
  var isError = type === "error";
  el.className = "date-avail-warning " + (isError ? "daw-error" : "daw-caution");
  el.innerHTML =
    "<span class=\"daw-icon\">" + (isError ? "⛔" : "⚠️") + "</span>" +
    "<div><strong>" + title + "</strong>" +
    (detail ? "<br><span class=\"daw-detail\">" + detail + "</span>" : "") + "</div>";
  el.style.display = "flex";
el.style.justifyContent = "center";
el.style.textAlign = "center";
}

function hideDateWarning() {
  var el = document.getElementById("dateAvailWarning");
  if (el) el.style.display = "none";
  resetTimeOptions();
}

function showDateChecking(show) {
  var el = document.getElementById("dateAvailWarning");
  if (!el) return;
  if (show) {
    el.className = "date-avail-warning daw-checking";
    el.innerHTML = "<span class=\"daw-icon\">\u23f3</span><div><strong>Checking availability…</strong></div>";
    el.style.display = "flex";
  } else {
    if (el.className.indexOf("daw-checking") !== -1) el.style.display = "none";
  }
}
// ─── Therapist Dropdown ───────────────────────────────────────────────────────
async function loadTherapists() {
  try {
    const res = await apiFetch(`${API_URL}/auth/therapists`);
    allTherapists = await res.json();

    const femaleList = allTherapists.filter(t => t.gender === 'female');
    const maleList   = allTherapists.filter(t => t.gender === 'male');
    const noneHaveGender = femaleList.length === 0 && maleList.length === 0;

    // If gender not in DB yet: show all in both (temporary fallback)
    // If partially set: use what we have, fallback to all for the empty side
    populateGenderDropdown('female', noneHaveGender || femaleList.length === 0 ? allTherapists : femaleList);
    populateGenderDropdown('male',   noneHaveGender || maleList.length   === 0 ? allTherapists : maleList);

    console.log(`✅ Loaded ${allTherapists.length} therapists`);
    // If date already selected, apply day-off greyout immediately
    if (dateInputEl && dateInputEl.value) applyDayOffGreyout(dateInputEl.value);
  } catch (err) {
    console.error('Failed to load therapists:', err);
  }
}

function populateGenderDropdown(gender, therapists) {
  const optionsEl = document.getElementById(gender === 'female' ? 'femaleDropdownOptions' : 'maleDropdownOptions');
  // Remove existing non-"any" options
  const existing = optionsEl.querySelectorAll('.option-item');
  existing.forEach((el, i) => { if (i > 0) el.remove(); });

  therapists.forEach(t => {
    const div = document.createElement('div');
    div.className = 'option-item';
    div.style.cssText = 'cursor:pointer;display:flex;align-items:center;gap:10px;padding:10px 14px;user-select:none;';
    div.innerHTML = `
      <input type="checkbox" id="therapist-${gender}-${t._id}" value="${t.name}"
        data-id="${t._id}"
        data-gender="${gender}"
        data-expertise='${JSON.stringify(t.expertise || [])}'
        data-schedule='${JSON.stringify(t.weeklySchedule || [])}'>
      <label for="therapist-${gender}-${t._id}" style="cursor:pointer;pointer-events:none;">${t.name}</label>
    `;
    div.addEventListener('click', (e) => {
      const cb = div.querySelector('input[type="checkbox"]');
      if (!cb || cb.disabled) return;
      if (e.target !== cb) cb.click();
    });
    optionsEl.appendChild(div);
  });

  refreshGenderDropdownListeners(gender);
}

function setupTherapistDropdown() {
  setupGenderDropdown('female');
  setupGenderDropdown('male');
}

function setupGenderDropdown(gender) {
  const displayEl  = document.getElementById(gender === 'female' ? 'femaleDropdownDisplay'  : 'maleDropdownDisplay');
  const optionsEl  = document.getElementById(gender === 'female' ? 'femaleDropdownOptions'  : 'maleDropdownOptions');
  const dropdownEl = document.getElementById(gender === 'female' ? 'femaleTherapistDropdown': 'maleTherapistDropdown');

  if (!displayEl || !optionsEl || !dropdownEl) {
    console.warn(`setupGenderDropdown: missing elements for gender="${gender}"`);
    return;
  }

  displayEl.addEventListener('click', () => {
    optionsEl.classList.toggle('show');
    // Re-apply greyout when opening dropdown in case API finished after last open
    if (optionsEl.classList.contains('show') && lastAvailableList !== null) {
      applyBookingAvailabilityGreyout(lastAvailableList);
      if (dateInputEl.value) applyDayOffGreyout(dateInputEl.value);
    }
  });

  document.addEventListener('click', function(e) {
    if (!dropdownEl.contains(e.target)) {
      const wasOpen = optionsEl.classList.contains('show');
      optionsEl.classList.remove('show');
      if (wasOpen && dateSelected) {
        if (gender === 'female') femaleTherapistConfirmed = true;
        else                     maleTherapistConfirmed   = true;
        checkStep2Ready();
      }
    }
  });
}

function refreshGenderDropdownListeners(gender) {
  const anyId     = gender === 'female' ? 'any-female-therapist' : 'any-male-therapist';
  const optionsEl = document.getElementById(gender === 'female' ? 'femaleDropdownOptions' : 'maleDropdownOptions');
  const maxCount  = gender === 'female' ? femaleClients : maleClients;
  const anyCheckbox = document.getElementById(anyId);

  const otherCBs = () => Array.from(
    optionsEl.querySelectorAll(`input[type="checkbox"]:not(#${anyId})`)
  );

  anyCheckbox.addEventListener('change', () => {
    if (anyCheckbox.checked) {
      otherCBs().forEach(cb => { cb.checked = false; });
      if (gender === 'female') selectedFemaleTherapists = [];
      else                     selectedMaleTherapists   = [];
      updateGenderDropdownDisplay(gender);
      updateGenderGreyout(gender);
      checkStep2Ready();
    }
  });

  optionsEl.addEventListener('change', (e) => {
    const cb = e.target;
    if (!cb || cb.id === anyId) return;

    const limit = gender === 'female' ? femaleClients : maleClients;
    const checked = otherCBs().filter(c => c.checked);
    if (cb.checked && checked.length > limit) {
      cb.checked = false;
      showNotification(`You can only select up to ${limit} ${gender} therapist(s).`, 'warning');
      return;
    }

    const selected = otherCBs()
      .filter(c => c.checked)
      .map(c => ({ name: c.value, id: c.dataset.id, gender }));

    if (gender === 'female') selectedFemaleTherapists = selected;
    else                     selectedMaleTherapists   = selected;

    // Sync legacy selectedTherapists for summary/submission
    selectedTherapists = [...selectedFemaleTherapists, ...selectedMaleTherapists];

    const any = document.getElementById(anyId);
    if (selected.length > 0) any.checked = false;
    else                      any.checked = true;

    updateGenderDropdownDisplay(gender);
    updateGenderGreyout(gender);
    checkStep2Ready();
  });
}

function updateTherapistGreyout() {
  updateGenderGreyout('female');
  updateGenderGreyout('male');
}

function updateGenderGreyout(gender) {
  const anyId     = gender === 'female' ? 'any-female-therapist' : 'any-male-therapist';
  const optionsEl = document.getElementById(gender === 'female' ? 'femaleDropdownOptions' : 'maleDropdownOptions');
  const limit     = gender === 'female' ? femaleClients : maleClients;
  const otherCBs  = Array.from(optionsEl.querySelectorAll(`input[type="checkbox"]:not(#${anyId})`));

  // If no clients for this gender, clear all greyout EXCEPT day-off therapists
  if (limit === 0) {
    otherCBs.forEach(cb => {
      if (cb.parentElement.dataset.available === 'false') return; // keep day-off greyout
      cb.disabled = false;
      cb.parentElement.style.opacity = '1';
      cb.parentElement.style.cursor  = 'pointer';
      const lbl = cb.parentElement.querySelector('label');
      if (lbl) { lbl.style.color = ''; lbl.style.textDecoration = ''; }
    });
    return;
  }

  const checkedCount = otherCBs.filter(cb => cb.checked).length;
  const limitReached = checkedCount >= limit;

  otherCBs.forEach(cb => {
    // Skip therapists on day off or already booked — those states own their own styling
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
      if (lbl) lbl.style.color = 'rgba(247,198,165,0.4)';
    } else {
      cb.disabled = false;
      cb.parentElement.style.opacity = '1';
      cb.parentElement.style.cursor  = 'pointer';
      if (lbl) { lbl.style.color = ''; lbl.style.textDecoration = ''; }
    }
  });
}

function updateDropdownDisplay() {
  updateGenderDropdownDisplay('female');
  updateGenderDropdownDisplay('male');
}

function updateGenderDropdownDisplay(gender) {
  const anyId     = gender === 'female' ? 'any-female-therapist' : 'any-male-therapist';
  const displayEl = document.getElementById(gender === 'female' ? 'femaleDropdownDisplay' : 'maleDropdownDisplay');
  const anyCheckbox = document.getElementById(anyId);
  const ph = displayEl?.querySelector('.placeholder');
  if (!ph) return;
  const selected = gender === 'female' ? selectedFemaleTherapists : selectedMaleTherapists;
  if (anyCheckbox?.checked || selected.length === 0) {
    ph.textContent = 'Any Available Therapist';
  } else {
    ph.textContent = selected.map(t => t.name).join(', ');
  }
}

function trimTherapistSelections() {
  // Trim female selections if over new female client count
  if (selectedFemaleTherapists.length > femaleClients) {
    selectedFemaleTherapists = selectedFemaleTherapists.slice(0, femaleClients);
    const optionsEl = document.getElementById('femaleDropdownOptions');
    const cbs = Array.from(optionsEl.querySelectorAll('input[type="checkbox"]:not(#any-female-therapist)'));
    const keepIds = new Set(selectedFemaleTherapists.map(t => t.id));
    cbs.forEach(cb => { if (!keepIds.has(cb.dataset.id)) cb.checked = false; });
    updateGenderDropdownDisplay('female');
  }
  // Trim male selections if over new male client count
  if (selectedMaleTherapists.length > maleClients) {
    selectedMaleTherapists = selectedMaleTherapists.slice(0, maleClients);
    const optionsEl = document.getElementById('maleDropdownOptions');
    const cbs = Array.from(optionsEl.querySelectorAll('input[type="checkbox"]:not(#any-male-therapist)'));
    const keepIds = new Set(selectedMaleTherapists.map(t => t.id));
    cbs.forEach(cb => { if (!keepIds.has(cb.dataset.id)) cb.checked = false; });
    updateGenderDropdownDisplay('male');
  }
  selectedTherapists = [...selectedFemaleTherapists, ...selectedMaleTherapists];
}

function resetTherapistAvailability() {
  resetGenderAvailability('female');
  resetGenderAvailability('male');
}

function resetGenderAvailability(gender) {
  const anyId     = gender === 'female' ? 'any-female-therapist' : 'any-male-therapist';
  const optionsEl = document.getElementById(gender === 'female' ? 'femaleDropdownOptions' : 'maleDropdownOptions');
  if (!optionsEl) return;
  const otherCBs = Array.from(optionsEl.querySelectorAll(`input[type="checkbox"]:not(#${anyId})`));
  otherCBs.forEach(cb => {
    // Never reset therapists marked as day-off
    if (cb.parentElement.dataset.available === 'false') return;
    cb.disabled = false;
    cb.parentElement.dataset.booked = 'false';
    cb.parentElement.style.opacity  = '1';
    cb.parentElement.style.cursor   = 'pointer';
    const lbl = cb.parentElement.querySelector('label');
    if (lbl) { lbl.style.color = ''; lbl.style.textDecoration = ''; lbl.title = ''; }
  });
  updateGenderGreyout(gender);
}

function updateTherapistAvailability(availableList) {
  updateGenderAvailability('female', availableList);
  updateGenderAvailability('male',   availableList);
}

function updateGenderAvailability(gender, availableList) {
  const anyId     = gender === 'female' ? 'any-female-therapist' : 'any-male-therapist';
  const optionsEl = document.getElementById(gender === 'female' ? 'femaleDropdownOptions' : 'maleDropdownOptions');
  const availIds  = availableList.map(t => String(t.id || t._id || ''));
  const otherCBs  = Array.from(optionsEl.querySelectorAll(`input[type="checkbox"]:not(#${anyId})`));

  otherCBs.forEach(cb => {
    const id   = cb.dataset.id;
    // Only grey out therapists explicitly confirmed as unavailable (already booked at that time)
    // Don't grey based on expertise — that's enforced at booking time on the backend
    const avail = availIds.includes(id);
    cb.parentElement.dataset.available = avail ? 'true' : 'false';
    if (!avail) {
      cb.disabled = true;
      cb.parentElement.style.opacity = '0.4';
      cb.parentElement.style.cursor  = 'not-allowed';
      const lbl = cb.parentElement.querySelector('label');
      if (lbl) { lbl.style.color = 'rgba(247,198,165,0.4)'; lbl.style.textDecoration = 'line-through'; }
      if (cb.checked) {
        cb.checked = false;
        if (gender === 'female') selectedFemaleTherapists = selectedFemaleTherapists.filter(t => t.id !== id);
        else                     selectedMaleTherapists   = selectedMaleTherapists.filter(t => t.id !== id);
        selectedTherapists = [...selectedFemaleTherapists, ...selectedMaleTherapists];
        updateGenderDropdownDisplay(gender);
      }
    }
  });
  updateGenderGreyout(gender);
}

// ─── Step 3 Validation ────────────────────────────────────────────────────────
function validateStep3() {
  const name  = document.getElementById('guestName')?.value?.trim();
  const phone = document.getElementById('guestPhone')?.value?.trim();
  if (btnReview) btnReview.disabled = !(name && phone);
}

function setupCharCounter() {
  guestNotesEl?.addEventListener('input', () => {
    charCountSmEl.textContent = `${guestNotesEl.value.length} / 500`;
  });
}

// Validate on input so the "Review" button enables in real-time
document.addEventListener('input', (e) => {
  if (e.target.id === 'guestName' || e.target.id === 'guestPhone') {
    validateStep3();
  }
});

function submitStep3() {
  const name  = document.getElementById('guestName')?.value?.trim();
  const phone = document.getElementById('guestPhone')?.value?.trim();
  if (!name || !phone) {
    showNotification('❌ Please enter your name and phone number.', 'error');
    return;
  }
  populateSummaryModal();
  showSummaryModal();
}

// ─── Sort filter ──────────────────────────────────────────────────────────────
document.addEventListener('change', (e) => {
  if (e.target.id === 'sortFilter') {
    currentSort = e.target.value;
    if (selectedCategory) renderServices();
  }
});

// ─── Summary Modal ────────────────────────────────────────────────────────────
function populateSummaryModal() {
  document.getElementById('summary-category').textContent   = selectedService?.category || '—';
  document.getElementById('summary-service').textContent    = selectedService?.name || '—';
  document.getElementById('summary-duration').textContent   = selectedMinutes ? `${selectedMinutes} minutes` : '—';
  document.getElementById('summary-clients').textContent    =
    `${numClients} (${femaleClients}F / ${maleClients}M)`;

  const therapistParts = [];
  const anyFemale = document.getElementById('any-female-therapist')?.checked;
  if (femaleClients > 0 && (selectedFemaleTherapists.length > 0 || anyFemale)) {
    const femaleNames = selectedFemaleTherapists.length > 0
      ? selectedFemaleTherapists.map(t => t.name).join(', ')
      : 'Any Available Therapist';
    therapistParts.push(`Female: ${femaleNames}`);
  }
  
  const anyMale = document.getElementById('any-male-therapist')?.checked;
  if (maleClients > 0 && (selectedMaleTherapists.length > 0 || anyMale)) {
    const maleNames = selectedMaleTherapists.length > 0
      ? selectedMaleTherapists.map(t => t.name).join(', ')
      : 'Any Available Therapist';
    therapistParts.push(`Male: ${maleNames}`);
  }
  document.getElementById('summary-therapists').textContent =
    therapistParts.length > 0 ? therapistParts.join(' | ') : '—';

  document.getElementById('summary-date').textContent = dateInputEl.value
    ? new Date(dateInputEl.value).toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' })
    : '—';
  document.getElementById('summary-time').textContent    = timeSelectEl.value || '—';

  // End time calc
  if (timeSelectEl.value && selectedMinutes) {
    const endMins = parseTimeToMinutes(timeSelectEl.value) + selectedMinutes;
    document.getElementById('summary-endtime').textContent = formatTimeFromMinutes(endMins);
  } else {
    document.getElementById('summary-endtime').textContent = '—';
  }

  document.getElementById('summary-name').textContent  = document.getElementById('guestName')?.value || '—';
  document.getElementById('summary-phone').textContent = document.getElementById('guestPhone')?.value || '—';

  const notes = guestNotesEl?.value?.trim() || '';
  const notesSec = document.getElementById('notes-section');
  if (notes) {
    document.getElementById('summary-notes').textContent = notes;
    notesSec.style.display = 'block';
  } else {
    notesSec.style.display = 'none';
  }

  document.getElementById('summary-total').textContent = '₱' + totalAmount.toLocaleString();
}

function showSummaryModal() {
  summaryModalEl.style.display = 'flex';
  document.body.style.overflow = 'hidden';
  const sc = summaryModalEl.querySelector('.summary-content');
  if (sc) sc.scrollTop = 0;
  // Reset terms checkbox
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
  backToEditBtn?.addEventListener('click', () => {
    hideSummaryModal();
    goToStep(3);
  });
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
      showNotification('❌ Please accept the Terms and Conditions to proceed.', 'error');
      return;
    }

    const name  = document.getElementById('guestName')?.value?.trim();
    const phone = document.getElementById('guestPhone')?.value?.trim();
    const notes = guestNotesEl?.value?.trim() || '';
    const date  = dateInputEl.value;
    const time  = timeSelectEl.value;

    if (!selectedService || !selectedMinutes || !date || !time || !name || !phone) {
      showNotification('❌ Please complete all required fields.', 'error');
      return;
    }

    // Calculate end time string
    const endMins = parseTimeToMinutes(time) + selectedMinutes;
    const endTime = formatTimeFromMinutes(endMins);

    const bookingData = {
      service:         selectedService.name,
      minutes:         String(selectedMinutes),
      therapists:      selectedTherapists.length > 0
                         ? selectedTherapists
                         : [{ name: 'Any available therapist' }],
      femaleTherapists: selectedFemaleTherapists.length > 0
                         ? selectedFemaleTherapists
                         : [],
      maleTherapists:   selectedMaleTherapists.length > 0
                         ? selectedMaleTherapists
                         : [],
      numberOfClients: numClients,
      femaleClients,
      maleClients,
      date,
      time,
      endTime,
      notes,
      name,
      phone,
      totalAmount,
      paymentMethod:   bookingType === 'walk-in' ? 'Cash on Arrival' : 'Not specified',
      termsAccepted:   true,
      bookingType,
    };

    confirmBookingBtn.disabled = true;
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
        showNotification(`⚠️ ${data.msg || 'Booking failed. Please try again.'}`, 'error');
      }
    } catch (err) {
      console.error('Booking submit error:', err);
      showNotification('❌ Server error. Please try again later.', 'error');
    } finally {
      confirmBookingBtn.disabled = false;
      confirmBookingBtn.textContent = 'Confirm Booking →';
    }
  });
}

function showSuccessMessage(txn) {
  const el = document.createElement('div');
  el.style.cssText = `
    position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
    background:white;padding:40px;border-radius:20px;
    box-shadow:0 10px 40px rgba(0,0,0,0.3);z-index:10002;
    text-align:center;max-width:480px;width:90%;
  `;
  el.innerHTML = `
    <div style="font-size:3rem;margin-bottom:20px">✅</div>
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
    </div>
  `;
  document.body.appendChild(el);
  // Auto-close removed — client must manually dismiss to read transaction number
}

function resetForm() {
  selectedService  = null;
  selectedMinutes  = null;
  selectedTherapists = [];
  selectedFemaleTherapists = [];
  selectedMaleTherapists   = [];
  numClients    = 0;
  femaleClients = 0;
  maleClients   = 0;
  totalAmount   = 0;

  // Reset gender counter UI
  document.getElementById('ccFValue').textContent = '0';
  document.getElementById('ccFMinus').disabled = true;
  document.getElementById('ccFPlus').disabled  = false;
  document.getElementById('femaleMaxSelections').textContent = '0';
  document.getElementById('ccMValue').textContent = '0';
  document.getElementById('ccMMinus').disabled = true;
  document.getElementById('ccMPlus').disabled  = false;
  document.getElementById('maleMaxSelections').textContent = '0';
  document.getElementById('totalClientsDisplay').textContent = '0';

  dateInputEl.value = '';
  timeSelectEl.value = '';
  endTimeBadgeEl.classList.remove('visible');

  document.getElementById('guestName').value  = '';
  document.getElementById('guestPhone').value = '';
  guestNotesEl.value = '';
  charCountSmEl.textContent = '0 / 500';

  totalDisplayEl.textContent = '₱0';

  hideDurationSection();
  hideSummaryBar();
  enableStep1Next(false);
  btnStep2Next.disabled = true;
  if (btnReview) btnReview.disabled = true;

  const anyFemale = document.getElementById('any-female-therapist');
  if (anyFemale) anyFemale.checked = false;
  const anyMale = document.getElementById('any-male-therapist');
  if (anyMale) anyMale.checked = false;

  // Uncheck all therapist checkboxes in both dropdowns
  ['femaleDropdownOptions','maleDropdownOptions'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      if (cb.id !== 'any-female-therapist' && cb.id !== 'any-male-therapist') cb.checked = false;
    });
  });
  updateDropdownDisplay();

  goToStep(1);
  if (selectedCategory) renderServices();
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
  const bg = type === 'success' ? '#28a745'
           : type === 'error'   ? '#dc3545'
           : type === 'warning' ? '#e68a00'
           : '#007bff';
  el.style.cssText = `
    position:fixed;top:20px;right:20px;
    background:${bg};color:white;
    padding:14px 22px;border-radius:10px;
    box-shadow:0 4px 16px rgba(0,0,0,0.18);
    z-index:10005;max-width:380px;
    font-family:'Poppins',sans-serif;font-size:0.88rem;
    animation:slideInRight 0.3s ease;
  `;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, 5000);
}

// Animation
const notifStyle = document.createElement('style');
notifStyle.textContent = `
  @keyframes slideInRight {
    from { transform: translateX(400px); opacity: 0; }
    to   { transform: translateX(0);     opacity: 1; }
  }
`;
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