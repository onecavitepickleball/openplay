const key='matchday.deployedRevision';
const reloadKey='matchday.reloadRevision';
let reloading=false, checking=null;
async function check(){
  if (checking) return checking;
  checking=(async()=>{
  try{
    const controller=new AbortController(), timeout=setTimeout(()=>controller.abort(),8000);
    const response=await fetch(new URL(`build.json?t=${Date.now()}`,import.meta.url),{cache:'no-store',signal:controller.signal});
    clearTimeout(timeout);
    if(!response.ok)return;
    const {revision}=await response.json(),previous=localStorage.getItem(key),attempted= sessionStorage.getItem(reloadKey);
    if(previous&&revision&&previous!==revision&&attempted!==revision&&!reloading){
      reloading=true;localStorage.setItem(key,revision);
      // Session marker prevents a failed cache purge or focus event from looping.
      sessionStorage.setItem(reloadKey,revision);
      if('caches'in window)await Promise.allSettled((await caches.keys()).map(name=>caches.delete(name)));
      const url=new URL(location.href);url.searchParams.set('_build',revision.slice(0,12));location.replace(url.href);return;
    }
    if(revision)localStorage.setItem(key,revision);
  }catch(_){/* Stay usable offline and try again on the next interval. */}
  })().finally(()=>{checking=null});
  return checking;
}
check();setInterval(check,60000);window.addEventListener('focus',()=>{if(document.visibilityState==='visible')check()});
