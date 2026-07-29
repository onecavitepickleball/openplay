// Shared across all pages: mobile nav toggle, "More" dropdown, scroll-reveal animations

// ---- PWA service worker registration ----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* registration failed, site still works normally */ });
  });
}

document.addEventListener('DOMContentLoaded', () => {

  // ---- Mobile hamburger toggle ----
  const toggle = document.querySelector('.nav-toggle');
  const links = document.querySelector('.nav-links');
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      links.classList.toggle('open');
    });
    links.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => links.classList.remove('open'));
    });
  }

  // ---- "More" dropdown ----
  const moreWrap = document.querySelector('.nav-more');
  const moreBtn = document.querySelector('.nav-more-btn');
  if (moreWrap && moreBtn) {
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      moreWrap.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!moreWrap.contains(e.target)) moreWrap.classList.remove('open');
    });
  }

  // ---- Generic click-toggle dropdown helper (used by notifications + account) ----
  function wireDropdown(wrapSelector, btnSelector, onOpen){
    const wrap = document.querySelector(wrapSelector);
    const btn = document.querySelector(btnSelector);
    if (!wrap || !btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const opening = !wrap.classList.contains('open');
      document.querySelectorAll('.nav-notif.open, .nav-account.open').forEach(el => {
        if (el !== wrap) { el.classList.remove('open'); el.classList.remove('anim'); }
      });
      wrap.classList.toggle('open', opening);
      if (opening) {
        requestAnimationFrame(() => wrap.classList.add('anim'));
        if (onOpen) onOpen();
      } else {
        wrap.classList.remove('anim');
      }
    });
    document.addEventListener('click', (e) => {
      if (!wrap.contains(e.target)) { wrap.classList.remove('open'); wrap.classList.remove('anim'); }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { wrap.classList.remove('open'); wrap.classList.remove('anim'); }
    });
  }

  wireDropdown('.nav-notif', '.nav-notif-btn');
  wireDropdown('.nav-account', '.nav-account-btn');

  // ---- Expandable search (full takeover, like WTA's) ----
  const siteNav = document.querySelector('.site-nav');
  const searchWrap = document.querySelector('.nav-search');
  const searchBtn = document.querySelector('.nav-search-btn');
  const searchInput = document.getElementById('navSearchInput');
  const searchResults = document.getElementById('navSearchResults');
  const searchForm = document.getElementById('navSearchForm');

  // Inject the close (X) button and the blurred backdrop once per page —
  // keeps every page's static markup untouched.
  let searchCloseBtn = null;
  if (searchForm && !document.getElementById('navSearchClose')) {
    searchCloseBtn = document.createElement('button');
    searchCloseBtn.type = 'button';
    searchCloseBtn.className = 'nav-search-close';
    searchCloseBtn.id = 'navSearchClose';
    searchCloseBtn.setAttribute('aria-label', 'Close search');
    searchCloseBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="6" y1="6" x2="18" y2="18" stroke-linecap="round"/><line x1="18" y1="6" x2="6" y2="18" stroke-linecap="round"/></svg>';
    searchForm.appendChild(searchCloseBtn);
  } else {
    searchCloseBtn = document.getElementById('navSearchClose');
  }

  let searchBackdrop = document.querySelector('.search-backdrop');
  if (!searchBackdrop) {
    searchBackdrop = document.createElement('div');
    searchBackdrop.className = 'search-backdrop';
    document.body.appendChild(searchBackdrop);
  }

  function closeSearch(){
    if (siteNav) siteNav.classList.remove('search-active');
    searchBackdrop.classList.remove('active');
    searchWrap.classList.remove('open', 'results-open');
    searchInput.value = '';
    searchResults.innerHTML = '';
  }

  // Every real page on the site, with a short fallback description used
  // when a match is on the title only (no body snippet available yet).
  const SEARCH_PAGES = [
    { title: 'Home', desc: 'Open play schedule & club overview', url: '/' },
    { title: 'Meet the Club', desc: 'Player roster', url: '/meet-the-club/' },
    { title: 'Events', desc: 'Outings, tournaments & recaps', url: '/events/' },
    { title: 'My Profile', desc: 'Manage your player profile', url: '/profile/' },
    { title: 'Join OCPC', desc: 'Sign up as a player', url: '/join/' },
    { title: 'Gear Picks', desc: 'Recommended paddles & gear', url: '/gear/' },
    { title: 'Gallery', desc: 'Photos from sessions & events', url: '/gallery/' },
    { title: 'Queue', desc: 'Live open play queue', url: '/queue/' },
    { title: 'Leaderboard', desc: 'Most active players', url: '/leaderboard/' },
    { title: 'Coaching', desc: 'Coaching sessions & clinics', url: '/coaching/' },
    { title: 'Rules & Etiquette', desc: 'Pickleball basics for beginners', url: '/rules/' },
    { title: 'Featured Courts', desc: 'Court spotlight', url: '/featured-courts/' },
    { title: 'Birthdays', desc: 'This month’s celebrants', url: '/birthdays/' },
    { title: 'Contact', desc: 'Get in touch with OCPC', url: '/contact/' },
    { title: 'Personality Quiz', desc: 'What pickleball player are you?', url: '/quiz/' },
    { title: 'Shop', desc: 'Uniform & OCPC T-Shirt v1', url: '/merch/' },
    { title: 'Zambales Trip', desc: 'OCPC Goes to Zambales recap', url: '/zambales-trip/' },
    { title: 'Privacy Policy', desc: 'How we handle your data', url: '/privacy-policy/' },
    { title: 'Accessibility Help', desc: 'Accessibility commitment & feedback', url: '/accessibility/' },
    { title: 'Privacy Notice', desc: 'Quick data collection summary', url: '/privacy-notice/' },
    { title: 'Terms & Conditions', desc: 'Rules for using OCPC & this site', url: '/terms/' },
    { title: 'Social Media Policy', desc: 'Guidelines for our social channels', url: '/social-media-policy/' },
  ];

  // Full-text index is built by actually fetching every page once and
  // reading its visible text — so a search for something that only
  // appears in a page's body (like a court name) still finds it, not
  // just titles. Cached in sessionStorage so it only happens once per
  // browser tab, not on every keystroke or page navigation.
  const SEARCH_INDEX_CACHE_KEY = 'ocpc_search_text_index_v1';
  let searchIndexPromise = null;

  function stripAndExtractText(html){
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, nav, footer, noscript').forEach(el => el.remove());
    const raw = (doc.body ? doc.body.textContent : '') || '';
    return raw.replace(/\s+/g, ' ').trim();
  }

  function buildSearchIndex(){
    if (searchIndexPromise) return searchIndexPromise;

    let cached = null;
    try { cached = JSON.parse(sessionStorage.getItem(SEARCH_INDEX_CACHE_KEY) || 'null'); } catch (err) {}
    if (cached && Array.isArray(cached) && cached.length === SEARCH_PAGES.length) {
      searchIndexPromise = Promise.resolve(cached);
      return searchIndexPromise;
    }

    searchIndexPromise = Promise.all(SEARCH_PAGES.map(p =>
      fetch(p.url).then(r => r.text()).then(html => ({
        title: p.title, url: p.url, desc: p.desc, text: stripAndExtractText(html)
      })).catch(() => ({ title: p.title, url: p.url, desc: p.desc, text: '' }))
    )).then(results => {
      try { sessionStorage.setItem(SEARCH_INDEX_CACHE_KEY, JSON.stringify(results)); } catch (err) {}
      return results;
    });
    return searchIndexPromise;
  }

  // Kick the crawl off in the background as soon as the page is idle, so
  // the index is usually already warm by the time someone opens search.
  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => buildSearchIndex());
  } else {
    setTimeout(() => buildSearchIndex(), 1500);
  }

  function snippetAround(text, q){
    const lower = text.toLowerCase();
    const pos = lower.indexOf(q);
    if (pos === -1) return '';
    const start = Math.max(0, pos - 36);
    const end = Math.min(text.length, pos + q.length + 60);
    return (start > 0 ? '…' : '') + text.slice(start, end).trim() + (end < text.length ? '…' : '');
  }

  let searchRequestToken = 0;

  function paintSearchMatches(matches, query){
    searchWrap.classList.add('results-open');
    searchResults.innerHTML = matches.length
      ? matches.map(m => `
          <a class="nav-search-result" href="${m.url}">
            <div class="r-title">${m.title}</div>
            <div class="r-desc">${m.desc}</div>
          </a>
        `).join('')
      : `<div class="nav-search-empty">No matches for “${query}”</div>`;
  }

  function renderSearchResults(query){
    const q = query.trim().toLowerCase();
    if (!q) {
      searchResults.innerHTML = '';
      searchWrap.classList.remove('results-open');
      return;
    }

    const token = ++searchRequestToken;

    // Instant pass off page titles, so results never feel laggy.
    const titleMatches = SEARCH_PAGES
      .filter(p => p.title.toLowerCase().includes(q))
      .map(p => ({ title: p.title, url: p.url, desc: p.desc }));
    paintSearchMatches(titleMatches, query);

    buildSearchIndex().then(index => {
      if (token !== searchRequestToken) return; // input changed since this search started
      const seen = new Set(titleMatches.map(m => m.url));
      const bodyMatches = [];
      index.forEach(p => {
        if (seen.has(p.url)) return;
        const titleHit = p.title.toLowerCase().includes(q);
        const snippet = p.text ? snippetAround(p.text, q) : '';
        if (!titleHit && !snippet) return;
        bodyMatches.push({ title: p.title, url: p.url, desc: snippet || p.desc });
      });
      paintSearchMatches(titleMatches.concat(bodyMatches).slice(0, 10), query);
    });
  }

  if (searchWrap && searchBtn && searchInput) {
    searchBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const opening = !searchWrap.classList.contains('open');
      if (opening) {
        if (siteNav) siteNav.classList.add('search-active');
        searchBackdrop.classList.add('active');
        searchWrap.classList.add('open');
        setTimeout(() => searchInput.focus(), 60);
      } else {
        closeSearch();
      }
    });
    searchInput.addEventListener('input', () => renderSearchResults(searchInput.value));
    if (searchForm) {
      searchForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const first = searchResults.querySelector('.nav-search-result');
        if (first) window.location.href = first.getAttribute('href');
      });
    }
    if (searchCloseBtn) {
      searchCloseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeSearch();
      });
    }
    searchBackdrop.addEventListener('click', closeSearch);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeSearch();
    });
  }

  // ---- Floating Messenger widget ----
  const msgWidget = document.createElement('div');
  msgWidget.className = 'fb-msg-widget';
  msgWidget.innerHTML = `
    <a class="fb-msg-btn" href="https://m.me/onecavitepickleball" target="_blank" rel="noopener" aria-label="Message us on Facebook">
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none"><path d="M4 12c0-4.4 3.8-8 8.5-8s8.5 3.6 8.5 8-3.8 8-8.5 8c-.9 0-1.8-.1-2.6-.4L6 21l1.2-3.6C5.2 16 4 14.1 4 12z" fill="currentColor"/><path d="M8.5 12.8l2.7-2.9 2.2 1.7 2.8-2.9-2.7 3.9-2.2-1.7-2.8 2.9z" fill="#fff"/></svg>
    </a>
    <span class="fb-msg-tooltip">Message us on Facebook</span>
  `;
  document.body.appendChild(msgWidget);

  // ---- Scroll-reveal animations ----
  const revealEls = document.querySelectorAll('.reveal, .reveal-stagger');
  if (revealEls.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    revealEls.forEach(el => io.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add('in-view'));
  }
});
