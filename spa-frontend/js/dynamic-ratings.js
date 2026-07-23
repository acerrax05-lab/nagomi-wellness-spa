// ============================================
// DYNAMIC RATINGS DISPLAY
// Add to homepage-dynamic.js or create new file
// ============================================

// ============================================
// LOAD AND DISPLAY REVIEWS WITH RATINGS
// ============================================
async function loadDynamicReviewsAndRatings() {
  try {
    console.log(' Loading reviews and ratings...');
    
    const API_BASE = 'https://nagomi-backend.onrender.com/api';
    
    // Fetch reviews
    const response = await fetch(`${API_BASE}/reviews/public?limit=6`);
    const reviews = await response.json();
    
    console.log(` Loaded ${reviews.length} reviews`);
    
    // If no reviews, hide all rating displays
    if (reviews.length === 0) {
      hideAllRatings();
      showNoReviewsMessage();
      return;
    }
    
    // Display reviews
    displayReviews(reviews);
    
    // Load and display statistics
    await loadReviewStatistics();
    
  } catch (err) {
    console.error(' Error loading reviews:', err);
    hideAllRatings();
  }
}

// ============================================
// HIDE ALL RATINGS (NO REVIEWS YET)
// ============================================
function hideAllRatings() {
  console.log('ℹ️ No reviews yet - hiding rating displays');
  
  // Hide service card ratings
  document.querySelectorAll('.badge.rating').forEach(badge => {
    badge.style.display = 'none';
  });
  
  // Hide therapist ratings
  document.querySelectorAll('.therapist-rating').forEach(rating => {
    rating.style.display = 'none';
  });
  
  // Hide review summary section
  const reviewSummary = document.querySelector('.review-summary');
  if (reviewSummary) {
    reviewSummary.style.display = 'none';
  }
  
  // Update stats section
  const avgRatingDisplay = document.querySelector('.summary-item h3');
  if (avgRatingDisplay) {
    avgRatingDisplay.textContent = '—';
  }
  
  const totalReviewsDisplay = document.querySelector('.summary-item p');
  if (totalReviewsDisplay) {
    totalReviewsDisplay.textContent = 'No reviews yet';
  }
}

// ============================================
// SHOW NO REVIEWS MESSAGE
// ============================================
function showNoReviewsMessage() {
  const reviewsContainer = document.querySelector('.reviews-container');
  if (!reviewsContainer) return;
  
  reviewsContainer.innerHTML = `
    <div class="no-reviews-yet" style="
      text-align: center;
      padding: 60px 20px;
      background: white;
      border-radius: 12px;
      grid-column: 1 / -1;
    ">
      <div style="font-size: 4rem; margin-bottom: 20px; opacity: 0.3;">
        <i class="fa-solid fa-star-half-stroke"></i>
      </div>
      <h3 style="color: #4b2e1e; margin-bottom: 15px;">
        No Reviews Yet
      </h3>
      <p style="color: #666; margin-bottom: 25px; font-size: 1.1rem;">
        Be the first to share your spa experience!
      </p>
      <button class="btn-write-review" onclick="openReviewModal()" style="
        background: var(--primary-brown);
        color: white;
        padding: 15px 35px;
        border: none;
        border-radius: 8px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s;
      ">
        <i class="fas fa-pen"></i> Write First Review
      </button>
    </div>
  `;
}

// ============================================
// DISPLAY REVIEWS (WHEN THEY EXIST)
// ============================================
function displayReviews(reviews) {
  const reviewsContainer = document.querySelector('.reviews-container');
  if (!reviewsContainer) return;
  
  reviewsContainer.innerHTML = reviews.map(review => `
    <div class="review-card" data-aos="fade-up">
      <div class="review-header">
        <div class="reviewer-avatar">
          ${review.user.name.charAt(0).toUpperCase()}
        </div>
        <div class="reviewer-info">
          <h4>${review.user.name}</h4>
          <div class="review-rating">
            ${'<i class="fas fa-star"></i>'.repeat(review.rating)}
            ${'<i class="far fa-star"></i>'.repeat(5 - review.rating)}
          </div>
        </div>
      </div>
      <p class="review-text">${review.comment}</p>
      <div class="review-meta">
        <span><i class="fas fa-spa"></i> ${review.service.name}</span>
        <span><i class="fas fa-clock"></i> ${getTimeAgo(review.createdAt)}</span>
      </div>
    </div>
  `).join('');
}

// ============================================
// LOAD REVIEW STATISTICS
// ============================================
async function loadReviewStatistics() {
  try {
    const API_BASE = 'https://nagomi-backend.onrender.com/api';
    const response = await fetch(`${API_BASE}/reviews/admin/stats`);
    
    if (!response.ok) return;
    
    const stats = await response.json();
    
    // Only show if there are approved reviews
    if (stats.approved === 0) {
      hideAllRatings();
      return;
    }
    
    // Update average rating
    const avgRatingEl = document.querySelector('.summary-item h3');
    if (avgRatingEl) {
      avgRatingEl.textContent = stats.averageRating;
    }
    
    // Update total reviews
    const totalReviewsEl = document.querySelector('.summary-item p');
    if (totalReviewsEl) {
      totalReviewsEl.textContent = `Based on ${stats.approved} reviews`;
    }
    
    // Update rating breakdown
    const total = stats.approved;
    if (total > 0) {
      document.querySelectorAll('.rating-row').forEach((row, index) => {
        const stars = 5 - index;
        const count = stats.ratingBreakdown[stars] || 0;
        const percentage = Math.round((count / total) * 100);
        
        const fillBar = row.querySelector('.rating-fill');
        if (fillBar) {
          fillBar.style.width = `${percentage}%`;
        }
        
        const percentageText = row.querySelector('span:last-child');
        if (percentageText) {
          percentageText.textContent = `${percentage}%`;
        }
      });
    }
    
    // Show review summary section
    const reviewSummary = document.querySelector('.review-summary');
    if (reviewSummary) {
      reviewSummary.style.display = 'grid';
    }
    
  } catch (err) {
    console.error('Error loading review statistics:', err);
  }
}

// ============================================
// HELPER: TIME AGO
// ============================================
function getTimeAgo(date) {
  const now = new Date();
  const reviewDate = new Date(date);
  const diff = now - reviewDate;
  
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
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

// ============================================
// INITIALIZE ON PAGE LOAD
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  loadDynamicReviewsAndRatings();
  console.log(' Dynamic ratings system initialized');
});