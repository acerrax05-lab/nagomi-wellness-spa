(function() {
  'use strict';
  
  //  FIXED: API base URL
  const REVIEWS_API  = 'https://nagomi-backend.onrender.com/api';
  
  let selectedRating = 0;

  // ============================================
  // INITIALIZE ON PAGE LOAD
  // ============================================
  document.addEventListener('DOMContentLoaded', async () => {
    console.log('🌸 Initializing guest reviews system...');
    
    // Load existing reviews
    await loadGuestReviews();
    
    console.log(' Guest review system ready');
  });

  // ============================================
  // LOAD AND DISPLAY REVIEWS
  // ============================================
  async function loadGuestReviews() {
    try {
      console.log(' Fetching reviews from:', `${REVIEWS_API}/reviews/public`);
      
      const response = await fetch(`${REVIEWS_API}/reviews/public?limit=6`);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
const reviews = Array.isArray(data) ? data : (data.reviews || []);
console.log(` Loaded ${reviews.length} reviews`);

if (!reviews || reviews.length === 0) {
  showNoReviewsPlaceholder();
  return;
}

displayReviews(reviews);
      await loadReviewStatistics();
      
    } catch (err) {
      console.error(' Error loading reviews:', err);
      showNoReviewsPlaceholder();
    }
  }

  // ============================================
  // DISPLAY REVIEWS
  // ============================================
  function displayReviews(reviews) {
    const container = document.querySelector('.reviews-container');
    if (!container) {
      console.error(' .reviews-container not found in HTML');
      return;
    }
    
    container.innerHTML = '';
    
    reviews.forEach((review, index) => {
      const card = createReviewCard(review, index);
      container.appendChild(card);
    });
    
    // Animate cards in
    setTimeout(() => {
      document.querySelectorAll('.review-card').forEach((card, i) => {
        setTimeout(() => {
          card.style.opacity = '1';
          card.style.transform = 'translateY(0)';
        }, i * 100);
      });
    }, 100);
  }

  // ============================================
  // CREATE REVIEW CARD
  // ============================================
  function createReviewCard(review) {
    const card = document.createElement('div');
    card.className = 'review-card';
    card.style.opacity = '0';
    card.style.transform = 'translateY(30px)';
    card.style.transition = 'all 0.5s ease';
    
    const initial = (review.guestName || review.user?.name || 'Guest').charAt(0).toUpperCase();
const userName = review.guestName || review.user?.name || 'Guest';
    const serviceName = review.service?.name || 'Spa Service';
    const timeAgo = getTimeAgo(review.createdAt);
    const starsHTML = createStarsHTML(review.rating);
    
    card.innerHTML = `
      <div class="review-header">
        <div class="reviewer-avatar">${initial}</div>
        <div class="reviewer-info">
          <h4>${userName}</h4>
          <div class="review-rating">${starsHTML}</div>
        </div>
      </div>
      <p class="review-text">${review.comment}</p>
      <div class="review-meta">
        <span><i class="fas fa-spa"></i> ${serviceName}</span>
        <span><i class="fas fa-clock"></i> ${timeAgo}</span>
      </div>
    `;
    
    return card;
  }

  // ============================================
  // CREATE STARS HTML
  // ============================================
  function createStarsHTML(rating) {
    let html = '';
    for (let i = 1; i <= 5; i++) {
      html += i <= rating ? '<i class="fas fa-star"></i>' : '<i class="far fa-star"></i>';
    }
    return html;
  }

  // ============================================
  // LOAD STATISTICS
  // ============================================
  async function loadReviewStatistics() {
    try {
      const response = await fetch(`${REVIEWS_API}/reviews/stats`);
      if (!response.ok) return;
      
      const stats = await response.json();
      console.log(' Review stats:', stats);
      
      if (stats.approved === 0) {
        const summary = document.querySelector('.review-summary');
        if (summary) summary.style.display = 'none';
        return;
      }
      
      const summary = document.querySelector('.review-summary');
      if (summary) summary.style.display = 'grid';
      
      updateAverageRating(stats.averageRating);
      updateTotalReviews(stats.approved);
      updateRatingBreakdown(stats);
      
    } catch (err) {
      console.error('Error loading stats:', err);
    }
  }

  // ============================================
  // UPDATE UI ELEMENTS
  // ============================================
  function updateAverageRating(rating) {
    const el = document.querySelector('.summary-item h3');
    if (el) animateNumber(el, 0, rating, 1000);
  }

  function updateTotalReviews(count) {
    const el = document.querySelector('.summary-item p');
    if (el) el.textContent = `Based on ${count} review${count !== 1 ? 's' : ''}`;
  }

  function updateRatingBreakdown(stats) {
    const total = stats.approved;
    if (total === 0) return;
    
    document.querySelectorAll('.rating-row').forEach((row, index) => {
      const stars = 5 - index;
      const count = stats.ratingBreakdown[stars] || 0;
      const percentage = Math.round((count / total) * 100);
      
      const fillBar = row.querySelector('.rating-fill');
      const percentText = row.querySelector('span:last-child');
      
      if (fillBar) {
        setTimeout(() => {
          fillBar.style.width = `${percentage}%`;
        }, index * 100);
      }
      
      if (percentText) percentText.textContent = `${percentage}%`;
    });
  }

  // ============================================
  // SHOW NO REVIEWS PLACEHOLDER
  // ============================================
  function showNoReviewsPlaceholder() {
    const container = document.querySelector('.reviews-container');
    if (!container) return;
    
    container.innerHTML = `
      <div class="no-reviews-placeholder" style="grid-column: 1 / -1;">
        <div class="placeholder-icon"></div>
        <h3>No Reviews Yet</h3>
        <p>Be the first to share your spa experience!</p>
      </div>
    `;
    
    const summary = document.querySelector('.review-summary');
    if (summary) summary.style.display = 'none';
  }

  // ============================================
  // INITIALIZE REVIEW MODAL
  // ============================================
  function initializeReviewModal() {
    if (document.getElementById('reviewModal')) return;
    
    const modal = document.createElement('div');
    modal.id = 'reviewModal';
    modal.className = 'review-modal';
    
    modal.innerHTML = `
      <div class="review-modal-overlay" onclick="window.closeReviewModal()"></div>
      <div class="review-modal-content">
        <button class="review-modal-close" onclick="window.closeReviewModal()">
          <i class="fas fa-times"></i>
        </button>
        
        <div class="review-modal-header">
          <div class="modal-icon">️</div>
          <h2>Share Your Experience</h2>
          <p>Help others by sharing your spa experience</p>
        </div>
        
        <form id="guestReviewForm" onsubmit="window.submitGuestReview(event)">
          <!-- Name -->
          <div class="review-form-group">
            <label for="reviewerName">
              Your Name <span class="required">*</span>
            </label>
            <input 
              type="text" 
              id="reviewerName" 
              required 
              placeholder="Enter your name"
              maxlength="50"
            >
          </div>
          
          <!-- Email (Optional) -->
          <div class="review-form-group">
            <label for="reviewerEmail">Email (optional)</label>
            <input 
              type="email" 
              id="reviewerEmail" 
              placeholder="your@email.com"
            >
            <small class="form-hint">We'll never share your email publicly</small>
          </div>
          
          <!-- Service -->
          <div class="review-form-group">
            <label for="reviewService">
              Service You Tried <span class="required">*</span>
            </label>
            <select id="reviewService" required>
              <option value="">-- Select Service --</option>
            </select>
          </div>
          
          <!-- Rating -->
          <div class="review-form-group">
            <label>
              Your Rating <span class="required">*</span>
            </label>
            <div class="star-rating-input" id="starRatingInput">
              <i class="far fa-star" onclick="window.setRating(1)"></i>
              <i class="far fa-star" onclick="window.setRating(2)"></i>
              <i class="far fa-star" onclick="window.setRating(3)"></i>
              <i class="far fa-star" onclick="window.setRating(4)"></i>
              <i class="far fa-star" onclick="window.setRating(5)"></i>
            </div>
            <input type="hidden" id="ratingValue" required>
          </div>
          
          <!-- Review Text -->
          <div class="review-form-group">
            <label for="reviewText">
              Your Review <span class="required">*</span>
            </label>
            <textarea 
              id="reviewText" 
              required 
              rows="5" 
              placeholder="Tell us about your experience... (minimum 20 characters)"
              minlength="20"
              maxlength="500"
            ></textarea>
            <small class="form-hint" id="charCount">0/500 characters</small>
          </div>
          
          <!-- Actions -->
          <div class="review-modal-actions">
            <button type="button" class="review-btn-secondary" onclick="window.closeReviewModal()">
              Cancel
            </button>
            <button type="submit" class="review-btn-primary">
              <i class="fas fa-paper-plane"></i> Submit Review
            </button>
          </div>
        </form>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Load services
    loadServicesForReview();
    
    // Character counter
    const textarea = document.getElementById('reviewText');
    if (textarea) {
      textarea.addEventListener('input', (e) => {
        const count = e.target.value.length;
        document.getElementById('charCount').textContent = `${count}/500 characters`;
      });
    }
  }

  // ============================================
  // LOAD SERVICES FOR DROPDOWN
  // ============================================
  async function loadServicesForReview() {
    try {
      const response = await fetch(`${REVIEWS_API}/services`);
      if (!response.ok) return;
      
      const services = await response.json();
      const select = document.getElementById('reviewService');
      
      if (select) {
        services.forEach(service => {
          const option = document.createElement('option');
          option.value = service._id;
          option.textContent = service.name;
          select.appendChild(option);
        });
      }
    } catch (err) {
      console.error('Error loading services:', err);
    }
  }

  // ============================================
  // GLOBAL FUNCTIONS
  // ============================================
  
  window.openReviewModal = function() {
    const modal = document.getElementById('reviewModal');
    if (modal) {
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
  };

  window.closeReviewModal = function() {
    const modal = document.getElementById('reviewModal');
    if (modal) {
      modal.classList.remove('active');
      document.body.style.overflow = '';
      const form = document.getElementById('guestReviewForm');
      if (form) form.reset();
      resetStarRating();
    }
  };

  window.setRating = function(rating) {
    selectedRating = rating;
    document.getElementById('ratingValue').value = rating;
    
    const stars = document.querySelectorAll('#starRatingInput i');
    stars.forEach((star, index) => {
      if (index < rating) {
        star.classList.remove('far');
        star.classList.add('fas');
        star.style.color = '#ffd700';
      } else {
        star.classList.remove('fas');
        star.classList.add('far');
        star.style.color = '#ddd';
      }
    });
  };

  function resetStarRating() {
    selectedRating = 0;
    const stars = document.querySelectorAll('#starRatingInput i');
    stars.forEach(star => {
      star.classList.remove('fas');
      star.classList.add('far');
      star.style.color = '#ddd';
    });
  }

  window.submitGuestReview = async function(event) {
    event.preventDefault();
    
    const submitBtn = event.target.querySelector('button[type="submit"]');
    const originalText = submitBtn.innerHTML;
    
    try {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Submitting...';
      
      const reviewData = {
        user: { name: document.getElementById('reviewerName').value.trim() },
        email: document.getElementById('reviewerEmail').value.trim() || undefined,
        service: document.getElementById('reviewService').value,
        rating: parseInt(document.getElementById('ratingValue').value),
        comment: document.getElementById('reviewText').value.trim()
      };
      
      console.log(' Submitting review:', reviewData);
      
      const response = await fetch(`${REVIEWS_API}/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reviewData)
      });
      
      const result = await response.json();
      
      if (!response.ok) {
        throw new Error(result.msg || 'Failed to submit review');
      }
      
      console.log(' Review submitted successfully:', result);
      
      showSuccessMessage();
      
      setTimeout(() => {
        window.closeReviewModal();
        loadGuestReviews();
      }, 2000);
      
    } catch (err) {
      console.error(' Error submitting review:', err);
      alert(`Error: ${err.message}`);
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
    }
  };

  function showSuccessMessage() {
    const form = document.getElementById('guestReviewForm');
    form.innerHTML = `
      <div class="review-success">
        <div class="success-icon"></div>
        <h3>Thank You!</h3>
        <p>Your review has been submitted and will appear after admin approval.</p>
      </div>
    `;
  }

  // ============================================
  // HELPER FUNCTIONS
  // ============================================
  
  function getTimeAgo(date) {
    if (!date) return 'Recently';
    
    const now = new Date();
    const reviewDate = new Date(date);
    const diff = now - reviewDate;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);
    
    if (months > 0) return `${months} month${months > 1 ? 's' : ''} ago`;
    if (weeks > 0) return `${weeks} week${weeks > 1 ? 's' : ''} ago`;
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    return 'Just now';
  }

  function animateNumber(element, start, end, duration) {
    const range = end - start;
    const increment = range / (duration / 16);
    let current = start;
    
    const timer = setInterval(() => {
      current += increment;
      if (current >= end) {
        current = end;
        clearInterval(timer);
      }
      element.textContent = current.toFixed(1);
    }, 16);
  }


})();