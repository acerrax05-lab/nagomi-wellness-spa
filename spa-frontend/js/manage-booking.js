// js/manage-booking.js — with approval workflow
const API_URL ='https://nagomi-backend.onrender.com/api';

let currentBookings = [];
let selectedBooking = null;
let lookupMethod = 'phone'; // 'phone' or 'id'

// ─── TAB SWITCHING ────────────────────────────────────────────────────────────

function switchTab(method) {
  const phoneForm = document.getElementById('phoneForm');
  const idForm    = document.getElementById('idForm');
  const tabs      = document.querySelectorAll('.tab-btn');

  tabs.forEach(tab => tab.classList.remove('active'));
  lookupMethod = method;

  if (method === 'phone') {
    phoneForm.style.display = 'block';
    idForm.style.display    = 'none';
    tabs[0].classList.add('active');
  } else {
    phoneForm.style.display = 'none';
    idForm.style.display    = 'block';
    tabs[1].classList.add('active');
  }
}
window.switchTab = switchTab;

// ─── IDENTITY PROOF ───────────────────────────────────────────────────────────

let storedIdentity = {}; // stores identity proof used during lookup

function getIdentityProof() {
  return storedIdentity;
}

// ─── DATE RESTRICTIONS ────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  const newDateInput = document.getElementById('newDate');
  if (newDateInput) {
    const today = new Date();
    newDateInput.setAttribute('min',
      `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`
    );
  }
});

// ─── LOOKUP ───────────────────────────────────────────────────────────────────

async function lookupByTransactionId() {
  const transactionId = document.getElementById('lookupTransactionId').value.trim().toUpperCase();
  if (!transactionId) { showNotification(' Please enter a transaction number', 'error'); return; }

  try {
    const response = await fetch(`${API_URL}/bookings/lookup-by-id/${transactionId}`);
    const data = await response.json();
    if (!response.ok) { showNotification(` ${data.msg}`, 'error'); return; }

    // Store identity proof for reschedule/cancel calls
    storedIdentity = { transactionNumber: transactionId };

    currentBookings = [data];
    displayBookings([data]);
  } catch (error) {
    showNotification(' Error looking up booking', 'error');
  }
}
window.lookupByTransactionId = lookupByTransactionId;

