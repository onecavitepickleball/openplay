// Site-wide theme music. Each page load is a fresh audio element (this is a
// classic multi-page site, not an SPA, so audio can't literally survive a
// navigation) but playback resumes from the last known timestamp instead of
// restarting, and mute preference carries over via localStorage, so it
// reads as continuous even though it technically isn't.
(function () {
  var TIME_KEY = 'ocpc-music-time';
  var MUTED_KEY = 'ocpc-music-muted';
  var SAVE_INTERVAL_MS = 1000;

  var audio = document.getElementById('ocpcThemeAudio');
  var btn = document.getElementById('musicToggle');
  if (!audio) return;

  function getStoredMuted() {
    return localStorage.getItem(MUTED_KEY) === 'true';
  }
  function setStoredMuted(muted) {
    try { localStorage.setItem(MUTED_KEY, muted ? 'true' : 'false'); } catch (e) {}
  }
  function getStoredTime() {
    var v = parseFloat(localStorage.getItem(TIME_KEY));
    return isNaN(v) || v < 0 ? 0 : v;
  }
  function saveTime() {
    try { localStorage.setItem(TIME_KEY, String(audio.currentTime)); } catch (e) {}
  }
  function reflectMuted(muted) {
    if (!btn) return;
    btn.classList.toggle('is-muted', muted);
    btn.setAttribute('aria-label', muted ? 'Unmute music' : 'Mute music');
  }

  var userWantsSound = !getStoredMuted();

  try { audio.currentTime = getStoredTime(); } catch (e) {}
  audio.muted = true;
  reflectMuted(true);

  var playAttempt = audio.play();
  if (playAttempt && playAttempt.catch) playAttempt.catch(function () {});

  // Browsers block unmuted autoplay until the visitor interacts with the
  // page. Audio is already playing muted, so the first tap/click/keypress
  // anywhere just flips the mute flag; that's allowed without needing a
  // dedicated "click to play" prompt.
  var hasAutoUnmuted = false;
  function unmuteOnFirstGesture(e) {
    if (hasAutoUnmuted) return;
    if (btn && e.target && btn.contains(e.target)) return; // let the button's own click handler manage this
    hasAutoUnmuted = true;
    if (audio.muted) {
      audio.muted = false;
      reflectMuted(false);
    }
    detachGestureListeners();
  }
  function detachGestureListeners() {
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (evt) {
      document.removeEventListener(evt, unmuteOnFirstGesture);
    });
  }
  if (userWantsSound) {
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (evt) {
      document.addEventListener(evt, unmuteOnFirstGesture, { passive: true });
    });
  }

  if (btn) {
    btn.addEventListener('click', function () {
      var nowMuted = !audio.muted;
      audio.muted = nowMuted;
      setStoredMuted(nowMuted);
      reflectMuted(nowMuted);
      if (!nowMuted && audio.paused) audio.play().catch(function () {});
      hasAutoUnmuted = true;
      detachGestureListeners();
    });
  }

  setInterval(function () {
    if (!audio.paused) saveTime();
  }, SAVE_INTERVAL_MS);
  window.addEventListener('pagehide', saveTime);
})();
