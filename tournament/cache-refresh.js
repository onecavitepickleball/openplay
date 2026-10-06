// Never interrupt a match, signature or form because a deployment changed.
const key='matchday.deployedRevision';
let checking=null,offered='';
async function check(){
  if(checking||navigator.onLine===false)return checking;
  checking=(async()=>{
    let timeout;
    try{
      const controller=new AbortController();timeout=setTimeout(()=>controller.abort(),8000);
      const response=await fetch(new URL('build.json?t='+Date.now(),import.meta.url),{cache:'no-store',signal:controller.signal});
      if(!response.ok)return;
      const {revision}=await response.json();
      if(!revision||revision.includes('{{'))return;
      const previous=localStorage.getItem(key);
      if(!previous){localStorage.setItem(key,revision);return}
      if(previous===revision||offered===revision)return;
      offered=revision;document.getElementById('matchdayUpdate')?.remove();
      const notice=document.createElement('aside');notice.id='matchdayUpdate';notice.setAttribute('role','status');
      notice.style.cssText='position:fixed;bottom:16px;left:16px;right:16px;max-width:560px;margin:auto;z-index:100000;background:#06364d;color:white;padding:16px;border-radius:14px;box-shadow:0 8px 32px #0005;font:14px/1.5 system-ui';
      const message=document.createElement('span');message.textContent='Matchday update ready. Finish and save your current work before reloading. ';
      const button=document.createElement('button');button.type='button';button.textContent='Reload when ready';button.style.cssText='padding:10px 14px;margin-top:8px;border:0;border-radius:8px;background:#b6ff3c;color:#06364d;font-weight:700;cursor:pointer';
      button.onclick=()=>{localStorage.setItem(key,revision);const url=new URL(location.href);url.searchParams.set('_build',revision);location.replace(url.href)};
      const later=document.createElement('button');later.type='button';later.textContent='Later';later.style.cssText='margin-left:12px;padding:10px;background:none;color:white;border:1px solid #fff8;border-radius:8px;cursor:pointer';later.onclick=()=>notice.remove();
      notice.append(message,button,later);document.body.append(notice);
    }catch(_){/* Offline or restricted storage must not block the app. */}finally{clearTimeout(timeout)}
  })().finally(()=>{checking=null});return checking;
}
check();setInterval(check,60000);window.addEventListener('focus',()=>{if(document.visibilityState==='visible')check()});
