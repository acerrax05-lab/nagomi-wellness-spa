(function () {
  'use strict';

  let therapists = [];
  let availableIds = null;
  let unavailableReasons = new Map();
  let selectedIds = new Set();
  let initialized = false;

  const byId = id => document.getElementById(id);
  const normalize = value => String(value || '').trim().toLowerCase();
  const therapistGender = therapist => normalize(therapist.gender);
  const maxSelections = () => Math.max(1, Number(window.numClients || 1));

  function isCouple() {
    return window.selectedService?.category === 'Couples Packages';
  }

  function isIndividual() {
    return maxSelections() === 1 && !isCouple();
  }

  function visibleGenders() {
    if (!isIndividual()) return new Set(['female', 'male']);
    const guestGender = normalize(byId('guestGender')?.value);
    return new Set(guestGender ? [guestGender] : ['female', 'male']);
  }

  function isAvailable(therapist) {
    return availableIds === null || availableIds.has(normalize(therapist._id));
  }

  function trimSelection(visible) {
    const allowed = new Set(therapists
      .filter(t => visible.has(therapistGender(t)) && isAvailable(t))
      .map(t => normalize(t._id)));
    selectedIds = new Set([...selectedIds].filter(id => allowed.has(id)).slice(0, maxSelections()));
  }

  function syncSelection() {
    const selected = therapists
      .filter(t => selectedIds.has(normalize(t._id)))
      .map(t => ({ id: String(t._id), name: t.name }));
    window.setSelectedTherapists?.(selected);
  }

  function optionText(therapist) {
    if (isAvailable(therapist)) return `${therapist.name} — Available`;
    const reason = unavailableReasons.get(normalize(therapist._id));
    return `${therapist.name} — Unavailable — ${reason || 'Not available for this time'}`;
  }

  function renderGroup(gender) {
    const label = gender === 'female' ? 'Female' : 'Male';
    const symbol = gender === 'female' ? '♀' : '♂';
    const matching = therapists
      .filter(t => therapistGender(t) === gender)
      .sort((a, b) => Number(isAvailable(b)) - Number(isAvailable(a)) || a.name.localeCompare(b.name));
    const selectedCount = matching.filter(t => selectedIds.has(normalize(t._id))).length;
    const availableCount = matching.filter(isAvailable).length;
    const limitReached = selectedIds.size >= maxSelections();

    const card = document.createElement('div');
    card.className = `therapist-gender-card therapist-${gender}`;
    card.id = `${gender}TherapistGroup`;

    const dropdown = document.createElement('details');
    dropdown.className = 'therapist-checkbox-dropdown';
    const summary = document.createElement('summary');
    summary.className = 'therapist-dropdown-summary';
    summary.textContent = `${symbol} ${label} therapists — ${selectedCount} selected`;
    dropdown.append(summary);

    const panel = document.createElement('div');
    panel.className = 'therapist-checkbox-panel';
    if (!matching.length) {
      const empty = document.createElement('div');
      empty.className = 'therapist-checkbox-empty';
      empty.textContent = `No registered ${gender} therapists`;
      panel.append(empty);
    }

    matching.forEach(therapist => {
      const id = normalize(therapist._id);
      const available = isAvailable(therapist);
      const checked = selectedIds.has(id);
      const selectionLocked = available && !checked && limitReached;
      const row = document.createElement('label');
      row.className = `therapist-checkbox-option${available ? '' : ' unavailable'}${selectionLocked ? ' selection-locked' : ''}`;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = checked;
      checkbox.disabled = !available || selectionLocked;
      if (selectionLocked) {
        checkbox.setAttribute('aria-label', `${therapist.name} cannot be selected because the therapist limit has been reached`);
      }
      checkbox.value = String(therapist._id);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked && selectedIds.size < maxSelections()) selectedIds.add(id);
        else selectedIds.delete(id);
        syncSelection();
        refresh(gender);
      });
      const text = document.createElement('span');
      text.textContent = optionText(therapist);
      row.append(checkbox, text);
      panel.append(row);
    });
    dropdown.append(panel);

    const status = document.createElement('div');
    status.className = `therapist-status${availableCount === 0 ? ' unavailable' : ''}${limitReached ? ' selection-complete' : ''}`;
    status.textContent = limitReached
      ? `Selection locked — ${selectedIds.size} of ${maxSelections()} therapists selected`
      : `${availableCount} of ${matching.length} available · Choose ${maxSelections() - selectedIds.size} more`;
    card.append(dropdown, status);
    return card;
  }

  function refresh(openGender) {
    if (!initialized) return;
    const visible = visibleGenders();
    trimSelection(visible);
    const grid = byId('therapistGenderGrid');
    if (grid) {
      grid.replaceChildren();
      ['female', 'male'].forEach(gender => {
        if (!visible.has(gender)) return;
        const group = renderGroup(gender);
        if (gender === openGender) group.querySelector('details').open = true;
        grid.append(group);
      });
    }

    const availableCount = therapists.filter(t => visible.has(therapistGender(t)) && isAvailable(t)).length;
    const overlay = byId('noAvailOverlay');
    if (overlay) {
      const hasSchedule = Boolean(byId('preferredDate')?.value && byId('preferredTime')?.value);
      const availabilityChecked = Array.isArray(window.lastAvailableList);
      overlay.style.display = hasSchedule && availabilityChecked && availableCount < maxSelections() ? 'flex' : 'none';
    }
    syncSelection();
  }

  function setTherapists(list) {
    therapists = Array.isArray(list) ? list : [];
    window.allTherapists = therapists;
    const loading = byId('therapistLoading');
    const grid = byId('therapistGenderGrid');
    if (loading) loading.hidden = true;
    if (grid) grid.hidden = false;
    refresh();
  }

  function setAvailability(list, unavailable = []) {
    availableIds = Array.isArray(list) ? new Set(list.map(t => normalize(t.id || t._id))) : null;
    unavailableReasons = new Map(
      (Array.isArray(unavailable) ? unavailable : []).map(t => [normalize(t.id || t._id), t.reason])
    );
    window.lastAvailableList = list;
    refresh();
  }

  function setError() {
    const loading = byId('therapistLoading');
    if (loading) loading.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Therapists could not be loaded. You can still choose any available therapist.';
  }

  function init() {
    initialized = true;
    byId('guestGender')?.addEventListener('change', refresh);
    if (Array.isArray(window.allTherapists) && window.allTherapists.length) setTherapists(window.allTherapists);
    else refresh();
  }

  window.TherapistSelection = { init, refresh, setTherapists, setAvailability, setError };
  document.addEventListener('DOMContentLoaded', init);
})();
