
// js/enhanced-features.js

// Initialize AOS (Animate On Scroll)
document.addEventListener('DOMContentLoaded', () => {
  AOS.init({
    duration: 800,
    easing: 'ease-in-out',
    once: true,
    offset: 100
  });
  
  // Initialize counter animations
  initCounters();
});


// COUNTER ANIMATIONS

function initCounters() {
  const counters = document.querySelectorAll('.stat-number');
  const speed = 200; // Lower = faster

  const observerOptions = {
    threshold: 0.5
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const counter = entry.target;
        const target = parseFloat(counter.getAttribute('data-target'));
        
        animateCounter(counter, target, speed);
        observer.unobserve(counter);
      }
    });
  }, observerOptions);

  counters.forEach(counter => observer.observe(counter));
}

function animateCounter(element, target, speed) {
  const increment = target / speed;
  let current = 0;
  const isDecimal = target % 1 !== 0;

  const updateCounter = () => {
    current += increment;
    if (current < target) {
      element.textContent = isDecimal ? current.toFixed(1) : Math.ceil(current);
      requestAnimationFrame(updateCounter);
    } else {
      element.textContent = isDecimal ? target.toFixed(1) : target;
    }
  };

  updateCounter();
}


// SMOOTH SCROLL FOR ANCHOR LINKS

document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function (e) {
    const href = this.getAttribute('href');
    
    // Skip if it's the catalog button
    if (href === '#' || this.hasAttribute('onclick')) {
      return;
    }
    
    e.preventDefault();
    const target = document.querySelector(href);
    
    if (target) {
      target.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  });
});


// PARALLAX EFFECT FOR HERO VIDEO

window.addEventListener('scroll', () => {
  const scrolled = window.pageYOffset;
  const heroVideo = document.querySelector('.hero-video');
  
  if (heroVideo && scrolled < window.innerHeight) {
    heroVideo.style.transform = `translate(-50%, calc(-50% + ${scrolled * 0.5}px))`;
  }
});


// LAZY LOAD IMAGES

if ('IntersectionObserver' in window) {
  const imageObserver = new IntersectionObserver((entries, observer) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const img = entry.target;
        img.src = img.dataset.src || img.src;
        img.classList.add('loaded');
        observer.unobserve(img);
      }
    });
  });

  document.querySelectorAll('img[data-src]').forEach(img => {
    imageObserver.observe(img);
  });
}


// NAVBAR SCROLL EFFECT (Enhanced)

let lastScroll = 0;
const navbar = document.getElementById('navbar');

window.addEventListener('scroll', () => {
  const currentScroll = window.pageYOffset;
  
  // Add/remove scrolled class
  if (currentScroll > 50) {
    navbar.classList.add('scrolled');
  } else {
    navbar.classList.remove('scrolled');
  }
  
  // Hide/show navbar on scroll (optional)
  if (currentScroll > lastScroll && currentScroll > 200) {
    navbar.style.transform = 'translateY(-100%)';
  } else {
    navbar.style.transform = 'translateY(0)';
  }
  
  lastScroll = currentScroll;
});


// REVIEW SLIDER (Auto-rotate reviews)

function initReviewSlider() {
  const reviews = document.querySelectorAll('.review-card');
  let currentReview = 0;
  
  // Auto-rotate every 5 seconds (optional)
  setInterval(() => {
    reviews.forEach((review, index) => {
      if (index === currentReview) {
        review.style.transform = 'scale(1.05)';
        review.style.boxShadow = '0 12px 30px rgba(0,0,0,0.15)';
      } else {
        review.style.transform = 'scale(1)';
        review.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)';
      }
    });
    
    currentReview = (currentReview + 1) % reviews.length;
  }, 5000);
}

// Initialize review slider
if (document.querySelector('.review-card')) {
  initReviewSlider();
}


// LOADING ANIMATION

window.addEventListener('load', () => {
  document.body.classList.add('loaded');
});


// CLICK EFFECTS

document.querySelectorAll('.btn, .btn-outline, .btn-quick-book').forEach(btn => {
  btn.addEventListener('click', function(e) {
    const ripple = document.createElement('span');
    const rect = this.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const x = e.clientX - rect.left - size / 2;
    const y = e.clientY - rect.top - size / 2;
    
    ripple.style.width = ripple.style.height = size + 'px';
    ripple.style.left = x + 'px';
    ripple.style.top = y + 'px';
    ripple.classList.add('ripple');
    
    this.style.position = 'relative';
    this.style.overflow = 'hidden';
    this.appendChild(ripple);
    
    setTimeout(() => ripple.remove(), 600);
  });
});

// Add ripple CSS
const style = document.createElement('style');
style.textContent = `
  .ripple {
    position: absolute;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.5);
    transform: scale(0);
    animation: ripple 0.6s ease-out;
    pointer-events: none;
  }
  
  @keyframes ripple {
    to {
      transform: scale(4);
      opacity: 0;
    }
  }
`;
document.head.appendChild(style);


// CONSOLE WELCOME MESSAGE

console.log('%cWelcome to Nagomi Wellness Spa! 🌸', 
  'font-size: 20px; color: #4b2e1e; font-weight: bold; padding: 10px;');
console.log('%cBuilt with care for your relaxation experience', 
  'font-size: 12px; color: #8b4513;');