async function lookupBookings() {
  const rawPhone = document.getElementById('lookupPhone').value.trim();
  const phone    = rawPhone.replace(/[\s\-\(\)]/g, '');
  const name     = document.getElementById('lookupName').value.trim();

  if (!rawPhone) { showNotification(' Please enter your phone number', 'error'); return; }

  try {
    const response = await fetch(`${API_URL}/bookings/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, name }) // name is optional now
    });
    const data = await response.json();
    if (!response.ok) { showNotification(` ${data.msg}`, 'error'); return; }

    // Store identity proof for reschedule/cancel calls
    storedIdentity = { phone };

    currentBookings = data;
    displayBookings(data);
  } catch (error) {
    showNotification(' Error looking up bookings', 'error');
  }
}

// ─── DISPLAY BOOKINGS ─────────────────────────────────────────────────────────

function displayBookings(bookings) {
  const bookingsList     = document.getElementById('bookingsList');
  const bookingsContainer = document.getElementById('bookingsContainer');

  if (bookings.length === 0) {
    bookingsContainer.innerHTML = `
      <div class="no-bookings">
        <p style="font-size:1.2rem;margin-bottom:10px;"></p>
        <p>No bookings found.</p>
        <p style="font-size:0.9rem;color:#999;margin-top:10px;">
          Make sure your phone number and name match exactly as entered when booking.
        </p>
      </div>`;
    bookingsList.style.display = 'block';
    return;
  }

  // Status groups
  const pending      = bookings.filter(b => ['pending','confirmed'].includes(b.status));
  const pendingReqs  = bookings.filter(b => ['pending_cancellation','pending_reschedule'].includes(b.status));
  const past         = bookings.filter(b => ['completed','cancelled'].includes(b.status));

  let html = '';

  if (pendingReqs.length > 0) {
    html += `
      <div style="background:#fff3e0;border-left:4px solid #ff9800;padding:15px 20px;border-radius:8px;margin-bottom:20px;">
        <h4 style="color:#e65100;margin:0 0 5px 0;">⏳ Pending Admin Review (${pendingReqs.length})</h4>
        <p style="margin:0;color:#666;font-size:0.9rem;">
          The following requests are awaiting admin approval. You'll see the updated status once reviewed.
        </p>
      </div>`;
    html += pendingReqs.map(b => renderBookingCard(b, false)).join('');
  }

  if (pending.length > 0) {
    html += `<h3 style="color:#4b2e1e;margin-bottom:15px;">Upcoming Appointments</h3>`;
    html += pending.map(b => renderBookingCard(b, true)).join('');
  }

  if (past.length > 0) {
    html += `
      <h3 style="color:#4b2e1e;margin:25px 0 15px;">
        Past Appointments
        <span style="font-size:0.85rem;font-weight:400;color:#999;">(${past.length} records)</span>
      </h3>`;
    html += past.map(b => renderBookingCard(b, false)).join('');
  }

  bookingsContainer.innerHTML = html;
  bookingsList.style.display  = 'block';
}

function renderBookingCard(booking, canModify) {
  const date    = new Date(booking.date);
  const dateStr = date.toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const therapistName = booking.therapist?.name || 'To be assigned';

  const statusMap = {
    completed:            { label: ' Completed',          color: '#28a745', bg: '#e8f5e9' },
    cancelled:            { label: ' Cancelled',           color: '#dc3545', bg: '#ffebee' },
    confirmed:            { label: ' Confirmed',            color: '#2196f3', bg: '#e3f2fd' },
    pending:              { label: '⏳ Pending',             color: '#ff9800', bg: '#fff3e0' },
    pending_cancellation: { label: ' Cancellation Pending', color: '#ff5722', bg: '#fbe9e7' },
    pending_reschedule:   { label: ' Reschedule Pending',   color: '#9c27b0', bg: '#f3e5f5' },
  };
  const s = statusMap[booking.status] || { label: booking.status, color: '#6c757d', bg: '#f5f5f5' };

  const cardOpacity = ['completed','cancelled'].includes(booking.status) ? 'opacity:0.8;' : '';

  return `
    <div class="booking-card" style="${cardOpacity}">
      <div class="booking-header">
        <div class="transaction-number">
          #${booking.transactionNumber || booking._id.substring(0,8).toUpperCase()}
        </div>
        <span class="status-badge" style="background:${s.bg};color:${s.color};border:1px solid ${s.color}40;
          padding:6px 14px;border-radius:20px;font-weight:600;font-size:0.85rem;">
          ${s.label}
        </span>
      </div>

      <div class="booking-details">
        <div class="detail-item"><span class="detail-label">Service</span><span class="detail-value">${booking.service.name}</span></div>
        <div class="detail-item"><span class="detail-label">Duration</span><span class="detail-value">${booking.durationMinutes} minutes</span></div>
        <div class="detail-item"><span class="detail-label">Date</span><span class="detail-value">${dateStr}</span></div>
        <div class="detail-item"><span class="detail-label">Time</span><span class="detail-value">${booking.time}</span></div>
        <div class="detail-item"><span class="detail-label">Therapist</span><span class="detail-value">${therapistName}</span></div>
        <div class="detail-item"><span class="detail-label">Total Amount</span><span class="detail-value">₱${booking.price.toLocaleString()}</span></div>
      </div>

      ${booking.notes ? `
        <div style="margin-bottom:15px;padding:12px;background:white;border-radius:8px;">
          <span class="detail-label">Notes:</span>
          <p style="margin-top:5px;color:#666;">${booking.notes}</p>
        </div>` : ''}

      ${booking.cancellationReason && booking.status === 'pending_cancellation' ? `
        <div style="margin-bottom:15px;padding:12px;background:#fbe9e7;border-radius:8px;border-left:3px solid #ff5722;">
          <span class="detail-label" style="color:#bf360c;">Your Cancellation Reason:</span>
          <p style="margin-top:5px;color:#bf360c;">${booking.cancellationReason}</p>
          <p style="margin-top:5px;color:#999;font-size:0.85rem;">⏳ Waiting for admin review</p>
        </div>` : ''}

      ${booking.status === 'pending_reschedule' ? `
        <div style="margin-bottom:15px;padding:12px;background:#f3e5f5;border-radius:8px;border-left:3px solid #9c27b0;">
          <span class="detail-label" style="color:#6a1b9a;">Reschedule Request:</span>
          <p style="margin-top:5px;color:#6a1b9a;">
            Requested date: <strong>${new Date(booking.pendingRescheduleDate).toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'})}</strong>
            at <strong>${booking.pendingRescheduleTime}</strong>
          </p>
          ${booking.rescheduleReason ? `<p style="color:#6a1b9a;font-size:0.9rem;">Reason: ${booking.rescheduleReason}</p>` : ''}
          <p style="margin-top:5px;color:#999;font-size:0.85rem;">⏳ Waiting for admin review</p>
        </div>` : ''}

      ${booking.adminRejectionNote ? `
        <div style="margin-bottom:15px;padding:12px;background:#ffebee;border-radius:8px;border-left:3px solid #f44336;">
          <span class="detail-label" style="color:#b71c1c;">Admin Note:</span>
          <p style="margin-top:5px;color:#b71c1c;">${booking.adminRejectionNote}</p>
        </div>` : ''}

      ${booking.cancellationReason && booking.status === 'cancelled' ? `
        <div style="margin-bottom:15px;padding:12px;background:#fff3cd;border-radius:8px;border-left:3px solid #ffc107;">
          <span class="detail-label">Cancellation Reason:</span>
          <p style="margin-top:5px;color:#856404;">${booking.cancellationReason}</p>
        </div>` : ''}

      ${canModify ? `
        <div class="booking-actions">
          ${!booking.rescheduledFrom?.date ? `
            <button class="btn-action btn-reschedule" onclick="openRescheduleModal('${booking._id}')">
               Reschedule
            </button>
          ` : `
            <div style="padding:10px;background:#f3e5f5;border-radius:8px;text-align:center;color:#6a1b9a;font-size:0.88rem;border:1px solid #ce93d8;">
               Reschedule limit reached — only 1 reschedule is allowed per booking
            </div>
          `}
          <button class="btn-action btn-cancel" onclick="openCancelModal('${booking._id}')">
             Request Cancellation
          </button>
        </div>` : `
        <div style="padding:10px;background:#f8f9fa;border-radius:8px;text-align:center;color:#999;font-size:0.9rem;">
          ${ booking.status === 'completed'            ? ' This appointment has been completed'
           : booking.status === 'cancelled'            ? ' This booking was cancelled'
           : booking.status === 'pending_cancellation' ? '⏳ Cancellation request is under review'
           : booking.status === 'pending_reschedule'   ? '⏳ Reschedule request is under review'
           : ''}
        </div>`}

      ${booking.status === 'completed' ? (() => {
        const hasReviewed = localStorage.getItem(`reviewed_${booking._id || booking.transactionNumber}`) === '1';
        return hasReviewed
          ? `<div style="margin-top:10px;padding:12px;background:#e8f5e9;border-radius:10px;text-align:center;color:#2e7d32;font-size:0.9rem;font-weight:600;">
                You've already submitted a review for this booking. Thank you!
             </div>`
          : `<div style="margin-top:10px;">
               <button onclick="openManageReviewModal('${(booking.service?.name || '').replace(/'/g,"\\'")}','${booking.transactionNumber || ''}','${(booking.guestName || '').replace(/'/g,"\\'")}','${booking._id || ''}')"
                 style="display:block;width:100%;text-align:center;padding:12px;
                   background:linear-gradient(135deg,#8b6f47,#4b2e1e);
                   color:#fff;border:none;border-radius:10px;font-weight:600;font-size:0.95rem;
                   cursor:pointer;transition:opacity 0.2s;"
                 onmouseover="this.style.opacity='0.85'" onmouseout="this.style.opacity='1'">
                 ️ Write a Review
               </button>
             </div>`;
      })() : booking.status !== 'cancelled' ? `
        <div style="margin-top:10px;">
          <button disabled style="display:block;width:100%;text-align:center;padding:12px;
            background:#e0e0e0;color:#aaa;border:none;border-radius:10px;
            font-weight:600;font-size:0.95rem;cursor:not-allowed;"
            title="Available once your appointment is completed">
            ️ Write a Review <span style="font-size:0.78rem;font-weight:400;">(after appointment)</span>
          </button>
        </div>` : ''}
    </div>`;
}

// ─── SILENT REFRESH (used after reschedule/cancel — avoids re-validating inputs) ──

async function refreshCurrentBookings() {
  try {
    if (lookupMethod === 'id') {
      const transactionId = document.getElementById('lookupTransactionId').value.trim().toUpperCase();
      if (!transactionId) return;
      const res = await fetch(`${API_URL}/bookings/lookup-by-id/${transactionId}`);
      const data = await res.json();
      if (!res.ok) return;
      currentBookings = [data];
      displayBookings([data]);
    } else {
      if (!storedIdentity.phone) return;
      const res = await fetch(`${API_URL}/bookings/lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(storedIdentity)
      });
      const data = await res.json();
      if (!res.ok) return;
      currentBookings = data;
      displayBookings(data);
    }
  } catch (e) {
    // silent fail — the success notification already showed
  }
}

