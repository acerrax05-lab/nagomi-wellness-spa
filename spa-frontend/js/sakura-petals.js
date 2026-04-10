// js/sakura-petals.js
// Creates a fixed full-page layer and injects 20 sakura petals into it.
// Works on every page automatically — just include the CSS + this script.
(function () {
  const COUNT = 20;
  function init() {
    if (document.getElementById('sakura-layer')) return;
    const layer = document.createElement('div');
    layer.id = 'sakura-layer';
    for (let i = 1; i <= COUNT; i++) {
      const p = document.createElement('span');
      p.className = `sakura-petal sp${i}`;
      p.setAttribute('aria-hidden', 'true');
      layer.appendChild(p);
    }
    document.body.appendChild(layer);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();