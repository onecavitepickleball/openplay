// Site-wide theme music. Each page load is a fresh audio element (this is a
// classic multi-page site, not an SPA, so audio can't literally survive a
// navigation) but playback resumes from the last known timestamp instead of
// restarting, and mute preference carries over via localStorage, so it
// reads as continuous even though it technically isn't. Muted always means
// paused, not just silent, so the mute button doubles as a real stop.
(function () {
  var TIME_KEY = 'ocpc-music-time';
  var MUTED_KEY = 'ocpc-music-muted';
  var SAVE_INTERVAL_MS = 1000;

  var audio = document.getElementById('ocpcThemeAudio');
  var btns = Array.prototype.slice.call(document.querySelectorAll('.js-music-toggle'));
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
    btns.forEach(function (btn) {
      btn.classList.toggle('is-muted', muted);
      btn.setAttribute('aria-label', muted ? 'Unmute music' : 'Mute music');
    });
  }
  function isInsideAnyButton(target) {
    return btns.some(function (btn) { return btn.contains(target); });
  }

  var hasAutoUnmuted = false;
  function detachGestureListeners() {
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (evt) {
      // Must match the capture:true used when attaching, below.
      document.removeEventListener(evt, unmuteOnFirstGesture, true);
    });
  }
  // Capture phase, not bubble: several nav widgets (search, notifications,
  // account panel, mobile menu) call stopPropagation() on their own
  // click/pointerdown handlers, which would otherwise stop this listener
  // from ever seeing the event if it were attached on the bubble phase.
  function unmuteOnFirstGesture(e) {
    if (hasAutoUnmuted) return;
    if (e.target && isInsideAnyButton(e.target)) return; // the buttons' own click handlers manage this
    hasAutoUnmuted = true;
    audio.muted = false;
    reflectMuted(false);
    setStoredMuted(false);
    audio.play().catch(function () {});
    detachGestureListeners();
  }
  function armGestureUnmute() {
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (evt) {
      document.addEventListener(evt, unmuteOnFirstGesture, { capture: true, passive: true });
    });
  }

  var userWantsSound = !getStoredMuted();
  try { audio.currentTime = getStoredTime(); } catch (e) {}
  reflectMuted(!userWantsSound);

  if (userWantsSound) {
    // Try playing WITH sound first. A browser that already considers this
    // origin "engaged" (the visitor unmuted it earlier this same session)
    // will often allow this immediately, so most page-to-page navigations
    // never need a fresh gesture at all.
    audio.muted = false;
    var directAttempt = audio.play();
    if (directAttempt && directAttempt.catch) {
      directAttempt.catch(function () {
        // Blocked, most likely because this is the first page of the visit.
        // Stay paused (not muted-and-playing) until the first interaction
        // anywhere, then unmute and start for real.
        armGestureUnmute();
      });
    }
  } else {
    // Explicitly muted on a previous page: force it back off. The <audio>
    // tag's own muted/autoplay HTML attributes can otherwise start it
    // playing (muted) before this script even runs, and leaving
    // audio.muted untouched here would let that slip through as audible
    // once something later in the page flips it, so both are reasserted.
    audio.muted = true;
    audio.pause();
  }

  btns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      // Toggle off of the button's current visible state, not audio.muted;
      // pause/play is the real on/off switch, muted is left permanently
      // false so a stray unmute elsewhere can't un-pause it by accident.
      var nowMuted = !btn.classList.contains('is-muted');
      setStoredMuted(nowMuted);
      reflectMuted(nowMuted);
      if (nowMuted) {
        audio.pause();
      } else {
        audio.play().catch(function () {});
      }
      hasAutoUnmuted = true;
      detachGestureListeners();
    });
  });

  setInterval(function () {
    if (!audio.paused) saveTime();
  }, SAVE_INTERVAL_MS);
  window.addEventListener('pagehide', saveTime);
})();