// ─── RESCHEDULE MODAL ─────────────────────────────────────────────────────────

function openRescheduleModal(bookingId) {
  selectedBooking = currentBookings.find(b => b._id === bookingId);
  if (!selectedBooking) return;

  // Block if already rescheduled once
  if (selectedBooking.rescheduledFrom?.date) {
    showNotification(' You have already rescheduled this booking once. Only 1 reschedule is allowed.', 'error');
    return;
  }

  document.getElementById('rescheduleModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeRescheduleModal() {
  document.getElementById('rescheduleModal').style.display = 'none';
  document.body.style.overflow = 'auto';
  document.getElementById('newDate').value     = '';
  document.getElementById('newTime').value     = 'Select time...';
  document.getElementById('rescheduleReason').value = '';
  clearFieldError('rescheduleReasonError');
}

async function confirmReschedule() {
  const newDate = document.getElementById('newDate').value;
  const newTime = document.getElementById('newTime').value;
  const reason  = document.getElementById('rescheduleReason').value.trim();

  clearFieldError('rescheduleReasonError');

  if (!newDate || newTime === 'Select time...') {
    showNotification(' Please select both date and time', 'error');
    return;
  }
  if (reason.length < 10) {
    showFieldError('rescheduleReasonError', 'Please provide a reason (at least 10 characters).');
    return;
  }

  try {
    const response = await fetch(`${API_URL}/bookings/reschedule/${selectedBooking._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newDate, newTime, reason, ...getIdentityProof() })
    });
    const data = await response.json();
    if (!response.ok) { showNotification(` ${data.msg}`, 'error'); return; }

    showNotification(' Reschedule request submitted! Awaiting admin approval.', 'success');
    closeRescheduleModal();
    setTimeout(refreshCurrentBookings, 1000);
  } catch (error) {
    showNotification(' Error submitting reschedule request', 'error');
  }
}

// ─── CANCEL MODAL ─────────────────────────────────────────────────────────────

function openCancelModal(bookingId) {
  selectedBooking = currentBookings.find(b => b._id === bookingId);
  if (!selectedBooking) return;
  document.getElementById('cancelModal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeCancelModal() {
  document.getElementById('cancelModal').style.display = 'none';
  document.body.style.overflow = 'auto';
  document.getElementById('cancelReason').value = '';
  clearFieldError('cancelReasonError');
}

async function confirmCancel() {
  const reason = document.getElementById('cancelReason').value.trim();
  clearFieldError('cancelReasonError');

  if (reason.length < 10) {
    showFieldError('cancelReasonError', 'Please provide a reason (at least 10 characters).');
    return;
  }

  if (!confirm('Submit cancellation request? An admin will review your request before it is finalized.')) return;

  try {
    const response = await fetch(`${API_URL}/bookings/cancel/${selectedBooking._id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, ...getIdentityProof() })
    });
    const data = await response.json();
    if (!response.ok) { showNotification(` ${data.msg}`, 'error'); return; }

    showNotification(' Cancellation request submitted! Awaiting admin approval.', 'success');
    closeCancelModal();
    setTimeout(refreshCurrentBookings, 1000);
  } catch (error) {
    showNotification(' Error submitting cancellation request', 'error');
  }
}

