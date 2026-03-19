(function() {
  'use strict';
  
  const API_BASE = "http://localhost:5000/api";
  // ── Backend host for resolving uploaded image paths ───────────────────────
  // Your frontend runs on a different port (e.g. 5501 via Live Server).
  // Uploaded images are stored on the backend (port 5000), so relative paths
  // like /img/services/... must be prefixed with the backend origin.
  const BACKEND_ORIGIN  = "http://localhost:5000/api";

  let allServices = [];
  let currentCategory = 'all';

  const DEFAULT_PLACEHOLDER = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"%3E%3Crect fill="%23f5f1eb" width="400" height="300"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" font-family="Playfair Display, serif" font-size="24" fill="%234b2e1e"%3ENagomi Wellness%3C/text%3E%3Ctext x="50%25" y="60%25" dominant-baseline="middle" text-anchor="middle" font-family="Poppins, sans-serif" font-size="14" fill="%238b4513"%3ESpa Service%3C/text%3E%3C/svg%3E';

  // ============================================
  // OPEN SERVICE CATALOG
  // ============================================
  window.openServiceCatalog = function(event) {
    if (event) event.preventDefault();
    
    const modal = document.getElementById('serviceCatalogModal');
    if (modal) {
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
      
      if (allServices.length === 0) {
        loadServices();
      }
      
      document.addEventListener('keydown', handleEscapeKey);
    }
  };

  // ============================================
  // CLOSE CATALOG
  // ============================================
  window.closeCatalog = function() {
    const modal = document.getElementById('serviceCatalogModal');
    if (modal) {
      modal.classList.remove('active');
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handleEscapeKey);
    }
  };

  function handleEscapeKey(e) {
    if (e.key === 'Escape') window.closeCatalog();
  }

  // ============================================
  // LOAD SERVICES
  // ============================================
  async function loadServices() {
    try {
      showLoadingState();
      
      const response = await fetch(`${API_BASE}/services`);
      if (!response.ok) throw new Error('Failed to load services');
      
      allServices = await response.json();
      console.log('✅ Loaded', allServices.length, 'services');
      
      buildCategories();
      displayServices(allServices);
      
    } catch (err) {
      console.error('❌ Error loading services:', err);
      showErrorState();
    }
  }

  function showLoadingState() {
    const grid = document.getElementById('servicesGrid');
    if (grid) {
      grid.innerHTML = `
        <div class="catalog-loading">
          <i class="fas fa-spinner fa-spin"></i>
          <p>Loading our premium services...</p>
        </div>
      `;
    }
  }

  function showErrorState() {
    const grid = document.getElementById('servicesGrid');
    if (grid) {
      grid.innerHTML = `
        <div class="no-services-shop">
          <i class="fas fa-exclamation-circle" style="font-size: 4rem; color: #dc3545; margin-bottom: 20px; display: block;"></i>
          <p style="color: #dc3545; font-weight: 600; font-size: 1.2rem;">Failed to load services</p>
          <p style="color: #666; margin-top: 10px;">Please check your connection and try again</p>
          <button onclick="location.reload()" style="margin-top: 20px; padding: 12px 30px; background: #8b4513; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: 600;">
            Refresh Page
          </button>
        </div>
      `;
    }
  }

  // ============================================
  // BUILD CATEGORIES
  // ============================================
  function buildCategories() {
    const categoryList = document.getElementById('categoryList');
    if (!categoryList) return;
    
    const categories = ['all', ...new Set(allServices.map(s => s.category).filter(Boolean))];
    
    categoryList.innerHTML = categories.map(cat => `
      <li>
        <button 
          class="category-btn ${cat === currentCategory ? 'active' : ''}" 
          onclick="window.filterByCategory('${cat}')"
          aria-label="Filter by ${cat === 'all' ? 'all services' : cat}"
        >
          ${cat === 'all' ? '🌟 All Services' : formatCategoryName(cat)}
        </button>
      </li>
    `).join('');
  }

  function formatCategoryName(category) {
    return category
      .split(/[-_\s]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  // ============================================
  // FILTER BY CATEGORY
  // ============================================
  window.filterByCategory = function(category) {
    currentCategory = category;
    
    document.querySelectorAll('.category-btn').forEach(btn => btn.classList.remove('active'));
    event.target.classList.add('active');
    
    const filtered = category === 'all' 
      ? allServices 
      : allServices.filter(s => s.category === category);
    
    const grid = document.getElementById('servicesGrid');
    if (grid) {
      grid.style.opacity = '0';
      grid.style.transition = 'opacity 0.2s ease';
      setTimeout(() => {
        displayServices(filtered);
        grid.style.opacity = '1';
      }, 200);
    }
  };

  // ============================================
  // DISPLAY SERVICES
  // ============================================
  function displayServices(services) {
    const grid = document.getElementById('servicesGrid');
    if (!grid) return;
    
    if (services.length === 0) {
      grid.innerHTML = `
        <div class="no-services-shop">
          <i class="fas fa-search" style="font-size: 4rem; color: #c9a882; margin-bottom: 20px; display: block;"></i>
          <p style="font-weight: 600; font-size: 1.2rem; color: #4b2e1e;">No services found</p>
          <p style="color: #666; margin-top: 10px;">Try adjusting your search or category filter</p>
        </div>
      `;
      return;
    }
    
    grid.innerHTML = services.map((service, index) => createServiceCard(service, index)).join('');
    
    const cards = grid.querySelectorAll('.service-card-shop');
    cards.forEach((card, index) => {
      card.style.opacity = '0';
      card.style.transform = 'translateY(20px)';
      setTimeout(() => {
        card.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
        card.style.opacity = '1';
        card.style.transform = 'translateY(0)';
      }, index * 50);
    });
  }

  // ============================================
  // GET SERVICE IMAGE
  // ============================================
  function getServiceImage(service) {
    // 1. DB image — uploaded via admin
    if (service.image && service.image.trim() !== '') {
      const img = service.image.trim();
      // If the path is relative (starts with /), it lives on the backend server.
      // Prefix with BACKEND_ORIGIN so the browser fetches from port 5000,
      // not from the Live Server port (5501) where the file doesn't exist.
      if (img.startsWith('/')) {
        return `${BACKEND_ORIGIN}${img}`;
      }
      // Already an absolute URL — use as-is
      return img;
    }
    
    // 2. Fallback to static homepage images for the 3 main services
    const imageMap = {
      'nagomi massage':       'img/service1.jpg',
      'the nagomi massage':   'img/service1.jpg',
      'massage':              'img/service1.jpg',
      'nagomi packages':      'img/service2.jpg',
      'the nagomi packages':  'img/service2.jpg',
      'packages':             'img/service2.jpg',
      'dual delight':         'img/service3.jpg',
      'dual delight packages':'img/service3.jpg',
      'couples':              'img/service3.jpg'
    };
    
    const serviceName = service.name.toLowerCase();
    for (const [key, imagePath] of Object.entries(imageMap)) {
      if (serviceName.includes(key)) return imagePath;
    }
    
    // 3. SVG placeholder
    return DEFAULT_PLACEHOLDER;
  }

  // ============================================
  // CREATE SERVICE CARD
  // ============================================
  function createServiceCard(service, index) {
    const pricing = service.pricing || { 60: service.price, 90: service.price, 120: service.price };
    const price60 = pricing[60] || pricing['60'] || service.price || 0;
    
    const imageSrc = getServiceImage(service);
    
    const description = service.description 
      ? (service.description.length > 120 
          ? service.description.substring(0, 120) + '...' 
          : service.description)
      : 'Premium spa service for your wellness journey';
    
    return `
      <div class="service-card-shop" data-service-id="${service._id}">
        <div class="service-image-shop">
          <img 
            src="${imageSrc}" 
            alt="${service.name}" 
            loading="lazy"
            onerror="this.src='${DEFAULT_PLACEHOLDER}'; this.onerror=null;"
          >
        </div>
        <div class="service-content-shop">
          ${service.category ? `<span class="service-category-shop">${formatCategoryName(service.category)}</span>` : ''}
          <h3 class="service-title-shop">${service.name}</h3>
          <p class="service-description-shop">${description}</p>
          <div class="service-price-shop">₱${price60.toLocaleString()}</div>
          <button 
            class="btn-book-service" 
            onclick="window.bookService('${service._id}', '${service.name.replace(/'/g, "\\'")}')"
            aria-label="Book ${service.name}"
          >
            <i class="fas fa-calendar-check"></i>
            Book Now
          </button>
        </div>
      </div>
    `;
  }

  // ============================================
  // BOOK SERVICE
  // ============================================
  window.bookService = function(serviceId, serviceName) {
    console.log('📅 Booking service:', serviceName);
    
    const button = event.target.closest('.btn-book-service');
    if (button) {
      button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Redirecting...';
      button.style.background = 'linear-gradient(135deg, #28a745 0%, #20873a 100%)';
      button.disabled = true;
    }
    
    setTimeout(() => {
      window.closeCatalog();
      window.location.href = `booking.html?service=${encodeURIComponent(serviceId)}&name=${encodeURIComponent(serviceName)}`;
    }, 800);
  };

  // ============================================
  // SEARCH SERVICES
  // ============================================
  let searchTimeout;
  
  window.searchServices = function() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => performSearch(), 300);
  };

  function performSearch() {
    const searchInput = document.getElementById('catalogSearch');
    if (!searchInput) return;
    
    const query = searchInput.value.toLowerCase().trim();
    
    if (!query) {
      displayServices(currentCategory === 'all' ? allServices : allServices.filter(s => s.category === currentCategory));
      return;
    }
    
    const filtered = allServices.filter(service => {
      const nameMatch = service.name.toLowerCase().includes(query);
      const descMatch = service.description && service.description.toLowerCase().includes(query);
      const categoryMatch = currentCategory === 'all' || service.category === currentCategory;
      return (nameMatch || descMatch) && categoryMatch;
    });
    
    displayServices(filtered);
  }

  // ============================================
  // INITIALIZE
  // ============================================
  document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('catalogSearch');
    if (searchInput) {
      searchInput.addEventListener('input', window.searchServices);
      searchInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); performSearch(); }
      });
    }

    const modal = document.getElementById('serviceCatalogModal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) window.closeCatalog();
      });
    }

    console.log('✅ Enhanced service catalog module loaded');
  });

})();