// Keep old printed links usable. No credentials or local data cross origins.
(()=>{
  if(!['www.onecavitepickleball.club','onecavitepickleball.club'].includes(location.hostname))return;
  const destination=new URL(location.pathname+location.search+location.hash,'https://matchday-tournaments.pages.dev');
  const path=location.pathname;
  const publicView=/^\/tournament\/(public|player)\//.test(path);
  const portal=/^\/tournament\/(index\.html)?$/.test(path);
  if(publicView){location.replace(destination.href);return}
  // Never forcibly discard offline operational edits or in-progress signatures.
  const show=()=>{
    const notice=document.createElement('aside');notice.setAttribute('role','status');
    notice.style.cssText='position:fixed;inset:auto 16px 16px;z-index:2147483646;max-width:640px;margin:auto;background:#06364d;color:white;padding:20px;border:2px solid #b6ff3c;border-radius:16px;font:15px/1.5 system-ui;box-shadow:0 8px 40px #0007';
    const title=document.createElement('strong');title.textContent='Matchday has its own home.';
    const copy=document.createElement('p');copy.textContent=portal?'Use your existing account at the new Matchday address. If you have offline work on this device, reconnect and finish syncing it before moving.':'Finish and sync your current work before moving. Existing tournaments and staff access are unchanged. Sign in once at the new address.';
    const link=document.createElement('a');link.href=destination.href;link.textContent='Open Matchday';link.style.cssText='display:inline-block;padding:10px 16px;border-radius:8px;background:#b6ff3c;color:#06364d;font-weight:800;text-decoration:none';
    const dismiss=document.createElement('button');dismiss.type='button';dismiss.textContent='Stay to finish syncing';dismiss.style.cssText='margin-left:12px;background:none;color:white;border:1px solid #fff8;padding:10px;border-radius:8px';dismiss.onclick=()=>notice.remove();
    notice.append(title,copy,link,dismiss);document.body.append(notice);
  };
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',show,{once:true});else show();
})();