// ─── FIELD ERROR HELPERS ─────────────────────────────────────────────────────

function showFieldError(elementId, message) {
  const el = document.getElementById(elementId);
  if (el) { el.textContent = message; el.style.display = 'block'; }
}

function clearFieldError(elementId) {
  const el = document.getElementById(elementId);
  if (el) { el.textContent = ''; el.style.display = 'none'; }
}

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────

function showNotification(message, type = 'info') {
  document.querySelectorAll('.notification').forEach(n => n.remove());
  const notification = document.createElement('div');
  notification.className = 'notification';
  notification.style.cssText = `
    position:fixed;top:20px;right:20px;
    background:${type==='success'?'#28a745':type==='error'?'#dc3545':'#007bff'};
    color:white;padding:16px 24px;border-radius:8px;
    box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:10001;
    animation:slideIn 0.3s;max-width:400px;`;
  notification.textContent = message;
  document.body.appendChild(notification);
  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s';
    setTimeout(() => notification.remove(), 300);
  }, 5000);
}

// ─── ANIMATIONS ───────────────────────────────────────────────────────────────

const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn { from{transform:translateX(400px);opacity:0} to{transform:translateX(0);opacity:1} }
  @keyframes slideOut{ from{transform:translateX(0);opacity:1} to{transform:translateX(400px);opacity:0} }
  .field-error { color:#dc3545; font-size:0.85rem; margin-top:6px; display:none; }
  .reason-required-note { font-size:0.82rem; color:#888; margin-top:4px; font-style:italic; }
`;
document.head.appendChild(style);
// ═══════════════════════════════════════════════════════════════════════
// REVIEW MODAL — self-contained, opens directly on manage-booking page
// ═══════════════════════════════════════════════════════════════════════

const REVIEW_API = 'https://nagomi-backend.onrender.com/api';
let _reviewSelectedRating = 0;

function openManageReviewModal(serviceName, txn, guestName, bookingId) {
  // Build modal if not yet in DOM
  if (!document.getElementById('manageReviewModal')) {
    _buildReviewModal();
  }
  const modal = document.getElementById('manageReviewModal');
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';

  // Store bookingId for one-time review enforcement
  modal.dataset.bookingId = bookingId || txn || '';

  // Autofill + lock the name field from the booking data
  const nameInput = document.getElementById('mgReviewerName');
  if (nameInput && guestName) {
    nameInput.value    = guestName;
    nameInput.readOnly = true;
    nameInput.style.background = '#f5f1eb';
    nameInput.style.cursor     = 'not-allowed';
    nameInput.title            = 'Name auto-filled from your booking';
  }

  // Pre-fill service if provided
  if (serviceName) {
    const trySelect = (tries) => {
      if (tries > 12) return;
      const select = document.getElementById('mgReviewService');
      if (!select || select.options.length <= 1) {
        setTimeout(() => trySelect(tries + 1), 300);
        return;
      }
      const target = serviceName.toLowerCase();
      for (const opt of select.options) {
        const optName = (opt.dataset.name || opt.textContent).toLowerCase();
        if (optName.includes(target) || target.includes(optName)) {
          select.value = opt.value;
          break;
        }
      }
    };
    setTimeout(() => trySelect(0), 300);
  }
}

function closeManageReviewModal() {
  const modal = document.getElementById('manageReviewModal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
    document.getElementById('mgReviewForm')?.reset();
    _setReviewRating(0);
    // Restore name field to editable state
    const nameInput = document.getElementById('mgReviewerName');
    if (nameInput) {
      nameInput.readOnly = false;
      nameInput.style.background = '';
      nameInput.style.cursor     = '';
    }
    modal.dataset.bookingId = '';
  }
}

function _setReviewRating(rating) {
  _reviewSelectedRating = rating;
  const stars = document.querySelectorAll('#mgStarRow i');
  stars.forEach((s, i) => {
    s.className = i < rating ? 'fas fa-star' : 'far fa-star';
    s.style.color = i < rating ? '#f4a435' : '#ccc';
  });
  const hidden = document.getElementById('mgRatingValue');
  if (hidden) hidden.value = rating || '';
}

async function _loadServicesForMgReview() {
  const select = document.getElementById('mgReviewService');
  if (!select) return;
  try {
    const res  = await fetch(`${REVIEW_API}/services`);
    const list = await res.json();
    list.forEach(s => {
      const opt = document.createElement('option');
      opt.value       = s._id;        // ← must be ObjectId, not name
      opt.textContent = s.name;
      opt.dataset.name = s.name.toLowerCase();
      select.appendChild(opt);
    });
  } catch(e) { console.warn('Could not load services for review'); }
}

async function submitManageReview(e) {
  e.preventDefault();
  const name    = document.getElementById('mgReviewerName')?.value.trim();
  const service = document.getElementById('mgReviewService')?.value;
  const rating  = _reviewSelectedRating;
  const text    = document.getElementById('mgReviewText')?.value.trim();

  if (!name || !service || !rating || !text || text.length < 20) {
    alert('Please fill in all fields, select a rating, and write at least 20 characters.');
    return;
  }

  const btn = document.querySelector('#mgReviewForm .mg-review-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'Submitting…'; }

  try {
    const email = document.getElementById('mgReviewerEmail')?.value.trim() || '';
    // Get the selected option's display name for fallback
    const serviceEl  = document.getElementById('mgReviewService');
    const serviceId  = serviceEl?.value || '';
    const serviceTxt = serviceEl?.options[serviceEl.selectedIndex]?.textContent || '';
    const res = await fetch(`${REVIEW_API}/reviews`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // cover both field-name conventions the backend may use
        guestName:   name,
        user:        { name },
        guestEmail:  email,
        email,
        service:     serviceId,      // ObjectId string
        serviceName: serviceTxt,     // plain name as fallback
        rating,
        comment:     text,
        reviewText:  text,
        source:      'manage-booking'
      })
    });
    if (!res.ok) {
      let errMsg = 'Failed to submit review.';
      try { const errData = await res.json(); errMsg = errData.msg || errData.message || errMsg; } catch(e2) {}
      throw new Error(errMsg);
    }
    // ── Mark this booking as reviewed (one-time only) ───────────────────────
    const modal = document.getElementById('manageReviewModal');
    const bookingKey = modal?.dataset?.bookingId;
    if (bookingKey) localStorage.setItem(`reviewed_${bookingKey}`, '1');

    closeManageReviewModal();
    showNotification('🌸 Thank you! Your review has been submitted.', 'success');
    // Refresh cards so the button changes to "already reviewed"
    setTimeout(() => refreshCurrentBookings(), 800);
  } catch(e) {
    if (btn) { btn.disabled = false; btn.textContent = ' Submit Review'; }
    // Use a styled inline error instead of alert
    const errDiv = document.getElementById('mgReviewError');
    if (errDiv) {
      errDiv.textContent = e.message || 'Failed to submit. Please try again.';
      errDiv.style.display = 'block';
      setTimeout(() => { if (errDiv) errDiv.style.display = 'none'; }, 5000);
    } else {
      showNotification(' ' + (e.message || 'Failed to submit review. Please try again.'), 'error');
    }
  }
}

function _buildReviewModal() {
  // Inject CSS
  const style = document.createElement('style');
  style.textContent = `
    #manageReviewModal {
      display:none; position:fixed; inset:0; z-index:10100;
      background:rgba(0,0,0,0.55); align-items:center; justify-content:center;
      padding:20px;
    }
    #manageReviewModal.active { display:flex; }
    .mg-review-panel {
      background:#fff; border-radius:18px; width:100%; max-width:480px;
      max-height:90vh; overflow-y:auto; padding:32px 28px;
      box-shadow:0 20px 60px rgba(0,0,0,0.3);
      font-family:'Poppins',sans-serif;
    }
    .mg-review-header { text-align:center; margin-bottom:24px; }
    .mg-review-header h2 {
      font-family:'Playfair Display',serif; color:#4b2e1e;
      font-size:1.5rem; margin-bottom:6px;
    }
    .mg-review-header p { color:#888; font-size:0.88rem; }
    .mg-review-close {
      position:absolute; top:16px; right:18px;
      background:none; border:none; font-size:1.4rem;
      cursor:pointer; color:#999; line-height:1;
    }
    .mg-review-close:hover { color:#4b2e1e; }
    .mg-form-group { margin-bottom:18px; }
    .mg-form-group label {
      display:block; font-weight:600; color:#4b2e1e;
      font-size:0.88rem; margin-bottom:6px;
    }
    .mg-form-group input,
    .mg-form-group select,
    .mg-form-group textarea {
      width:100%; padding:10px 13px;
      border:1.5px solid #ddd; border-radius:9px;
      font-size:0.92rem; font-family:'Poppins',sans-serif;
      color:#333; transition:border 0.2s;
      box-sizing:border-box;
    }
    .mg-form-group input:focus,
    .mg-form-group select:focus,
    .mg-form-group textarea:focus {
      outline:none; border-color:#8b6f47;
    }
    .mg-form-group textarea { resize:vertical; }
    .mg-star-row { display:flex; gap:8px; font-size:1.6rem; cursor:pointer; }
    .mg-star-row i { color:#ccc; transition:color 0.15s; }
    .mg-star-row i:hover,
    .mg-star-row i.fas { color:#f4a435; }
    .mg-review-actions {
      display:flex; gap:10px; margin-top:20px;
    }
    .mg-review-cancel {
      flex:1; padding:12px; border:1.5px solid #ddd;
      background:#fff; color:#666; border-radius:9px;
      font-weight:600; cursor:pointer; font-size:0.9rem;
      transition:background 0.2s;
    }
    .mg-review-cancel:hover { background:#f5f5f5; }
    .mg-review-submit {
      flex:2; padding:12px;
      background:linear-gradient(135deg,#8b6f47,#4b2e1e);
      color:#fff; border:none; border-radius:9px;
      font-weight:600; cursor:pointer; font-size:0.9rem;
      transition:opacity 0.2s;
    }
    .mg-review-submit:hover { opacity:0.88; }
    .mg-review-submit:disabled { opacity:0.5; cursor:not-allowed; }
  `;
  document.head.appendChild(style);

  // Build modal DOM
  const modal = document.createElement('div');
  modal.id = 'manageReviewModal';
  modal.innerHTML = `
    <div class="mg-review-panel" style="position:relative;">
      <button class="mg-review-close" onclick="closeManageReviewModal()"></button>
      <div class="mg-review-header">
        <div style="font-size:2rem;margin-bottom:8px;">️</div>
        <h2>Share Your Experience</h2>
        <p>Help others by sharing your spa experience</p>
      </div>
      <form id="mgReviewForm" onsubmit="submitManageReview(event)">
        <div class="mg-form-group">
          <label>Your Name <span style="color:#dc3545;">*</span></label>
          <input type="text" id="mgReviewerName" placeholder="Enter your name" maxlength="50" required>
        </div>
        <div class="mg-form-group">
          <label>Email <span style="font-weight:400;color:#999;">(optional)</span></label>
          <input type="email" id="mgReviewerEmail" placeholder="your@email.com">
        </div>
        <div class="mg-form-group">
          <label>Service You Tried <span style="color:#dc3545;">*</span></label>
          <select id="mgReviewService" required>
            <option value="">-- Select Service --</option>
          </select>
        </div>
        <div class="mg-form-group">
          <label>Your Rating <span style="color:#dc3545;">*</span></label>
          <div class="mg-star-row" id="mgStarRow">
            <i class="far fa-star" onclick="_setReviewRating(1)"></i>
            <i class="far fa-star" onclick="_setReviewRating(2)"></i>
            <i class="far fa-star" onclick="_setReviewRating(3)"></i>
            <i class="far fa-star" onclick="_setReviewRating(4)"></i>
            <i class="far fa-star" onclick="_setReviewRating(5)"></i>
          </div>
          <input type="hidden" id="mgRatingValue" required>
        </div>
        <div class="mg-form-group">
          <label>Your Review <span style="color:#dc3545;">*</span></label>
          <textarea id="mgReviewText" rows="4" minlength="20" maxlength="500"
            placeholder="Tell us about your experience… (minimum 20 characters)" required></textarea>
        </div>
        <div id="mgReviewError" style="display:none;color:#8b1a1a;background:#fdecea;border:1px solid #f5a5a5;border-radius:8px;padding:10px 14px;font-size:0.85rem;margin-bottom:10px;">Error submitting review.</div>
        <div class="mg-review-actions">
          <button type="button" class="mg-review-cancel" onclick="closeManageReviewModal()">Cancel</button>
          <button type="submit" class="mg-review-submit"> Submit Review</button>
        </div>
      </form>
    </div>
  `;
  document.body.appendChild(modal);

  // Load services into dropdown
  _loadServicesForMgReview();

  // Close on backdrop click
  modal.addEventListener('click', (e) => {
    if (e.target === modal) closeManageReviewModal();
  });
}

window.openManageReviewModal  = openManageReviewModal;
window.closeManageReviewModal = closeManageReviewModal;
window.submitManageReview     = submitManageReview;
window._setReviewRating       = _setReviewRating;