const key='matchday.deployedRevision';
let reloading=false;
async function check(){
  try{
    const response=await fetch(new URL(`build.json?t=${Date.now()}`,import.meta.url),{cache:'no-store'});
    if(!response.ok)return;
    const {revision}=await response.json(),previous=localStorage.getItem(key);
    if(previous&&revision&&previous!==revision&&!reloading){
      reloading=true;localStorage.setItem(key,revision);
      if('caches'in window)await Promise.all((await caches.keys()).map(name=>caches.delete(name)));
      const url=new URL(location.href);url.searchParams.set('_build',revision.slice(0,12));location.replace(url.href);return;
    }
    if(revision)localStorage.setItem(key,revision);
  }catch(_){/* Stay usable offline and try again on the next interval. */}
}
check();setInterval(check,60000);window.addEventListener('focus',check);
