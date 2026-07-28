(function () {
  'use strict';

  const API_BASE = 'https://nagomi-backend.onrender.com/api';

  const CARD_CATEGORY_MAP = {
    'The Nagomi Massage':    'Massage Services',
    'The Nagomi Packages':   'Packages',
    'Dual Delight Packages': 'Couples Packages',
  };

  const FALLBACK_SERVICE_STATS = [
    { category: 'Massage Services', bookingCount: 1571, isMostBooked: true,  isTrending: false, averageRating: null, reviewCount: 0 },
    { category: 'Couples Packages', bookingCount: 559,  isMostBooked: false, isTrending: true,  averageRating: null, reviewCount: 0 },
    { category: 'Packages',         bookingCount: 472,  isMostBooked: false, isTrending: false, averageRating: null, reviewCount: 0 },
  ];

  const FALLBACK_HOMEPAGE_STATS = {
    totalBookings:   4159,
    totalClients:    3800,
    yearsExperience: 15,
    averageRating:   4.9,
  };

  const GOOD_FOR = {
    'Massage Services': [
      { icon: 'fa-heart-pulse',       text: 'Stress & Tension Relief' },
      { icon: 'fa-bed',               text: 'Better Sleep'            },
      { icon: 'fa-person-rays',       text: 'Muscle Recovery'         },
    ],
    'Packages': [
      { icon: 'fa-spa',               text: 'Full-Body Rejuvenation'  },
      { icon: 'fa-droplet',           text: 'Deep Detox'              },
      { icon: 'fa-sun',               text: 'Glowing Skin'            },
    ],
    'Couples Packages': [
      { icon: 'fa-heart',             text: 'Couples Bonding'         },
      { icon: 'fa-champagne-glasses', text: 'Special Occasions'       },
      { icon: 'fa-door-closed',       text: 'Private Suite'           },
    ],
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 1 — Synchronous: patch data-target BEFORE enhanced-features.js
  // ═══════════════════════════════════════════════════════════════════════════
  patchDataTargets(FALLBACK_HOMEPAGE_STATS);

  // ═══════════════════════════════════════════════════════════════════════════
  // STEP 2 — DOMContentLoaded
  // ═══════════════════════════════════════════════════════════════════════════
  document.addEventListener('DOMContentLoaded', () => {
    applyServiceStats(FALLBACK_SERVICE_STATS);
    fetchLiveServiceStats();
    fetchLiveHomepageStats();
    fetchLiveReviews();
    injectReviewsModal();
    hookReadAllReviewsButton();
  });

  // ── Counter patch ──────────────────────────────────────────────────────────
  function patchDataTargets(stats) {
    const MAP = [
      { kw: 'client',  val: stats.totalClients,    dec: false },
      { kw: 'treat',   val: stats.totalBookings,   dec: false },
      { kw: 'year',    val: stats.yearsExperience, dec: false },
      { kw: 'rating',  val: stats.averageRating,   dec: true  },
    ];
    document.querySelectorAll('.stat-item').forEach(item => {
      const label = (item.querySelector('p')?.textContent || '').toLowerCase();
      const numEl  = item.querySelector('.stat-number');
      if (!numEl) return;
      const m = MAP.find(x => label.includes(x.kw));
      if (m && m.val != null) numEl.setAttribute('data-target', m.val);
    });
  }

  async function fetchLiveHomepageStats() {
    try {
      const res = await fetch(`${API_BASE}/bookings/homepage-stats`);
      if (!res.ok) return;
      const stats = await res.json();
      patchDataTargets(stats);
      reanimateVisible(stats);
    } catch (_) {}
  }

  // Poll for real-time updates every 15 seconds
  setInterval(fetchLiveHomepageStats, 15000);

  function reanimateVisible(stats) {
    const MAP = [
      { kw: 'client',  val: stats.totalClients,    dec: false },
      { kw: 'treat',   val: stats.totalBookings,   dec: false },
      { kw: 'year',    val: stats.yearsExperience, dec: false },
      { kw: 'rating',  val: stats.averageRating,   dec: true  },
    ];
    document.querySelectorAll('.stat-item').forEach(item => {
      const label = (item.querySelector('p')?.textContent || '').toLowerCase();
      const numEl  = item.querySelector('.stat-number');
      if (!numEl) return;
      const m = MAP.find(x => label.includes(x.kw));
      if (!m || m.val == null) return;
      const rect = numEl.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        numEl.textContent = m.dec ? '0.0' : '0';
        countUp(numEl, 0, m.val, 2000, m.dec);
      }
    });
  }

  function countUp(el, from, to, ms, dec) {
    if (el._ct) clearInterval(el._ct);
    const inc = (to - from) / (ms / 16);
    let cur = from;
    el._ct = setInterval(() => {
      cur += inc;
      if (cur >= to) { cur = to; clearInterval(el._ct); }
      el.textContent = dec ? cur.toFixed(1) : Math.floor(cur).toLocaleString();
    }, 16);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SERVICE STATS
  // ═══════════════════════════════════════════════════════════════════════════
  async function fetchLiveServiceStats() {
    try {
      const res = await fetch(`${API_BASE}/bookings/service-stats`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data) && data.length) applyServiceStats(data);
    } catch (_) {}
  }

  function applyServiceStats(stats) {
    const byCat = {};
    stats.forEach(s => { byCat[s.category] = s; });

    document.querySelectorAll('.service-card').forEach(card => {
      const heading  = card.querySelector('h3.card-title')?.textContent.trim();
      const category = CARD_CATEGORY_MAP[heading];
      if (!category) return;

      const stat        = byCat[category] || {};
      const serviceInfo = card.querySelector('.service-info');
      const imageWrapper = card.querySelector('.image-wrapper');
      if (!serviceInfo) return;

      // ── Badges ────────────────────────────────────────────────────────────
      if (imageWrapper) {
        // Clear existing static badges
        imageWrapper.querySelectorAll('.badge').forEach(b => b.remove());
        
        if (stat.isMostBooked) {
          imageWrapper.insertAdjacentHTML('beforeend',
            `<span class="badge most-booked">Most Booked</span>`);
        } else if (stat.isTrending) {
          imageWrapper.insertAdjacentHTML('beforeend',
            `<span class="badge trending">Trending</span>`);
        }
      }

      // ── Star row & Booking count ───────────────────────────────────────────
      const ratingInfo = card.querySelector('.rating-info');
      if (ratingInfo && (stat.averageRating || stat.bookingCount > 0)) {
        ratingInfo.style.display = 'flex';
        
        if (stat.averageRating && stat.reviewCount > 0) {
          const full  = Math.floor(stat.averageRating);
          const half  = (stat.averageRating - full) >= 0.3 && (stat.averageRating - full) < 0.8;
          const empty = 5 - full - (half ? 1 : 0);
          
          let starsHtml = '';
          for (let i = 0; i < full;  i++) starsHtml += '<i class="fas fa-star"></i>';
          if (half)                       starsHtml += '<i class="fas fa-star-half-alt"></i>';
          for (let i = 0; i < empty; i++) starsHtml += '<i class="far fa-star"></i>';
          
          const starsContainer = ratingInfo.querySelector('.stars');
          if (starsContainer) starsContainer.innerHTML = starsHtml;
        }

        const ratingText = ratingInfo.querySelector('.rating-text');
        if (ratingText) {
          let textParts = [];
          if (stat.averageRating && stat.reviewCount > 0) {
            textParts.push(`${stat.averageRating.toFixed(1)} &bull; ${stat.reviewCount} review${stat.reviewCount !== 1 ? 's' : ''}`);
          }
          if (stat.bookingCount > 0) {
            textParts.push(`${stat.bookingCount.toLocaleString()} bookings`);
          }
          ratingText.innerHTML = textParts.join(' &bull; ');
        }
      } else if (ratingInfo) {
        ratingInfo.style.display = 'none';
      }

      // ── "Good for" benefit tags ────────────────────────────────────────────
      const benefits = GOOD_FOR[category];
      if (benefits) {
        let bEl = serviceInfo.querySelector('.service-benefits');
        if (!bEl) {
          bEl = document.createElement('div');
          bEl.className = 'service-benefits';
          const desc = serviceInfo.querySelector('.service-description');
          if (desc) desc.insertAdjacentElement('afterend', bEl);
          else serviceInfo.appendChild(bEl);
        }
        bEl.innerHTML = benefits
          .map(b => `<span class="benefit-tag"><i class="fas ${b.icon}"></i> ${b.text}</span>`)
          .join('');
      }
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REVIEWS — homepage preview (6 cards)
  // ═══════════════════════════════════════════════════════════════════════════
  async function fetchLiveReviews() {
    try {
      const [rRes, sRes] = await Promise.all([
        fetch(`${API_BASE}/reviews/public?limit=6`),
        fetch(`${API_BASE}/reviews/stats`),
      ]);
      if (rRes.ok) {
        const data    = await rRes.json();
        const reviews = Array.isArray(data) ? data : (data.reviews || []);
        if (reviews.length) renderReviews(reviews);
      }
      if (sRes.ok) updateReviewSummary(await sRes.json());
    } catch (_) {}
  }

  function renderReviews(reviews) {
    const c = document.querySelector('.reviews-section .reviews-container, #reviews .reviews-container');
    if (!c) return;
    c.innerHTML = reviews.map(r => reviewCardHTML(r)).join('');
  }

  function reviewCardHTML(r) {
    const name    = r.guestName || r.user?.name || 'Guest';
    const service = r.service?.name || 'Spa Service';
    const rating  = r.rating || 5;
    const date    = r.createdAt
      ? new Date(r.createdAt).toLocaleDateString('en-PH', { month: 'long', year: 'numeric' })
      : '';
    return `
      <div class="review-card">
        <div class="review-header">
          <div class="reviewer-avatar">${esc(name[0].toUpperCase())}</div>
          <div class="reviewer-info">
            <h4 class="reviewer-name">${esc(name)}</h4>
            <p class="reviewer-service">${esc(service)}</p>
          </div>
          <div class="review-rating-stars">
            ${[1,2,3,4,5].map(i =>
              `<i class="fas fa-star" style="color:${i<=rating?'#f4a435':'#ddd'}"></i>`
            ).join('')}
          </div>
        </div>
        <p class="review-comment">"${esc(r.comment || '')}"</p>
        ${date ? `<span class="review-date">${date}</span>` : ''}
      </div>`;
  }

  function updateReviewSummary(stats) {
    if (!stats) return;
    const avgEl = document.querySelector('.summary-item h3');
    if (avgEl && stats.averageRating) avgEl.textContent = stats.averageRating.toFixed(1);
    const totEl = document.querySelector('.summary-item p');
    if (totEl && stats.approved)
      totEl.textContent = `Based on ${stats.approved.toLocaleString()} reviews`;
    if (stats.ratingBreakdown && stats.approved > 0) {
      document.querySelectorAll('.rating-row').forEach((row, i) => {
        const stars = [5, 4, 3, 2, 1][i];
        const pct   = Math.round(((stats.ratingBreakdown[stars] || 0) / stats.approved) * 100);
        const fill  = row.querySelector('.rating-fill');
        const lbl   = row.querySelectorAll('span')[1];
        if (fill) fill.style.width = `${pct}%`;
        if (lbl)  lbl.textContent  = `${pct}%`;
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // REVIEWS MODAL — "Read All Reviews"
  // ═══════════════════════════════════════════════════════════════════════════
  let _modalStats      = null;
  let _modalRating     = 0;     // 0 = All
  let _modalPage       = 1;
  let _modalLoading    = false;
  let _modalTotalPages = 1;

  function injectReviewsModal() {
    if (document.getElementById('allReviewsModal')) return;
    const modal = document.createElement('div');
    modal.id        = 'allReviewsModal';
    modal.className = 'arm-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
      <div class="arm-panel">

        <div class="arm-header">
          <div>
            <h2 class="arm-title">Guest Reviews</h2>
            <p class="arm-subtitle" id="armSubtitle">Loading…</p>
          </div>
          <button class="arm-close" id="armClose" aria-label="Close">
            <i class="fas fa-times"></i>
          </button>
        </div>

        <div class="arm-summary-row">
          <div class="arm-avg-block">
            <span class="arm-avg-number" id="armAvgNumber">–</span>
            <div class="arm-avg-stars" id="armAvgStars"></div>
            <span class="arm-avg-label" id="armAvgLabel"></span>
          </div>
          <div class="arm-breakdown" id="armBreakdown"></div>
        </div>

        <div class="arm-tabs" id="armTabs">
          <button class="arm-tab active" data-rating="0">All</button>
          <button class="arm-tab" data-rating="5">5 </button>
          <button class="arm-tab" data-rating="4">4 </button>
          <button class="arm-tab" data-rating="3">3 </button>
          <button class="arm-tab" data-rating="2">2 </button>
          <button class="arm-tab" data-rating="1">1 </button>
        </div>

        <div class="arm-body">
          <div class="arm-grid"    id="armGrid"></div>
          <p   class="arm-empty"  id="armEmpty"    style="display:none">No reviews for this rating yet.</p>
          <div class="arm-spinner" id="armSpinner" style="display:none">
            <i class="fas fa-circle-notch fa-spin"></i>
          </div>
          <div class="arm-load-wrap" id="armLoadWrap" style="display:none">
            <button class="arm-load-btn" id="armLoadMore">Load More</button>
          </div>
        </div>

      </div>`;
    document.body.appendChild(modal);

    // Close
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
    document.getElementById('armClose').addEventListener('click', closeModal);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modal.classList.contains('arm-visible')) closeModal();
    });

    // Tabs
    modal.querySelectorAll('.arm-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.arm-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _modalRating = parseInt(btn.dataset.rating) || 0;
        _modalPage   = 1;
        document.getElementById('armGrid').innerHTML = '';
        loadModalReviews(true);
      });
    });

    // Load more
    document.getElementById('armLoadMore').addEventListener('click', () => {
      _modalPage++;
      loadModalReviews(false);
    });
  }

  function hookReadAllReviewsButton() {
    const btn = [...document.querySelectorAll('a, button')]
      .find(el => /read all|view all|all reviews/i.test(el.textContent.trim()));
    if (btn) {
      btn.addEventListener('click', e => {
        e.preventDefault();
        openModal();
      });
    }
  }

  async function openModal() {
    const modal = document.getElementById('allReviewsModal');
    if (!modal) return;
    modal.classList.add('arm-visible');
    document.body.style.overflow = 'hidden';

    if (!_modalStats) await loadModalStats();
    if (_modalPage === 1 && document.getElementById('armGrid').innerHTML === '') {
      loadModalReviews(true);
    }
  }

  function closeModal() {
    const modal = document.getElementById('allReviewsModal');
    if (!modal) return;
    modal.classList.remove('arm-visible');
    document.body.style.overflow = '';
  }

  async function loadModalStats() {
    try {
      const res = await fetch(`${API_BASE}/reviews/stats`);
      if (!res.ok) return;
      _modalStats = await res.json();
      renderModalSummary(_modalStats);
      renderTabCounts(_modalStats);
    } catch (_) {}
  }

  function renderModalSummary(stats) {
    const avg   = stats.averageRating || 0;
    const total = stats.approved      || 0;
    const bd    = stats.ratingBreakdown || {};

    document.getElementById('armAvgNumber').textContent =
      avg > 0 ? avg.toFixed(1) : '–';
    document.getElementById('armAvgLabel').textContent =
      `${total.toLocaleString()} verified review${total !== 1 ? 's' : ''}`;
    document.getElementById('armSubtitle').textContent =
      `${total.toLocaleString()} verified review${total !== 1 ? 's' : ''}`;

    // Big stars
    const starsEl = document.getElementById('armAvgStars');
    const full = Math.round(avg);
    starsEl.innerHTML = [1,2,3,4,5].map(i =>
      `<i class="${i <= full ? 'fas' : 'far'} fa-star"></i>`
    ).join('');

    // Breakdown bars
    const bdEl = document.getElementById('armBreakdown');
    bdEl.innerHTML = [5,4,3,2,1].map(star => {
      const count = bd[star] || 0;
      const pct   = total > 0 ? Math.round((count / total) * 100) : 0;
      return `
        <div class="arm-bd-row">
          <span class="arm-bd-label">${star} <i class="fas fa-star"></i></span>
          <div class="arm-bd-bar">
            <div class="arm-bd-fill" style="width:${pct}%"></div>
          </div>
          <span class="arm-bd-count">${count.toLocaleString()}</span>
        </div>`;
    }).join('');
  }

  function renderTabCounts(stats) {
    const bd    = stats.ratingBreakdown || {};
    const total = stats.approved || 0;
    document.querySelectorAll('#armTabs .arm-tab').forEach(btn => {
      const r = parseInt(btn.dataset.rating) || 0;
      const n = r === 0 ? total : (bd[r] || 0);
      let badge = btn.querySelector('.arm-tab-count');
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'arm-tab-count';
        btn.appendChild(badge);
      }
      badge.textContent = `(${n.toLocaleString()})`;
    });
  }

  async function loadModalReviews(reset) {
    if (_modalLoading) return;
    _modalLoading = true;

    const grid     = document.getElementById('armGrid');
    const spinner  = document.getElementById('armSpinner');
    const loadWrap = document.getElementById('armLoadWrap');
    const empty    = document.getElementById('armEmpty');

    spinner.style.display  = 'flex';
    loadWrap.style.display = 'none';
    empty.style.display    = 'none';

    try {
      const params = new URLSearchParams({ page: _modalPage, limit: 12 });
      if (_modalRating > 0) params.set('rating', _modalRating);

      const res = await fetch(`${API_BASE}/reviews/public?${params}`);
      if (!res.ok) throw new Error('API error');

      const data    = await res.json();
      const reviews = Array.isArray(data) ? data : (data.reviews || []);
      _modalTotalPages = data.pages ?? (reviews.length < 12 ? _modalPage : _modalPage + 1);

      if (reset) grid.innerHTML = '';

      if (reviews.length === 0 && _modalPage === 1) {
        empty.style.display = 'block';
      } else {
        reviews.forEach((r, idx) => {
          const wrapper = document.createElement('div');
          wrapper.innerHTML = reviewCardHTML(r);
          const card = wrapper.firstElementChild;
          card.style.cssText += `opacity:0;transform:translateY(16px);transition:opacity .3s ${idx*40}ms,transform .3s ${idx*40}ms`;
          grid.appendChild(card);
          requestAnimationFrame(() => {
            card.style.opacity   = '1';
            card.style.transform = 'translateY(0)';
          });
        });
      }

      loadWrap.style.display = _modalPage < _modalTotalPages ? 'flex' : 'none';
    } catch (err) {
      console.error('loadModalReviews:', err);
    }

    spinner.style.display = 'none';
    _modalLoading = false;
  }

  // ─────────────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s)
      .replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Expose for Socket.IO real-time trigger in index.html
  window.fetchLiveHomepageStats = fetchLiveHomepageStats;

})();