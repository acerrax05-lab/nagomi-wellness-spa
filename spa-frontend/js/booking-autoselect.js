// js/booking-autoselect.js

(function () {
  'use strict';

  const API_BASE = 'https://nagomi-backend.onrender.com/api';
  const params   = new URLSearchParams(window.location.search);

  const serviceParam = (params.get('service') || '').trim();
  const nameParam    = (params.get('name')    || '').trim();
  const catParam     = (params.get('category')|| '').trim();

  // Exit only if there's nothing at all to work with
  if (!serviceParam && !catParam) return;

  // ── Detect URL format ──────────────────────────────────────────────────────
  // MongoDB IDs are 24-character hex strings
  const isMongoId   = /^[a-f0-9]{24}$/i.test(serviceParam);
  const wantedName  = isMongoId ? nameParam : serviceParam;
  const wantedId    = isMongoId ? serviceParam : null;

  console.log(` Auto-select: name="${wantedName || '(none)'}" cat="${catParam || '(none)'}"`);

  // ── Boot ───────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => boot());
  } else {
    boot();
  }

  async function boot() {
    let resolvedCat = catParam;

    // If we have a Mongo ID but no category, ask the API for it
    if (isMongoId && !resolvedCat) {
      try {
        const res      = await fetch(`${API_BASE}/services`);
        const services = await res.json();
        const found    = services.find(s => s._id === wantedId);
        if (found) {
          resolvedCat = found.category || '';
          console.log(` Resolved category from API: "${resolvedCat}"`);
        }
      } catch (_) {
        console.warn(' Could not fetch service list for category lookup');
      }
    }

    // If category-only (no specific service), just switch the tab
    if (!wantedName && !wantedId && resolvedCat) {
      setTimeout(() => switchTabOnly(resolvedCat, 0), 400);
      return;
    }

    // Small delay to let booking.js render its initial state
    setTimeout(() => tryAutoSelect(wantedName, resolvedCat, 0), 400);
  }

  // ── Category-only: switch tab then select first card ──────────────────────
  function switchTabOnly(cat, attempt) {
    if (attempt >= 20) return;
    const catTab = findCatTab(cat);
    if (!catTab) {
      setTimeout(() => switchTabOnly(cat, attempt + 1), 300);
      return;
    }
    if (!catTab.classList.contains('active')) {
      catTab.click();
      console.log(` Switched to tab: "${cat}"`);
    }
    // Wait for cards to render then select the first one
    setTimeout(() => selectFirstCard(cat, 0), 700);
  }

  function selectFirstCard(cat, attempt) {
    if (attempt >= 15) return;
    const cards = document.querySelectorAll('.services-grid .service-card');
    if (!cards.length) {
      setTimeout(() => selectFirstCard(cat, attempt + 1), 300);
      return;
    }
    const first = cards[0];
    first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    first.dispatchEvent(new MouseEvent('click',     { bubbles: true }));
    first.scrollIntoView({ behavior: 'smooth', block: 'center' });
    first.style.transition = 'box-shadow 0.3s, transform 0.3s';
    first.style.boxShadow  = '0 0 0 3px #8b4513, 0 8px 24px rgba(139,69,19,0.35)';
    first.style.transform  = 'scale(1.02)';
    setTimeout(() => {
      first.style.boxShadow = '';
      first.style.transform = '';
    }, 1800);
    console.log(` Auto-selected first card in "${cat}": "${getCardName(first)}"`);
  }

  // ── Retry loop ─────────────────────────────────────────────────────────────
  const MAX_ATTEMPTS = 25; // 25 × 300ms = 7.5s max

  function tryAutoSelect(name, cat, attempt) {
    if (attempt >= MAX_ATTEMPTS) {
      console.warn(' Auto-select: gave up after max attempts.');
      return;
    }

    // Step 1: Switch to the right category tab if needed
    if (cat) {
      const catTab = findCatTab(cat);
      if (catTab && !catTab.classList.contains('active')) {
        catTab.click();
        console.log(` Clicked category tab: "${cat}"`);
        // Give the tab render time before looking for cards (increased to 700ms)
        setTimeout(() => tryAutoSelect(name, cat, attempt + 1), 700);
        return;
      }
    }

    // Step 2: Find matching card
    const cards = document.querySelectorAll('.services-grid .service-card');
    if (!cards.length) {
      setTimeout(() => tryAutoSelect(name, cat, attempt + 1), 300);
      return;
    }

    const matched = findCard(cards, name);

    if (matched) {
      // Dispatch proper mouse events so booking.js handlers fire reliably
      matched.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      matched.dispatchEvent(new MouseEvent('click',     { bubbles: true }));
      matched.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Highlight flash
      matched.style.transition = 'box-shadow 0.3s, transform 0.3s';
      matched.style.boxShadow  = '0 0 0 3px #8b4513, 0 8px 24px rgba(139,69,19,0.35)';
      matched.style.transform  = 'scale(1.02)';
      setTimeout(() => {
        matched.style.boxShadow = '';
        matched.style.transform = '';
      }, 1800);

      showNotification(`<i class="fa-solid fa-wand-magic-sparkles"></i> ${name} selected`);
      console.log(` Auto-selected: "${getCardName(matched)}"`);
      return;
    }

    // Card not found yet — if we haven't tried a category tab, try all tabs
    if (!cat) {
      const tabs = document.querySelectorAll('.cat-tab');
      if (tabs.length && attempt === 1) {
        // Try scanning every tab to find the right one
        tryScanAllTabs(name, Array.from(tabs), 0);
        return;
      }
    }

    setTimeout(() => tryAutoSelect(name, cat, attempt + 1), 300);
  }

  // ── Scan every category tab until we find the card ────────────────────────
  function tryScanAllTabs(name, tabs, tabIndex) {
    if (tabIndex >= tabs.length) {
      console.warn(` Auto-select: "${name}" not found in any category.`);
      return;
    }

    const tab = tabs[tabIndex];
    if (!tab.classList.contains('active')) tab.click();

    setTimeout(() => {
      const cards   = document.querySelectorAll('.services-grid .service-card');
      const matched = findCard(cards, name);

      if (matched) {
        matched.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        matched.dispatchEvent(new MouseEvent('click',     { bubbles: true }));
        matched.scrollIntoView({ behavior: 'smooth', block: 'center' });
        matched.style.transition = 'box-shadow 0.3s';
        matched.style.boxShadow  = '0 0 0 3px #8b4513, 0 8px 24px rgba(139,69,19,0.35)';
        setTimeout(() => { matched.style.boxShadow = ''; }, 1800);
        showNotification(`<i class="fa-solid fa-wand-magic-sparkles"></i> ${name} selected`);
        console.log(` Auto-selected via tab scan: "${getCardName(matched)}"`);
      } else {
        tryScanAllTabs(name, tabs, tabIndex + 1);
      }
    }, 700);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function findCatTab(category) {
    const target = normalize(category);
    const tabs   = document.querySelectorAll('.cat-tab');
    // 1. Exact match first
    for (const tab of tabs) {
      const tabText = normalize(tab.dataset.cat || tab.textContent || '');
      if (tabText === target) return tab;
    }
    // 2. Target starts with tab text (e.g. tab="packages", target="couplespackages" — skip this)
    // 3. Tab text starts with target OR target starts with tab text — only if lengths are close
    for (const tab of tabs) {
      const tabText = normalize(tab.dataset.cat || tab.textContent || '');
      if (target.startsWith(tabText) && tabText.length >= target.length * 0.8) return tab;
      if (tabText.startsWith(target) && target.length >= tabText.length * 0.8) return tab;
    }
    // 4. Fallback: target contains tabText only if tabText is long enough (avoid "packages" matching "couplespackages")
    for (const tab of tabs) {
      const tabText = normalize(tab.dataset.cat || tab.textContent || '');
      if (tabText.length >= 6 && target.includes(tabText) && !target.includes('couple' + tabText)) return tab;
    }
    return null;
  }

  function findCard(cards, name) {
    const target = normalize(name);
    // 1. Exact
    for (const c of cards) if (normalize(getCardName(c)) === target) return c;
    // 2. Starts-with (either direction)
    for (const c of cards) {
      const n = normalize(getCardName(c));
      if (n.startsWith(target) || target.startsWith(n)) return c;
    }
    // 3. Contains (either direction)
    for (const c of cards) {
      const n = normalize(getCardName(c));
      if (n.includes(target) || target.includes(n)) return c;
    }
    return null;
  }

  function getCardName(card) {
    return (
      card.querySelector('.service-card-name')?.textContent ||
      card.querySelector('h3')?.textContent ||
      card.textContent || ''
    ).trim();
  }

  function normalize(str) {
    return str.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // ── Toast notification ─────────────────────────────────────────────────────
  function showNotification(message) {
    document.getElementById('autoselect-notification')?.remove();

    const style = document.createElement('style');
    style.textContent = `
      @keyframes autoNotifIn  { from { transform:translateX(360px);opacity:0 } to { transform:translateX(0);opacity:1 } }
      @keyframes autoNotifOut { from { transform:translateX(0);opacity:1 } to { transform:translateX(360px);opacity:0 } }
    `;
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = 'autoselect-notification';
    el.textContent = message;
    el.style.cssText = `
      position:fixed;top:80px;right:20px;
      background:linear-gradient(135deg,#8b4513,#4b2e1e);
      color:#fff;padding:13px 22px;border-radius:10px;
      box-shadow:0 4px 18px rgba(0,0,0,0.28);
      z-index:10000;font-size:0.9rem;font-weight:600;
      font-family:'Poppins',sans-serif;
      animation:autoNotifIn 0.35s ease;max-width:340px;
    `;
    document.body.appendChild(el);

    setTimeout(() => {
      el.style.animation = 'autoNotifOut 0.3s ease forwards';
      setTimeout(() => el.remove(), 320);
    }, 4000);
  }

})();