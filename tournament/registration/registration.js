import { watchAuth, login, logout, watchControl, watchRegistrations, createRegistration, updateRegistration, deleteRegistration, publishControl } from '../firebase-sync.js';

(() => {
  const config = window.TOURNAMENT_CONFIG, $ = selector => document.querySelector(selector), esc = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  let state = null, registrations = [], editingId = '';
  const toast = message => { const el = $('#officialToast'); el.textContent = message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 1800); };
  const club = () => config.clubs.find(item => item.id === $('#regClub').value);
  function fillPairSlots() { if (!state) return; const count = state.pairCounts?.[$('#regCategory').value] || 6, prefix = club()?.pairPrefix || 'O'; $('#regPair').innerHTML = Array.from({length: count}, (_, i) => `<option value="${prefix}${i+1}">${prefix}${i+1}</option>`).join(''); }
  function applyPairToRoster(registration, previous = null) {
    if (previous) {
      const previousKey = `${previous.category}|${previous.pairCode}`;
      if (state.pairs[previousKey]?.registrationId === registration.id && (registration.status !== 'confirmed' || previousKey !== `${registration.category}|${registration.pairCode}`)) state.pairs[previousKey] = { player1: '', player2: '' };
    }
    if (registration.status !== 'confirmed') { publishControl(state).catch(() => toast('Registration saved, but roster unlinking failed.')); return; }
    const key = `${registration.category}|${registration.pairCode}`;
    state.pairs[key] = { player1: registration.players[0].fullName, player2: registration.players[1].fullName, registrationId: registration.id || editingId };
    publishControl(state).catch(() => toast('Registration saved, but roster linking failed.'));
  }
  function render() {
    const q = $('#registrationSearch').value.trim().toLowerCase();
    const rows = registrations.filter(item => !q || `${item.category} ${item.clubName} ${item.pairCode} ${item.players?.map(p => p.fullName).join(' ')}`.toLowerCase().includes(q));
    $('#registrationCount').textContent = `${registrations.length} pairs retained in Firebase`;
    $('#registrationList').innerHTML = rows.length ? rows.map(item => `<article class="registration-row"><div><span class="badge">${esc(item.status)}</span><b>${esc(item.category)} · ${esc(item.clubName)} · ${esc(item.pairCode)}</b><small>${esc(item.players?.[0]?.fullName)} / ${esc(item.players?.[1]?.fullName)}</small></div><div class="row-actions"><button class="action alt" data-edit="${item.id}">Edit</button><button class="text-danger" data-delete="${item.id}">Remove</button></div></article>`).join('') : '<p class="sub">No registrations found.</p>';
    document.querySelectorAll('[data-edit]').forEach(button => button.onclick = () => edit(button.dataset.edit));
    document.querySelectorAll('[data-delete]').forEach(button => button.onclick = async () => { const item = registrations.find(row => row.id === button.dataset.delete); if (!confirm(`Remove ${item.players[0].fullName} / ${item.players[1].fullName} from registration?`)) return; const key = `${item.category}|${item.pairCode}`; if (state.pairs[key]?.registrationId === item.id) { state.pairs[key] = { player1:'', player2:'' }; await publishControl(state); } await deleteRegistration(item.id); toast('Registration removed.'); });
  }
  function edit(id) { const item = registrations.find(row => row.id === id); if (!item) return; editingId = id; $('#formTitle').textContent = 'Edit pair'; $('#regCategory').value = item.category; $('#regClub').value = item.club; fillPairSlots(); $('#regPair').value = item.pairCode; $('#regStatus').value = item.status; ['Name','Email','Dupr'].forEach((field, index) => { $('#p1'+field).value = item.players[0][field === 'Name' ? 'fullName' : field.toLowerCase()] || ''; $('#p2'+field).value = item.players[1][field === 'Name' ? 'fullName' : field.toLowerCase()] || ''; }); $('#cancelEdit').hidden = false; window.scrollTo({top:0,behavior:'smooth'}); }
  function resetForm() { editingId = ''; $('#registrationForm').reset(); $('#formTitle').textContent = 'New pair'; $('#cancelEdit').hidden = true; fillPairSlots(); }
  config.categories.forEach(category => $('#regCategory').insertAdjacentHTML('beforeend', `<option>${esc(category)}</option>`));
  config.clubs.forEach(item => $('#regClub').insertAdjacentHTML('beforeend', `<option value="${item.id}">${esc(item.name)}</option>`));
  ['#p1Email', '#p2Email'].forEach(selector => { $(selector).required = false; $(selector).parentElement.firstChild.textContent = 'Email (optional)'; });
  $('#regCategory').onchange = fillPairSlots; $('#regClub').onchange = fillPairSlots; $('#registrationSearch').oninput = render; $('#cancelEdit').onclick = resetForm;
  $('#staffLogin').onclick = async () => { $('#loginError').textContent = 'Signing in…'; try { await login($('#staffEmail').value.trim(), $('#staffPassword').value); } catch (_) { $('#loginError').textContent = 'Sign-in failed or this account lacks registration access.'; } };
  $('#registrationForm').onsubmit = async event => { event.preventDefault(); const selectedClub = club(), data = { category: $('#regCategory').value, club: selectedClub.id, clubName: selectedClub.name, pairCode: $('#regPair').value, status: $('#regStatus').value, players: [{ fullName: $('#p1Name').value.trim(), email: $('#p1Email').value.trim().toLowerCase(), dupr: $('#p1Dupr').value.trim() }, { fullName: $('#p2Name').value.trim(), email: $('#p2Email').value.trim().toLowerCase(), dupr: $('#p2Dupr').value.trim() }] }; const duplicate = registrations.find(row => row.id !== editingId && row.category === data.category && row.club === data.club && row.pairCode === data.pairCode && row.status !== 'withdrawn'); if (duplicate) return $('#formError').textContent = `${data.pairCode} is already assigned in this category.`; try { if (editingId) { const previous = registrations.find(row => row.id === editingId); await updateRegistration(editingId, data); applyPairToRoster({...data,id:editingId}, previous); } else { const result = await createRegistration(data); applyPairToRoster({...data,id:result.id}); } resetForm(); $('#formError').textContent = ''; toast('Registration securely saved.'); } catch (_) { $('#formError').textContent = 'Could not save. Confirm this account has Match Control access.'; } };
  watchAuth(user => {
    $('#registrationWorkspace').hidden = true;
    if (!user) { $('#registrationLogin').hidden = false; $('#registrationSession')?.remove(); $('#loginError').textContent = ''; return; }
    $('#staffEmail').value = user.email; $('#loginError').textContent = `Signed in as ${user.email}. Verifying Registration Desk access…`;
    watchControl(incoming => { state = incoming; fillPairSlots(); }, () => { $('#loginError').textContent = 'This account cannot read the tournament. Sign out and use an authorized account.'; });
    watchRegistrations(items => { registrations = items; $('#registrationLogin').hidden = true; if (!$('#registrationSession')) $('#registrationWorkspace').insertAdjacentHTML('beforebegin', `<section class="field-card session-row" id="registrationSession"><div><span class="eyebrow">Registration Desk active</span><b>${esc(user.email)}</b></div><button class="action alt" id="registrationLogout" type="button">Switch account</button></section>`); $('#registrationLogout').onclick = logout; $('#registrationWorkspace').hidden = false; render(); }, () => { $('#registrationLogin').hidden = false; if (!$('#staffLogout')) { $('#staffLogin').insertAdjacentHTML('afterend', '<button class="action alt" id="staffLogout" type="button">Sign out / switch account</button>'); $('#staffLogout').onclick = logout; } $('#loginError').textContent = 'Signed in, but Registration Desk permission is missing. An administrator must grant it in Match Control → Settings.'; });
  });
})();
