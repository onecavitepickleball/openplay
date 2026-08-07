// Shared circular photo crop/zoom picker, used by the Join, Profile, and
// admin member-photo uploads. Plain canvas, no external dependency.
// Usage: const cropped = await window.OCPCPhotoCrop.open(file);
// Resolves a cropped square File (JPEG), or null if the user cancels.
(function(){
  const OUTPUT_SIZE = 640;

  function ensureUI(){
    if (document.getElementById('photoCropOverlay')) return;

    const style = document.createElement('style');
    style.textContent = `
      #photoCropOverlay{ position:fixed; inset:0; background:rgba(11,36,54,0.72); z-index:900; display:none; align-items:center; justify-content:center; padding:20px; }
      #photoCropOverlay.open{ display:flex; }
      .pc-card{ background:var(--white,#fff); border-radius:10px; padding:22px; width:100%; max-width:380px; box-shadow:0 20px 60px rgba(0,0,0,0.35); font-family: var(--font-body, inherit); }
      .pc-title{ font-family:var(--font-display,inherit); font-size:15px; text-transform:uppercase; letter-spacing:0.02em; margin-bottom:6px; color:var(--navy,#0B2436); }
      .pc-hint{ font-size:12px; color:var(--ink-faint,#7c8894); margin-bottom:14px; }
      .pc-stage{ position:relative; width:100%; aspect-ratio:1; border-radius:50%; overflow:hidden; background:#0B2436; cursor:grab; touch-action:none; margin:0 auto 16px; }
      .pc-stage.dragging{ cursor:grabbing; }
      .pc-stage canvas{ display:block; width:100%; height:100%; }
      .pc-zoom{ width:100%; margin-bottom:18px; accent-color: var(--sky-deep,#2C93DE); }
      .pc-actions{ display:flex; gap:10px; justify-content:flex-end; }
    `;
    document.head.appendChild(style);

    const overlay = document.createElement('div');
    overlay.id = 'photoCropOverlay';
    overlay.innerHTML = `
      <div class="pc-card">
        <div class="pc-title">Adjust Photo</div>
        <div class="pc-hint">Drag to reposition, use the slider to zoom.</div>
        <div class="pc-stage" id="pcStage"><canvas id="pcCanvas" width="${OUTPUT_SIZE}" height="${OUTPUT_SIZE}"></canvas></div>
        <input type="range" class="pc-zoom" id="pcZoom" min="1" max="3" step="0.01" value="1">
        <div class="pc-actions">
          <button type="button" class="btn btn-ghost" id="pcCancel">Cancel</button>
          <button type="button" class="btn btn-primary" id="pcSave">Use Photo</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
  }

  // Accepts either a File (freshly picked, not yet uploaded) or a string
  // URL (an already-uploaded photo the user wants to reframe). Either way
  // resolves a cropped square File, or null if cancelled.
  function open(source){
    return new Promise((resolve) => {
      const isUrl = typeof source === 'string';
      if (!isUrl && (!source || !source.type || !source.type.startsWith('image/'))){ resolve(null); return; }

      ensureUI();
      const overlay = document.getElementById('photoCropOverlay');
      const stage = document.getElementById('pcStage');
      const canvas = document.getElementById('pcCanvas');
      const ctx = canvas.getContext('2d');
      const zoomSlider = document.getElementById('pcZoom');
      const cancelBtn = document.getElementById('pcCancel');
      const saveBtn = document.getElementById('pcSave');

      const img = new Image();
      // Existing uploaded photos are cross-origin (Cloudinary), so request
      // CORS access so the canvas isn't tainted and toBlob() still works.
      if (isUrl) img.crossOrigin = 'anonymous';
      const objectUrl = isUrl ? null : URL.createObjectURL(source);
      let scale = 1, minScale = 1, offsetX = 0, offsetY = 0;
      let dragging = false, lastX = 0, lastY = 0;

      function draw(){
        ctx.clearRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
        ctx.drawImage(img, offsetX, offsetY, img.width * scale, img.height * scale);
      }

      function clampOffset(){
        const w = img.width * scale;
        const h = img.height * scale;
        offsetX = Math.min(0, Math.max(OUTPUT_SIZE - w, offsetX));
        offsetY = Math.min(0, Math.max(OUTPUT_SIZE - h, offsetY));
      }

      function pointerPos(e){
        const p = e.touches ? e.touches[0] : e;
        return { x: p.clientX, y: p.clientY };
      }

      function onDown(e){
        dragging = true;
        stage.classList.add('dragging');
        const p = pointerPos(e);
        lastX = p.x; lastY = p.y;
        e.preventDefault();
      }
      function onMove(e){
        if (!dragging) return;
        const p = pointerPos(e);
        // canvas is drawn at OUTPUT_SIZE but may render smaller on screen,
        // so scale pointer movement back up to canvas coordinate space.
        const rectScale = OUTPUT_SIZE / stage.clientWidth;
        offsetX += (p.x - lastX) * rectScale;
        offsetY += (p.y - lastY) * rectScale;
        lastX = p.x; lastY = p.y;
        clampOffset();
        draw();
        e.preventDefault();
      }
      function onUp(){
        dragging = false;
        stage.classList.remove('dragging');
      }

      function onZoom(){
        const newScale = parseFloat(zoomSlider.value);
        // Keep the crop centered on the same image point while zooming,
        // instead of re-centering on the image itself.
        const cx = OUTPUT_SIZE / 2, cy = OUTPUT_SIZE / 2;
        const imgX = (cx - offsetX) / scale;
        const imgY = (cy - offsetY) / scale;
        scale = newScale;
        offsetX = cx - imgX * scale;
        offsetY = cy - imgY * scale;
        clampOffset();
        draw();
      }

      function cleanup(){
        overlay.classList.remove('open');
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        stage.removeEventListener('mousedown', onDown);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        stage.removeEventListener('touchstart', onDown);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onUp);
        zoomSlider.removeEventListener('input', onZoom);
        cancelBtn.removeEventListener('click', onCancel);
        saveBtn.removeEventListener('click', onSave);
      }
      function onCancel(){
        cleanup();
        resolve(null);
      }
      function onSave(){
        canvas.toBlob((blob) => {
          cleanup();
          resolve(blob ? new File([blob], 'photo.jpg', { type: 'image/jpeg' }) : null);
        }, 'image/jpeg', 0.92);
      }

      img.onload = () => {
        minScale = Math.max(OUTPUT_SIZE / img.width, OUTPUT_SIZE / img.height);
        scale = minScale;
        offsetX = (OUTPUT_SIZE - img.width * scale) / 2;
        offsetY = (OUTPUT_SIZE - img.height * scale) / 2;
        zoomSlider.min = String(minScale);
        zoomSlider.max = String(minScale * 4);
        zoomSlider.step = String(minScale / 100);
        zoomSlider.value = String(minScale);
        draw();

        stage.addEventListener('mousedown', onDown);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        stage.addEventListener('touchstart', onDown, { passive:false });
        window.addEventListener('touchmove', onMove, { passive:false });
        window.addEventListener('touchend', onUp);
        zoomSlider.addEventListener('input', onZoom);
        cancelBtn.addEventListener('click', onCancel);
        saveBtn.addEventListener('click', onSave);

        overlay.classList.add('open');
      };
      img.onerror = () => {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        resolve(null);
      };
      img.src = isUrl ? source : objectUrl;
    });
  }

  window.OCPCPhotoCrop = { open };
})();
