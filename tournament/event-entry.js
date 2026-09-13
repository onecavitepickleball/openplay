import { loadTournamentContext, eventUrl } from './event-context.js';

await loadTournamentContext();

function rewriteEventLinks(root=document){root.querySelectorAll?.('a[href]').forEach(anchor=>{if(anchor.origin===location.origin&&/\/(registration|check-in|referee|score-kiosk|broadcast)\/?$/.test(anchor.pathname))anchor.href=eventUrl(anchor.href)})}
rewriteEventLinks();new MutationObserver(records=>records.forEach(record=>record.addedNodes.forEach(node=>{if(node.nodeType===1)rewriteEventLinks(node)}))).observe(document.body,{childList:true,subtree:true});

await import(`./app.js?v=${encodeURIComponent(new URL(import.meta.url).searchParams.get('v') || 'dev')}`);
