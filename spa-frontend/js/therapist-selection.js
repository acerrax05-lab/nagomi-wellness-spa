(function () {
  'use strict';

  let therapists = [];
  let availableIds = null;
  let initialized = false;

  const byId = id => document.getElementById(id);
  const normalize = value => String(value || '').trim().toLowerCase();
  const therapistGender = therapist => normalize(therapist.gender);

  function isCouple() {
    return window.selectedService?.category === 'Couples Packages';
  }

  function isIndividual() {
    return Number(window.numClients || 1) === 1 && !isCouple();
  }

  function visibleGenders() {
    if (!isIndividual()) return new Set(['female', 'male']);
    const guestGender = normalize(byId('guestGender')?.value);
    return new Set(guestGender ? [guestGender] : ['female', 'male']);
  }

  function isAvailable(therapist) {
    return availableIds === null || availableIds.has(normalize(therapist._id));
  }

  function renderSelect(gender) {
    const select = byId(`${gender}TherapistSelect`);
    const status = byId(`${gender}TherapistStatus`);
    if (!select || !status) return;

    const previous = select.value;
    const label = gender === 'female' ? 'female' : 'male';
    select.replaceChildren(new Option(`Any available ${label} therapist`, ''));

    const matching = therapists.filter(t => therapistGender(t) === gender);
    matching.forEach(therapist => {
      const available = isAvailable(therapist);
      const option = new Option(`${therapist.name} — ${available ? 'Available' : 'Unavailable'}`, therapist._id);
      option.disabled = !available;
      option.dataset.name = therapist.name;
      select.add(option);
    });

    if ([...select.options].some(option => option.value === previous && !option.disabled)) {
      select.value = previous;
    }

    const availableCount = matching.filter(isAvailable).length;
    status.textContent = matching.length
      ? `${availableCount} of ${matching.length} available`
      : `No registered ${label} therapists`;
    status.classList.toggle('unavailable', availableCount === 0);
  }

  function syncSelection() {
    const selected = ['female', 'male'].flatMap(gender => {
      const select = byId(`${gender}TherapistSelect`);
      const option = select?.selectedOptions?.[0];
      return option?.value ? [{ id: option.value, name: option.dataset.name || option.textContent.split(' — ')[0] }] : [];
    });
    window.setSelectedTherapists?.(selected);
  }

  function refresh() {
    if (!initialized) return;
    const visible = visibleGenders();
    ['female', 'male'].forEach(gender => {
      const group = byId(`${gender}TherapistGroup`);
      const select = byId(`${gender}TherapistSelect`);
      const show = visible.has(gender);
      if (group) group.hidden = !show;
      if (!show && select) select.value = '';
      renderSelect(gender);
    });

    const availableCount = therapists.filter(t => visible.has(therapistGender(t)) && isAvailable(t)).length;
    const overlay = byId('noAvailOverlay');
    if (overlay) {
      const hasSchedule = Boolean(byId('preferredDate')?.value && byId('preferredTime')?.value);
      const availabilityChecked = Array.isArray(window.lastAvailableList);
      overlay.style.display = hasSchedule && availabilityChecked && availableCount < Number(window.numClients || 1) ? 'flex' : 'none';
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

  function setAvailability(list) {
    availableIds = Array.isArray(list)
      ? new Set(list.map(t => normalize(t.id || t._id)))
      : null;
    window.lastAvailableList = list;
    refresh();
  }

  function setError() {
    const loading = byId('therapistLoading');
    if (loading) loading.innerHTML = '<i class="fa-solid fa-circle-exclamation"></i> Therapists could not be loaded. You can still choose any available therapist.';
  }

  function init() {
    initialized = true;
    ['femaleTherapistSelect', 'maleTherapistSelect', 'guestGender'].forEach(id => {
      byId(id)?.addEventListener('change', id === 'guestGender' ? refresh : syncSelection);
    });
    if (Array.isArray(window.allTherapists) && window.allTherapists.length) setTherapists(window.allTherapists);
    else refresh();
  }

  window.TherapistSelection = { init, refresh, setTherapists, setAvailability, setError };
  document.addEventListener('DOMContentLoaded', init);
})();
