/* Privacy controls shared by the public OCPC site.
 * Optional analytics never loads until the visitor explicitly opts in.
 */
(() => {
  'use strict';

  const CONSENT_KEY = 'ocpc_privacy_choices_v1';
  const ANALYTICS_ID = 'G-H86SSQPCJ6';
  let analyticsLoaded = false;

  function readChoice() {
    try { return localStorage.getItem(CONSENT_KEY); } catch (_) { return null; }
  }
  function saveChoice(value) {
    try { localStorage.setItem(CONSENT_KEY, value); } catch (_) { /* preference remains for this page */ }
  }
  function loadAnalytics() {
    if (analyticsLoaded || document.querySelector('script[data-ocpc-analytics]')) return;
    analyticsLoaded = true;
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function gtag(){ window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', ANALYTICS_ID, { anonymize_ip: true });
    const script = document.createElement('script');
    script.async = true;
    script.dataset.ocpcAnalytics = 'true';
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ANALYTICS_ID)}`;
    document.head.appendChild(script);
  }

  function banner() {
    let el = document.getElementById('privacyChoiceBanner');
    if (el) return el;
    el = document.createElement('section');
    el.id = 'privacyChoiceBanner';
    el.className = 'privacy-choice-banner';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Privacy choices');
    el.hidden = true;
    el.innerHTML = `
      <div class="privacy-choice-copy">
        <strong>Your privacy choices</strong>
        <p>OCPC uses essential storage for features such as your cart and display preferences. Optional Google Analytics is off unless you allow it. <a href="/cookies/">Cookie Policy</a> · <a href="/privacy-policy/">Privacy Policy</a></p>
      </div>
      <div class="privacy-choice-actions">
        <button type="button" class="privacy-choice-reject">Keep optional analytics off</button>
        <button type="button" class="privacy-choice-accept">Allow optional analytics</button>
      </div>`;
    document.body.appendChild(el);
    el.querySelector('.privacy-choice-reject').addEventListener('click', () => choose('rejected'));
    el.querySelector('.privacy-choice-accept').addEventListener('click', () => choose('accepted'));
    return el;
  }
  function choose(value) {
    saveChoice(value);
    if (value === 'accepted') loadAnalytics();
    const el = banner();
    el.hidden = true;
  }
  function showChoices() { banner().hidden = false; }

  function addFooterControls() {
    document.querySelectorAll('.foot-legal').forEach((footer) => {
      if (!footer.querySelector('[data-cookie-settings]')) {
        const tools = document.createElement('span');
        tools.className = 'privacy-tools';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'cookie-settings-link';
        button.dataset.cookieSettings = 'true';
        button.textContent = 'Cookie Settings';
        tools.appendChild(button);
        footer.appendChild(tools);
      }
    });
    document.querySelectorAll('[data-cookie-settings]').forEach((button) => button.addEventListener('click', showChoices));
  }

  function protectEmbeds() {
    document.querySelectorAll('iframe[data-consent-src]').forEach((frame) => {
      if (frame.dataset.privacyReady === 'true') return;
      frame.dataset.privacyReady = 'true';
      const provider = frame.dataset.consentProvider || 'third-party content';
      const shell = document.createElement('div');
      shell.className = 'third-party-embed-notice';
      shell.innerHTML = `<p><strong>${provider}</strong> is optional and may receive your device information when loaded.</p><button type="button">Load ${provider}</button>`;
      frame.before(shell);
      frame.hidden = true;
      shell.querySelector('button').addEventListener('click', () => {
        frame.src = frame.dataset.consentSrc;
        frame.hidden = false;
        shell.remove();
      });
    });
  }

  function addSkipLink() {
    const target = document.querySelector('main, .wrap');
    if (!target || document.getElementById('skipToContent')) return;
    if (!target.id) target.id = 'main-content';
    const skip = document.createElement('a');
    skip.id = 'skipToContent';
    skip.className = 'skip-link';
    skip.href = `#${target.id}`;
    skip.textContent = 'Skip to main content';
    document.body.prepend(skip);
  }

  function addFormAcknowledgements() {
    document.querySelectorAll('form[data-privacy-consent]').forEach((form) => {
      if (form.querySelector('.privacy-form-consent')) return;
      const kind = form.dataset.privacyConsent;
      const copy = {
        contact: 'I understand OCPC will use these details to respond to my message.',
        profile: 'I have read the Privacy Policy and agree to OCPC processing these details to create and manage my player profile.',
        testimonial: 'I agree that OCPC may review and, if approved, publish my name, story and optional photo on its website and social channels.',
        payment: 'I have read the Privacy Policy and Refund Policy and understand OCPC will use these details to process this request or payment.',
        tournament: 'I have read the Tournament Privacy & Terms notice and agree to the processing of my account information for tournament access.'
      }[kind] || 'I have read the Privacy Policy and agree to processing of these details for this request.';
      const field = document.createElement('label');
      field.className = 'privacy-form-consent';
      field.innerHTML = `<input type="checkbox" required><span>${copy} <a href="/privacy-policy/" target="_blank" rel="noopener">Privacy Policy</a></span>`;
      const submit = form.querySelector('button[type="submit"], input[type="submit"]');
      if (submit) submit.before(field); else form.appendChild(field);
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    addFooterControls();
    protectEmbeds();
    addSkipLink();
    addFormAcknowledgements();
    if (readChoice() === 'accepted') loadAnalytics();
    else if (!readChoice()) showChoices();
  });
})();
