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

  const SEARCH_INDEX = [
    { title: 'Home', desc: 'Open play schedule & club overview', url: '/', kw: 'schedule open play home this week' },
    { title: 'Meet the Club', desc: 'Player roster', url: '/meet-the-club/', kw: 'players roster members' },
    { title: 'Events', desc: 'Outings, tournaments & recaps', url: '/events/', kw: 'tournament outing rainbow rally zambales' },
    { title: 'My Profile', desc: 'Manage your player profile', url: '/profile/', kw: 'login account sign in profile' },
    { title: 'Join OCPC', desc: 'Sign up as a player', url: '/join/', kw: 'signup register join new player' },
    { title: 'Gear Picks', desc: 'Recommended paddles & gear', url: '/gear/', kw: 'paddle shoes bag grip gear equipment' },
    { title: 'Gallery', desc: 'Photos from sessions & events', url: '/gallery/', kw: 'photos pictures gallery' },
    { title: 'Queue', desc: 'Live open play queue', url: '/queue/', kw: 'queue court rotation' },
    { title: 'Leaderboard', desc: 'Most active players', url: '/leaderboard/', kw: 'leaderboard rank top players stats' },
    { title: 'Coaching', desc: 'Coaching sessions & clinics', url: '/coaching/', kw: 'coach lesson clinic training' },
    { title: 'Rules & Etiquette', desc: 'Pickleball basics for beginners', url: '/rules/', kw: 'rules etiquette kitchen scoring beginner' },
    { title: 'Featured Courts', desc: 'Court spotlight', url: '/featured-courts/', kw: 'courts venues' },
    { title: 'Birthdays', desc: 'This month’s celebrants', url: '/birthdays/', kw: 'birthday celebrant' },
    { title: 'Contact', desc: 'Get in touch with OCPC', url: '/contact/', kw: 'contact email message ask' },
    { title: 'Personality Quiz', desc: 'What pickleball player are you?', url: '/quiz/', kw: 'quiz fun personality' },
    { title: 'Shop', desc: 'Uniform & OCPC T-Shirt v1', url: '/merch/', kw: 'shop merch uniform tshirt shirt sublimation heat press order' },
    { title: 'Zambales Trip', desc: 'OCPC Goes to Zambales recap', url: '/zambales-trip/', kw: 'zambales trip pampanga highgrounds' },
    { title: 'Privacy Policy', desc: 'How we handle your data', url: '/privacy-policy/', kw: 'privacy data legal' },
    { title: 'Accessibility Help', desc: 'Accessibility commitment & feedback', url: '/accessibility/', kw: 'accessibility a11y disability' },
    { title: 'Privacy Notice', desc: 'Quick data collection summary', url: '/privacy-notice/', kw: 'privacy notice data rights' },
    { title: 'Terms & Conditions', desc: 'Rules for using OCPC & this site', url: '/terms/', kw: 'terms conditions legal waiver liability' },
    { title: 'Social Media Policy', desc: 'Guidelines for our social channels', url: '/social-media-policy/', kw: 'social media facebook policy' },
  ];

  function renderSearchResults(query){
    const q = query.trim().toLowerCase();
    if (!q) {
      searchResults.innerHTML = '';
      searchWrap.classList.remove('results-open');
      return;
    }
    const matches = SEARCH_INDEX.filter(item =>
      item.title.toLowerCase().includes(q) || item.kw.includes(q)
    ).slice(0, 8);
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
