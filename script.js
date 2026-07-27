// Shared across all pages: mobile nav toggle, "More" dropdown, scroll-reveal animations
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
