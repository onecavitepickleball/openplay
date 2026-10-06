// Tournament-only offline shell. Never cache Firebase requests or live API data.
const CACHE='matchday-shell-__MATCHDAY_REVISION__';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  await Promise.all((await caches.keys()).filter(name=>name.startsWith('matchday-shell-')&&name!==CACHE).map(name=>caches.delete(name)));
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith('/tournament/')||url.pathname.endsWith('/build.json'))return;
  if(request.mode!=='navigate'&&!/\.(js|css|png|jpg|jpeg|svg|webp|woff2)$/.test(url.pathname))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    const key=request.mode==='navigate'?url.origin+url.pathname:request;
    const cached=await cache.match(key);
    if(url.searchParams.has('v')&&request.mode!=='navigate'&&cached)return cached;
    try{const response=await fetch(request);if(response.ok)await cache.put(key,response.clone());return response}
    catch(error){if(cached)return cached;throw error}
  })());
});
