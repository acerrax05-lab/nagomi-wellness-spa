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
  if (!transactionId) { showNotification('❌ Please enter a transaction number', 'error'); return; }

  try {
    const response = await fetch(`${API_URL}/bookings/lookup-by-id/${transactionId}`);
    const data = await response.json();
    if (!response.ok) { showNotification(`❌ ${data.msg}`, 'error'); return; }

    // Store identity proof for reschedule/cancel calls
    storedIdentity = { transactionNumber: transactionId };

    currentBookings = [data];
    displayBookings([data]);
  } catch (error) {
    showNotification('❌ Error looking up booking', 'error');
  }
}
window.lookupByTransactionId = lookupByTransactionId;

async function lookupBookings() {
  const rawPhone = document.getElementById('lookupPhone').value.trim();
  const phone    = rawPhone.replace(/[\s\-\(\)]/g, '');
  const name     = document.getElementById('lookupName').value.trim();

  if (!rawPhone) { showNotification('❌ Please enter your phone number', 'error'); return; }

  try {
    const response = await fetch(`${API_URL}/bookings/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, name }) // name is optional now
    });
    const data = await response.json();
    if (!response.ok) { showNotification(`❌ ${data.msg}`, 'error'); return; }

    // Store identity proof for reschedule/cancel calls
    storedIdentity = { phone };

    currentBookings = data;
    displayBookings(data);
  } catch (error) {
    showNotification('❌ Error looking up bookings', 'error');
  }
}

// ─── DISPLAY BOOKINGS ─────────────────────────────────────────────────────────

function displayBookings(bookings) {
  const bookingsList     = document.getElementById('bookingsList');
  const bookingsContainer = document.getElementById('bookingsContainer');

  if (bookings.length === 0) {
    bookingsContainer.innerHTML = `
      <div class="no-bookings">
        <p style="font-size:1.2rem;margin-bottom:10px;">📅</p>
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
    completed:            { label: '✅ Completed',          color: '#28a745', bg: '#e8f5e9' },
    cancelled:            { label: '❌ Cancelled',           color: '#dc3545', bg: '#ffebee' },
    confirmed:            { label: '✓ Confirmed',            color: '#2196f3', bg: '#e3f2fd' },
    pending:              { label: '⏳ Pending',             color: '#ff9800', bg: '#fff3e0' },
    pending_cancellation: { label: '🕐 Cancellation Pending', color: '#ff5722', bg: '#fbe9e7' },
    pending_reschedule:   { label: '🕐 Reschedule Pending',   color: '#9c27b0', bg: '#f3e5f5' },
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
              📅 Reschedule
            </button>
          ` : `
            <div style="padding:10px;background:#f3e5f5;border-radius:8px;text-align:center;color:#6a1b9a;font-size:0.88rem;border:1px solid #ce93d8;">
              🔒 Reschedule limit reached — only 1 reschedule is allowed per booking
            </div>
          `}
          <button class="btn-action btn-cancel" onclick="openCancelModal('${booking._id}')">
            ❌ Request Cancellation
          </button>
        </div>` : `
        <div style="padding:10px;background:#f8f9fa;border-radius:8px;text-align:center;color:#999;font-size:0.9rem;">
          ${ booking.status === 'completed'            ? '✅ This appointment has been completed'
           : booking.status === 'cancelled'            ? '❌ This booking was cancelled'
           : booking.status === 'pending_cancellation' ? '⏳ Cancellation request is under review'
           : booking.status === 'pending_reschedule'   ? '⏳ Reschedule request is under review'
           : ''}
        </div>`}
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
    showNotification('❌ You have already rescheduled this booking once. Only 1 reschedule is allowed.', 'error');
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
    showNotification('❌ Please select both date and time', 'error');
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
    if (!response.ok) { showNotification(`❌ ${data.msg}`, 'error'); return; }

    showNotification('✅ Reschedule request submitted! Awaiting admin approval.', 'success');
    closeRescheduleModal();
    setTimeout(refreshCurrentBookings, 1000);
  } catch (error) {
    showNotification('❌ Error submitting reschedule request', 'error');
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
    if (!response.ok) { showNotification(`❌ ${data.msg}`, 'error'); return; }

    showNotification('✅ Cancellation request submitted! Awaiting admin approval.', 'success');
    closeCancelModal();
    setTimeout(refreshCurrentBookings, 1000);
  } catch (error) {
    showNotification('❌ Error submitting cancellation request', 'error');
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