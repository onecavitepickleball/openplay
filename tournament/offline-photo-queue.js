const DB_NAME='matchday-offline';
const STORE='checkinPhotos';

function database(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open(DB_NAME,1);
    request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains(STORE)){const store=db.createObjectStore(STORE,{keyPath:'key'});store.createIndex('eventId','eventId')}};
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error);
  });
}

function transaction(mode,work){return database().then(db=>new Promise((resolve,reject)=>{const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE),result=work(store);tx.oncomplete=()=>resolve(result?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)}))}

export function queueCheckinPhoto(eventId,id,blob,record){return transaction('readwrite',store=>store.put({key:`${eventId}|${id}`,eventId,id,blob,record,createdAt:Date.now()}))}
export function removeCheckinPhoto(eventId,id){return transaction('readwrite',store=>store.delete(`${eventId}|${id}`))}
export async function queuedCheckinPhotos(eventId){const db=await database();return new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),index=tx.objectStore(STORE).index('eventId'),request=index.getAll(eventId);request.onsuccess=()=>resolve(request.result||[]);request.onerror=()=>reject(request.error)})}

export async function flushCheckinPhotos(eventId,upload,publish,onSaved=()=>{}){
  if(navigator.onLine===false)return 0;
  const queued=await queuedCheckinPhotos(eventId);let saved=0;
  for(const item of queued){
    try{
      const file=new File([item.blob],`player-${item.createdAt}.jpg`,{type:item.blob.type||'image/jpeg'}),photoURL=await upload(file,'player-checkin');
      if(!/^https:\/\//i.test(photoURL))throw new Error('PHOTO_URL_INVALID');
      const record={...item.record,photoURL,photoPending:false,photoSyncedAt:new Date().toISOString()};
      await publish(item.id,record);await removeCheckinPhoto(eventId,item.id);onSaved(item.id,record);saved++;
    }catch(error){console.warn('Queued check-in photo is still waiting to sync.',error);break}
  }
  return saved;
}
