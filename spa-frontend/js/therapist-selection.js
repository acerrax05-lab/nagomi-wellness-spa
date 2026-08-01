// ═══════════════════════════════════════════════════════════════════════
//  therapist-selection.js
//  Smart Therapist Selection Module — Nagomi Wellness Spa
//
//  Always shows two gender-labeled dropdowns (Female / Male).
//  Visibility is controlled by booking mode:
//    • Individual Female  → Female dropdown only
//    • Individual Male    → Male dropdown only
//    • Group / Couple     → Both dropdowns shown
// ═══════════════════════════════════════════════════════════════════════

(function () {
  'use strict';

  /* ─────────────────────────────────────────────────────────────
     STATE
  ───────────────────────────────────────────────────────────────*/
  let femaleSelection = null; // { id, name, gender }
  let maleSelection   = null;
  let _pollTimer      = null;

  /* ─────────────────────────────────────────────────────────────
     INIT
  ───────────────────────────────────────────────────────────────*/
  function init() {
    // Trigger re-render when guest gender changes (Step 1)
    on('guestGender', 'change', onContextChange);

    // Wrap booking.js availability functions to re-render when availability updates
    wrapFn('applyBookingAvailabilityGreyout', function (original, list) {
      if (original) original(list);
      renderDropdowns();
      runValidation();
    });
    wrapFn('applyDayOffGreyout', function (original, dateStr) {
      if (original) original(dateStr);
      renderDropdowns();
      runValidation();
    });

    // Wrap checkStep3Ready to gate btnReview on couple validation
    wrapFn('checkStep3Ready', function (original) {
      if (original) original();
      applyTherapistGateToBtn();
    });

    // Wrap submitStep3 to validate therapists before opening summary
    wrapFn('submitStep3', function (original) {
      if (!validateTherapists(true)) return;
      if (original) original();
    });

    // Wrap resetForm to clear our state
    wrapFn('resetForm', function (original) {
      femaleSelection = null;
      maleSelection   = null;
      if (original) original();
      renderDropdowns();
      runValidation();
    });

    // Expose for booking.js hooks
    window.refreshTherapistUI = onContextChange;
  }

  /* ─────────────────────────────────────────────────────────────
     BOOKING MODE
  ───────────────────────────────────────────────────────────────*/
  function getMode() {
    const svc = window.selectedService;
    if (svc?.category === 'Couples Packages') return 'couple';
    return (window.numClients || 1) >= 2 ? 'group' : 'individual';
  }

  function getGuestGender() {
    return (el('guestGender')?.value || '').toLowerCase(); // 'male'|'female'|''
  }

  /* ─────────────────────────────────────────────────────────────
     AVAILABILITY HELPERS
  ───────────────────────────────────────────────────────────────*/
  function getAvailableIds() {
    const list = window.lastAvailableList;
    if (!Array.isArray(list)) return null;
    return new Set(list.map(t => String(t.id || t._id || '').trim().toLowerCase()));
  }

  function getDayOffIds() {
    const dateStr = el('preferredDate')?.value;
    if (!dateStr || !Array.isArray(window.allTherapists)) return new Set();
    const [year, month, day] = dateStr.split('-').map(Number);
    const localDate = new Date(year, month - 1, day);
    const dayNames  = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const dayName   = dayNames[localDate.getDay()];
    const offs = new Set();
    (window.allTherapists || []).forEach(t => {
      const sched   = t.weeklySchedule || [];
      const entry   = sched.find(s => s.dayOfWeek === dayName);
      const working = entry ? entry.isWorking : true;
      if (!working) offs.add(String(t._id).toLowerCase());
    });
    return offs;
  }

  function hasDateTime() {
    return !!(el('preferredDate')?.value && el('preferredTime')?.value);
  }

  /* ─────────────────────────────────────────────────────────────
     MAIN RENDER
  ───────────────────────────────────────────────────────────────*/
  function onContextChange() {
    renderDropdowns();
    syncGlobal();
    runValidation();
  }

  function renderDropdowns() {
    const container = el('therapistSlotsContainer');
    if (!container) return;

    const therapists = window.allTherapists;
    if (!Array.isArray(therapists) || therapists.length === 0) {
      container.innerHTML = `
        <div class="therapist-loading">
          <i class="fa-solid fa-spinner fa-spin" style="margin-right:8px;"></i>Loading therapists…
        </div>`;
      return;
    }

    const mode       = getMode();
    const guestG     = getGuestGender(); // 'male'|'female'|''
    const availIds   = getAvailableIds();
    const dayOffIds  = getDayOffIds();
    const dtOk       = hasDateTime();

    // Split therapists by gender
    const females = therapists.filter(t => (t.gender || '').toLowerCase() === 'female');
    const males   = therapists.filter(t => (t.gender || '').toLowerCase() === 'male');

    // Decide which columns to show
    let showFemale = true;
    let showMale   = true;

    if (mode === 'individual') {
      if (guestG === 'female') { showFemale = true;  showMale = false; }
      else if (guestG === 'male') { showFemale = false; showMale = true; }
      // if gender not selected yet: show both
    }

    // Clear hidden selections
    if (!showFemale) femaleSelection = null;
    if (!showMale)   maleSelection   = null;

    // Build the UI
    container.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'therapist-gender-select-grid';

    if (showFemale) {
      grid.appendChild(buildGenderColumn(
        'female', females, availIds, dayOffIds, dtOk,
        femaleSelection, (sel) => { femaleSelection = sel; syncGlobal(); renderDropdowns(); runValidation(); }
      ));
    }

    if (showMale) {
      grid.appendChild(buildGenderColumn(
        'male', males, availIds, dayOffIds, dtOk,
        maleSelection, (sel) => { maleSelection = sel; syncGlobal(); renderDropdowns(); runValidation(); }
      ));
    }

    container.appendChild(grid);
    updateSectionLabel(mode);
  }

  /* ─────────────────────────────────────────────────────────────
     BUILD ONE GENDER COLUMN
  ───────────────────────────────────────────────────────────────*/
  function buildGenderColumn(gender, therapists, availIds, dayOffIds, dtOk, currentSel, onSelect) {
    const col = document.createElement('div');
    col.className = `therapist-gender-col therapist-gender-col--${gender}`;

    // Header
    const header = document.createElement('div');
    header.className = `therapist-gender-header therapist-gender-header--${gender}`;
    header.innerHTML = gender === 'female'
      ? `<i class="fa-solid fa-venus"></i> Female Therapist`
      : `<i class="fa-solid fa-mars"></i> Male Therapist`;
    col.appendChild(header);

    // Classify
    const available   = [];
    const unavailable = [];
    therapists.forEach(t => {
      const id     = String(t._id).toLowerCase();
      const isOff  = dayOffIds.has(id);
      const isBook = availIds !== null && !availIds.has(id) && !isOff;
      if (dtOk && (isOff || isBook)) {
        unavailable.push({ t, reason: isOff ? 'Day Off' : 'Already Booked' });
      } else {
        available.push({ t });
      }
    });

    // Select
    const sel = document.createElement('select');
    sel.className = `spa-select therapist-gender-select`;
    sel.id = `${gender}TherapistSelect`;
    sel.appendChild(mkOpt('', 'No preference (Any Available)', false));

    if (available.length > 0) {
      const grp = document.createElement('optgroup');
      grp.label = dtOk ? '✓ Available' : 'All Therapists';
      available.forEach(({ t }) => grp.appendChild(mkOpt(String(t._id), t.name, false)));
      sel.appendChild(grp);
    }

    if (dtOk && unavailable.length > 0) {
      const grp = document.createElement('optgroup');
      grp.label = '✗ Unavailable';
      unavailable.forEach(({ t, reason }) => grp.appendChild(mkOpt(String(t._id), `${t.name}  –  ${reason}`, true)));
      sel.appendChild(grp);
    }

    if (therapists.length === 0) {
      sel.appendChild(mkOpt('_none', `No ${gender} therapists registered`, true));
    }

    // Restore prior selection if still valid
    if (currentSel) {
      const match = Array.from(sel.options).find(o => o.value === currentSel.id && !o.disabled);
      if (match) sel.value = currentSel.id;
      else onSelect(null);
    }

    sel.addEventListener('change', () => {
      const val = sel.value;
      if (!val || val === '_none') {
        onSelect(null);
      } else {
        const found = (window.allTherapists || []).find(t => String(t._id) === val);
        onSelect(found ? { id: String(found._id), name: found.name, gender: found.gender } : null);
      }
    });

    col.appendChild(sel);

    // Availability hint
    const hint = document.createElement('div');
    hint.className = 'therapist-avail-hint';
    if (therapists.length === 0) {
      hint.innerHTML = `<i class="fa-solid fa-circle-xmark" style="color:#dc3545;margin-right:4px;"></i>No ${gender} therapists registered.`;
      hint.style.color = '#b91c1c';
    } else if (dtOk && available.length === 0) {
      hint.innerHTML = `<i class="fa-solid fa-circle-xmark" style="color:#dc3545;margin-right:4px;"></i>No ${gender} therapists available at this time.`;
      hint.style.color = '#b91c1c';
    } else if (dtOk) {
      hint.innerHTML = `<i class="fa-solid fa-circle-check" style="color:#2d8a4e;margin-right:4px;"></i>${available.length} ${gender} therapist${available.length > 1 ? 's' : ''} available`;
      hint.style.color = '#2d8a4e';
    } else {
      hint.innerHTML = `<i class="fa-solid fa-clock" style="color:#8b6f47;margin-right:4px;"></i>${therapists.length} ${gender} therapist${therapists.length > 1 ? 's' : ''} — select date & time to check availability`;
      hint.style.color = '#8b6f47';
    }
    col.appendChild(hint);

    return col;
  }

  /* ─────────────────────────────────────────────────────────────
     SECTION LABEL
  ───────────────────────────────────────────────────────────────*/
  function updateSectionLabel(mode) {
    const labelEl = el('therapistSectionLabel');
    if (!labelEl) return;
    labelEl.innerHTML = `
      <span class="field-label" style="margin-bottom:0;">
        Preferred Therapist
        <span style="font-weight:400;font-size:0.78rem;opacity:0.7;text-transform:none;letter-spacing:0;">(Optional)</span>
      </span>`;
  }

  /* ─────────────────────────────────────────────────────────────
     VALIDATION
  ───────────────────────────────────────────────────────────────*/
  function validateTherapists(showErrors) {
    const statusEl = el('therapistStatusMsg');
    const setStatus = (html, type) => {
      if (!statusEl) return;
      statusEl.style.display = html ? '' : 'none';
      statusEl.className = `therapist-status-msg therapist-status-msg--${type}`;
      statusEl.innerHTML = html;
    };

    const availIds  = getAvailableIds();
    const dayOffIds = getDayOffIds();
    const dtOk      = hasDateTime();
    const errors    = [];

    [
      { sel: femaleSelection, label: 'Female' },
      { sel: maleSelection,   label: 'Male'   }
    ].forEach(({ sel, label }) => {
      if (!sel) return;
      const id = sel.id.toLowerCase();
      if (dtOk && availIds !== null) {
        if (dayOffIds.has(id)) {
          errors.push(`<strong>${sel.name}</strong> (${label} Therapist) is on their day off. Please select another.`);
        } else if (!availIds.has(id)) {
          errors.push(`<strong>${sel.name}</strong> (${label} Therapist) is already booked at this time. Please select another.`);
        }
      }
    });

    if (errors.length > 0) {
      setStatus(`<ul style="margin:0;padding-left:18px;">${errors.map(e => `<li>${e}</li>`).join('')}</ul>`, 'error');
      return false;
    }

    setStatus('', '');
    return true;
  }

  function runValidation() {
    validateTherapists(false);
    applyTherapistGateToBtn();
  }

  function applyTherapistGateToBtn() {
    const btnReview = el('btnReview');
    if (!btnReview) return;
    const basicOk = !!(
      el('preferredDate')?.value &&
      el('preferredTime')?.value &&
      (window.numClients || 1) >= 1 &&
      !window.dateFullyBooked
    );
    const therapistOk = validateTherapists(false);
    btnReview.disabled = !(basicOk && therapistOk);
  }

  /* ─────────────────────────────────────────────────────────────
     SYNC — update window.selectedTherapists
  ───────────────────────────────────────────────────────────────*/
  function syncGlobal() {
    const chosen = [femaleSelection, maleSelection].filter(Boolean);
    window.selectedTherapists = chosen.map(s => ({ name: s.name, id: s.id }));

    const summaryEl = el('summary-therapists');
    if (summaryEl) {
      summaryEl.textContent = chosen.length > 0
        ? chosen.map(s => s.name).join(', ')
        : 'Any Available Therapist';
    }
  }

  /* ─────────────────────────────────────────────────────────────
     UTILITY
  ───────────────────────────────────────────────────────────────*/
  function el(id) { return document.getElementById(id); }
  function on(id, evt, fn) { el(id)?.addEventListener(evt, fn); }

  function mkOpt(value, text, disabled) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    o.disabled = disabled;
    return o;
  }

  function wrapFn(name, fn) {
    const original = window[name];
    window[name] = function (...args) {
      fn(original ? original.bind(window) : null, ...args);
    };
  }

  /* ─────────────────────────────────────────────────────────────
     BOOTSTRAP — poll until allTherapists is loaded
  ───────────────────────────────────────────────────────────────*/
  document.addEventListener('DOMContentLoaded', () => {
    init();
    _pollTimer = setInterval(() => {
      if (Array.isArray(window.allTherapists) && window.allTherapists.length > 0) {
        clearInterval(_pollTimer);
        _pollTimer = null;
        onContextChange();
      }
    }, 250);
    setTimeout(() => { if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; } }, 30000);
  });

})();
