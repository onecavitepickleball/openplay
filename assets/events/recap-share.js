(() => {
  const actions = document.querySelector('.recap-actions');
  if (!actions || document.querySelector('.recap-share')) return;

  const title = document.querySelector('.recap-hero h1')?.textContent.trim() || document.title;
  const description = document.querySelector('meta[name="description"]')?.content || 'A recap from One Cavite Pickleball Club.';
  const url = window.location.href;
  const share = document.createElement('section');
  share.className = 'recap-share';
  share.setAttribute('aria-label', 'Share this recap');
  share.innerHTML = `
    <span class="recap-share-label">Share this recap</span>
    <button type="button" data-recap-native ${navigator.share ? '' : 'hidden'}>Share</button>
    <a data-recap-facebook target="_blank" rel="noopener">Share on Facebook</a>
    <button type="button" data-recap-copy>Copy link</button>
    <span class="recap-share-status" aria-live="polite"></span>`;
  actions.insertAdjacentElement('afterend', share);

  const status = share.querySelector('.recap-share-status');
  const setStatus = message => {
    status.textContent = message;
    window.setTimeout(() => { if (status.textContent === message) status.textContent = ''; }, 3000);
  };
  share.querySelector('[data-recap-facebook]').href = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`;
  share.querySelector('[data-recap-native]')?.addEventListener('click', async () => {
    try { await navigator.share({ title, text: description, url }); }
    catch (error) { if (error?.name !== 'AbortError') setStatus('Sharing is unavailable on this device.'); }
  });
  share.querySelector('[data-recap-copy]').addEventListener('click', async () => {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      else {
        const input = document.createElement('textarea'); input.value = url; input.style.position = 'fixed'; input.style.opacity = '0';
        document.body.append(input); input.select(); document.execCommand('copy'); input.remove();
      }
      setStatus('Link copied — ready to paste anywhere.');
    } catch { setStatus('Could not copy automatically. Please copy the URL from your browser.'); }
  });
})();
