// Browser regressions with isolated Firebase fixtures; no production reads/writes.
const {readFileSync}=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {chromium}=require(process.env.MATCHDAY_PLAYWRIGHT || 'playwright');
const root=path.resolve(__dirname,'../..');
const sdk=`
const user={uid:'test-user',email:'organizer@example.test'};
export const getAuth=()=>({currentUser:user});
export const initializeApp=()=>({}),getApps=()=>[],getApp=()=>({});
export const getFirestore=()=>({}),initializeFirestore=()=>({}),persistentLocalCache=()=>({}),persistentMultipleTabManager=()=>({});
export const doc=(...args)=>({path:args.filter(x=>typeof x==='string').join('/')}),collection=doc;
export const serverTimestamp=()=>0,query=()=>({}),where=()=>({});
export const browserLocalPersistence={};
export const setPersistence=async()=>{},signInWithEmailAndPassword=async()=>({user}),createUserWithEmailAndPassword=signInWithEmailAndPassword,signOut=async()=>{};
export function onAuthStateChanged(auth,cb){queueMicrotask(()=>cb(auth.currentUser));return()=>{}}
export async function getDoc(ref){return {exists:()=>true,data:()=>({organizerStatus:'approved',displayName:'Test Organizer'})}}
export async function getDocs(ref){
  window.fixtureReads=(window.fixtureReads||0)+1;
  if(window.fixtureListError)throw new Error('unavailable');
  return {docs:[{id:'test-event',data:()=>({name:'Regression Tournament',roles:['owner'],competitionType:'standard',date:'2026-09-25'})}]};
}
export const setDoc=()=>new Promise(()=>{}),updateDoc=setDoc,deleteDoc=setDoc;
export const writeBatch=()=>({set(){},commit:setDoc});
export const onSnapshot=()=>()=>{};
export async function runTransaction(db,cb){
  window.fixtureClaims=(window.fixtureClaims||0)+1;
  if(window.fixtureMode==='hang')return new Promise(()=>{});
  if(window.fixtureMode==='success')return cb({get:async()=>({exists:()=>false,data:()=>undefined}),set(){}});
  if(window.fixtureMode==='conflict')return cb({get:async()=>({exists:()=>true,data:()=>({deviceId:'other-device',leaseUntilMs:Date.now()+60000})}),set(){}});
  throw Object.assign(new Error('permission-denied'),{code:'permission-denied'});
}
`;
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'chrome'});
  try{
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.hostname==='www.gstatic.com')return route.fulfill({contentType:'application/javascript',body:sdk});
      if(url.hostname!=='matchday.test')return route.fulfill({body:''});
      if(url.pathname==='/tournament/cache-refresh.js')return route.fulfill({contentType:'application/javascript',body:''});
      if(url.pathname==='/fixture')return route.fulfill({contentType:'text/html',body:'<!doctype html><body>Session test</body>'});
      const file=path.join(root,url.pathname.endsWith('/')?url.pathname+'index.html':url.pathname);
      if(process.env.MATCHDAY_BASELINE && ['/tournament/portal.js','/tournament/session-lock.js'].includes(url.pathname))return route.fulfill({contentType:'application/javascript',body:execFileSync('git',['show','4e4ed13:'+url.pathname.slice(1)],{cwd:root,encoding:'utf8'})});
      try{return route.fulfill({contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html',body:readFileSync(file,'utf8').replace(/^---\n---\n/,'')})}catch(_){return route.fulfill({status:404,body:''})}
    });
    await page.goto('https://matchday.test/tournament/');
    if(process.env.MATCHDAY_BASELINE){
      await page.waitForFunction(()=>window.fixtureClaims===1 && document.querySelector('#loginGate').hidden && document.querySelector('#portalWorkspace').hidden);
      assert.equal(await page.locator('#matchdaySessionLock').count(),0);
      console.log('REPRODUCED: deployed login hides both screens without recovery after session verification fails');
      return;
    }
    await page.getByRole('heading',{name:'Regression Tournament'}).waitFor();
    assert.equal(await page.locator('#portalWorkspace').isVisible(),true);
    assert.equal(await page.locator('#loginGate').isVisible(),false);
    assert.equal(await page.evaluate(()=>window.fixtureClaims||0),0);
    await page.getByRole('button',{name:'Create new tournament'}).click();
    assert.equal(await page.locator('#createModal').isVisible(),true);
    console.log('PASS: signed-in portal loads and buttons work despite unavailable session service and stalled directory write');
    await page.reload();
    await page.getByRole('heading',{name:'Regression Tournament'}).waitFor();
    console.log('PASS: returning authenticated session loads on ordinary reload');
    await page.addInitScript(()=>window.fixtureListError=true);
    await page.reload();
    await page.getByRole('button',{name:'Retry loading'}).waitFor();
    await page.evaluate(()=>window.fixtureListError=false);
    await page.getByRole('button',{name:'Retry loading'}).click();
    await page.getByRole('heading',{name:'Regression Tournament'}).waitFor();
    console.log('PASS: tournament read failure can be retried without signing in again');
    await page.goto('https://matchday.test/fixture');
    await page.evaluate(async()=>{
      const {createSessionLock}=await import('/tournament/session-lock.js');
      const sdk=await import('https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js');
      window.fixtureLock=createSessionLock({...sdk,db:{},auth:sdk.getAuth(),signOut:async()=>{}});
    });
    assert.equal(await page.evaluate(()=>window.fixtureLock.claim({uid:'test-user'})),false);
    assert.equal(await page.getByRole('button',{name:'Retry device access'}).isVisible(),true);
    console.log('PASS: failed device verification shows recovery controls instead of hiding the app');
    await page.evaluate(()=>window.fixtureMode='conflict');
    assert.equal(await page.evaluate(()=>window.fixtureLock.claim({uid:'test-user'})),false);
    assert.equal(await page.locator('#matchdaySessionLock').isVisible(),true);
    assert.match(await page.locator('#matchdaySessionTitle').textContent(),/active on another device/);
    console.log('PASS: another active device still blocks operational access');
    await page.evaluate(()=>window.fixtureMode='success');
    assert.equal(await page.evaluate(()=>window.fixtureLock.claim({uid:'test-user'})),true);
    assert.equal(await page.locator('#matchdaySessionLock').isVisible(),false);
    console.log('PASS: successful device verification opens operational access');
    await page.evaluate(()=>window.fixtureMode='hang');
    assert.equal(await page.evaluate(()=>window.fixtureLock.claim({uid:'test-user'})),false);
    assert.equal(await page.getByRole('button',{name:'Retry device access'}).isVisible(),true);
    console.log('PASS: stalled device verification ends with retry controls within 10 seconds');
    assert.deepEqual(errors,[]);
  }finally{await browser.close()}
})().catch(error=>{console.error(error);process.exitCode=1});
