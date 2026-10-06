// Standalone, dependency-free export. No club pages, admin tools or credentials.
import {readdir,readFile,mkdir,writeFile,copyFile} from 'node:fs/promises';
import {resolve,dirname,relative,extname} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=resolve(root,'dist/matchday');
const excluded=new Set(['tests','google-sheets-backup']);
async function files(dir){
  const result=[];
  for(const entry of await readdir(dir,{withFileTypes:true})){
    if(entry.name.startsWith('.')||excluded.has(entry.name))continue;
    const path=resolve(dir,entry.name);
    if(entry.isDirectory())result.push(...await files(path));
    else if(/\.(html|js|css|json|svg|png|jpe?g|webp|woff2)$/i.test(path))result.push(path);
  }return result.sort();
}
const sources=await files(resolve(root,'tournament'));
const hash=createHash('sha256');
for(const file of sources)hash.update(relative(root,file)).update(await readFile(file));
hash.update(await readFile(fileURLToPath(import.meta.url)));
const revision=hash.digest('hex').slice(0,16);
for(const file of sources){
  const destination=resolve(output,relative(root,file));await mkdir(dirname(destination),{recursive:true});
  if(['.html','.js','.css','.json','.svg'].includes(extname(file))){
    let text=(await readFile(file,'utf8')).replace(/^---\r?\n(?:[\s\S]*?\r?\n)?---\r?\n/,'').replaceAll('{{ site.github.build_revision }}',revision).replaceAll('__MATCHDAY_REVISION__',revision);
    // Stamp every literal module dependency, not just the entry script.
    if(file.endsWith('.js'))text=text.replace(/(['"])(\.{1,2}\/[^'"\s?]+\.js)(?:\?[^'"]*)?\1/g,(_,quote,path)=>quote+path+'?v='+revision+quote);
    if(text.includes('{{')&&file.endsWith('build.json'))throw new Error('Unresolved build revision');
    await writeFile(destination,text);
  }else await copyFile(file,destination);
}
// Compatibility for saved event branding; new platform branding is Matchday.
await mkdir(resolve(output,'assets'),{recursive:true});
for(const name of ['logo-2026.png','favicon-32-v2.png'])await copyFile(resolve(root,'assets',name),resolve(output,'assets',name));
await writeFile(resolve(output,'index.html'),'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Matchday</title><script>location.replace("/tournament/"+location.search+location.hash)</script></head><body><a href="/tournament/">Open Matchday</a></body></html>');
await writeFile(resolve(output,'_redirects'),'/tournament /tournament/ 301\n');
await writeFile(resolve(output,'_headers'),'/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: SAMEORIGIN\n  Permissions-Policy: camera=(self), microphone=(), geolocation=()\n  Cache-Control: no-cache\n/tournament/build.json\n  Cache-Control: no-store\n/tournament/sw.js\n  Cache-Control: no-cache\n');
console.log(JSON.stringify({directory:output,revision,files:sources.length}));
