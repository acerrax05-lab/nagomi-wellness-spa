// js/sakura-petals.js
// Automatically injects scattered sakura petal <span> elements into every
// element that has the class "sakura-bg".
//
// Usage — just add the class to a section:
//   <section class="sakura-bg reviews-section">...</section>
//
// Then include this script once on the page (before </body>):
//   <script src="js/sakura-petals.js"></script>

(function () {
  const PETAL_COUNT = 16;

  function injectPetals(container) {
    // Don't inject twice
    if (container.querySelector('.sakura-petal')) return;
    for (let i = 1; i <= PETAL_COUNT; i++) {
      const el = document.createElement('span');
      el.className = `sakura-petal s${i}`;
      el.setAttribute('aria-hidden', 'true');
      container.appendChild(el);
    }
  }

  function init() {
    document.querySelectorAll('.sakura-bg').forEach(injectPetals);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();