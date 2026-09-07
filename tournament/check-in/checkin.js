(() => {
  const config = window.TOURNAMENT_CONFIG;
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  let state;
  function load() { try { state = JSON.parse(localStorage.getItem(config.storageKey)); } catch (_) { state = null; } }
  function save() { localStorage.setItem(config.storageKey, JSON.stringify(state)); }
  function categoryCount() { const category = $('#playerCategory').value; return state.pairCounts?.[category] || config.pairsPerCategory[category] || 6; }
  function fillPairs() {
    const club = config.clubs.find(item => item.id === $('#playerClub').value);
    $('#pairNumber').innerHTML = Array.from({ length: categoryCount() }, (_, index) => `<option>${club.pairPrefix}${index + 1}</option>`).join('');
  }
  function render() {
    const rows = Object.values(state.checkins || {}).sort((a, b) => b.checkedInAt.localeCompare(a.checkedInAt));
    $('#checkinList').innerHTML = rows.length ? rows.map(player => `<div class="checkin-row"><img src="${player.photo || ''}" alt=""><div><b>${esc(player.name)}</b><small>${esc(player.category)} · ${esc(player.pair)} · ${esc(player.clubName)} · ${esc(player.shirtSize)}</small></div><span class="badge">${player.waiverSigned ? 'Waiver ✓' : 'Waiver pending'} · ${esc(player.payment)}</span></div>`).join('') : '<p class="sub">No players checked in yet.</p>';
  }
  async function photoData(file) {
    if (!file) return '';
    return new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => {
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement('canvas'), size = 240, scale = Math.max(size / image.width, size / image.height), width = image.width * scale, height = image.height * scale;
          canvas.width = size; canvas.height = size; canvas.getContext('2d').drawImage(image, (size - width) / 2, (size - height) / 2, width, height); resolve(canvas.toDataURL('image/jpeg', .72));
        };
        image.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
  load(); state.checkins ||= {};
  config.categories.forEach(category => $('#playerCategory').insertAdjacentHTML('beforeend', `<option>${esc(category)}</option>`));
  fillPairs(); $('#playerClub').onchange = fillPairs; $('#playerCategory').onchange = fillPairs;
  $('#checkinForm').onsubmit = async event => {
    event.preventDefault();
    const name = $('#playerName').value.trim(), club = config.clubs.find(item => item.id === $('#playerClub').value), id = `${$('#playerCategory').value}|${$('#pairNumber').value}|${name.toLowerCase()}`;
    state.checkins[id] = { name, email: $('#playerEmail').value.trim(), shirtSize: $('#shirtSize').value, club: club.id, clubName: club.short, category: $('#playerCategory').value, pair: $('#pairNumber').value, payment: $('#paymentStatus').value, waiverSigned: $('#waiverSigned').checked, photo: await photoData($('#playerPhoto').files[0]), checkedInAt: new Date().toISOString() };
    save(); event.target.reset(); fillPairs(); render();
  };
  render(); window.addEventListener('storage', () => { load(); render(); });
})();
