import { loadTournamentContext, eventUrl } from './event-context.js';

try {
  await loadTournamentContext();
} catch (error) {
  console.error('Tournament startup failed.', error);
  document.body.innerHTML = `<main style="min-height:100vh;display:grid;place-items:center;padding:24px;background:#edf3f6;color:#09283a;font-family:system-ui,sans-serif"><section style="max-width:520px;padding:32px;border-radius:24px;background:#fff;box-shadow:0 18px 48px #09283a24"><p style="font-size:12px;font-weight:800;letter-spacing:.12em;color:#1773a6">TOURNAMENT PORTAL</p><h1 style="margin:.25rem 0 1rem">We could not open this tournament.</h1><p style="line-height:1.55">Your session may have expired or the connection was interrupted. Return to My Tournaments, sign in if needed, then reopen the event.</p><a href="./" style="display:inline-block;margin-top:12px;padding:12px 18px;border-radius:10px;background:#086593;color:white;font-weight:800;text-decoration:none">Return to My Tournaments</a></section></main>`;
}

function rewriteEventLinks(root=document){root.querySelectorAll?.('a[href]').forEach(anchor=>{if(anchor.origin===location.origin&&/\/(registration|check-in|referee|score-kiosk|broadcast)\/?$/.test(anchor.pathname))anchor.href=eventUrl(anchor.href)})}
rewriteEventLinks();new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{if(node.nodeType===1)rewriteEventLinks(node)}))).observe(document.body,{childList:true,subtree:true});

const moduleRevision = new URL(import.meta.url).searchParams.get('boot') || new URL(import.meta.url).searchParams.get('v') || Date.now();
try {
  await import(`./app.js?v=${encodeURIComponent(moduleRevision)}`);
} catch (error) {
  console.error('Match Control application failed to load.', error);
  document.body.innerHTML = `<main style="min-height:100vh;display:grid;place-items:center;padding:24px;background:#edf3f6;color:#09283a;font-family:system-ui,sans-serif"><section style="max-width:560px;padding:32px;border-radius:24px;background:#fff;box-shadow:0 18px 48px #09283a24"><p style="font-size:12px;font-weight:800;letter-spacing:.12em;color:#1773a6">TOURNAMENT PORTAL</p><h1 style="margin:.25rem 0 1rem">Match Control could not start.</h1><p style="line-height:1.55">${String(error?.message || 'An application module could not be loaded.').replace(/[&<>]/g, '')}</p><a href="./" style="display:inline-block;margin-top:12px;padding:12px 18px;border-radius:10px;background:#086593;color:white;font-weight:800;text-decoration:none">Return to My Tournaments</a></section></main>`;
}
