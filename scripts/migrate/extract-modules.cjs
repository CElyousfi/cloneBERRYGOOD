const fs=require('fs'),p=require('path');
const R=process.cwd();
const parser=require(p.join(R,'node_modules/@babel/parser'));
const traverse=require(p.join(R,'node_modules/@babel/traverse')).default;
const RULES=require(p.join(__dirname,'module-map.cjs'));
const OUT=p.join(R,'src/modules');
const src=fs.readFileSync(p.join(R,'public/app.jsx'),'utf8');
const ast=parser.parse(src,{sourceType:'script',allowReturnOutsideFunction:true,errorRecovery:true,
  plugins:['jsx','classProperties','optionalChaining','nullishCoalescingOperator','objectRestSpread']});
const body=ast.program.body;

/* collecte les identifiants liés par un motif (Identifier, ObjectPattern, ArrayPattern, ...) */
function collectPatternNames(node,out){
  if(!node) return;
  switch(node.type){
    case 'Identifier': out.push(node.name); break;
    case 'ObjectPattern': node.properties.forEach(pr=>{
      if(pr.type==='ObjectProperty') collectPatternNames(pr.value,out);
      else if(pr.type==='RestElement') collectPatternNames(pr.argument,out); }); break;
    case 'ArrayPattern': node.elements.forEach(el=>collectPatternNames(el,out)); break;
    case 'AssignmentPattern': collectPatternNames(node.left,out); break;
    case 'RestElement': collectPatternNames(node.argument,out); break;
  }
}
/* ---------- 1. bindings ---------- */
const stmts=body.map((n,idx)=>{
  let names=[],kind='side-effect',mutable=false;
  if((n.type==='FunctionDeclaration'||n.type==='ClassDeclaration')&&n.id){names=[n.id.name];kind='decl';}
  else if(n.type==='VariableDeclaration'){
    names=[]; n.declarations.forEach(d=>collectPatternNames(d.id,names));
    if(names.length){kind='decl'; mutable=(n.kind==='let'||n.kind==='var');}
  }
  return {idx,node:n,names,kind,mutable,refs:[],writes:[]};
});
const owner=new Map(); stmts.forEach(s=>s.names.forEach(nm=>owner.set(nm,s.idx)));

/* ---------- 2. references + writes ---------- */
const writeSites=[]; // {targetName, stmtIdx, node}
traverse(ast,{Program(path){
  stmts.forEach(s=>{
    const refs=new Set(), writes=new Set();
    const add=nm=>{ if(owner.has(nm)&&!s.names.includes(nm)) refs.add(nm); };
    path.get('body')[s.idx].traverse({
      Identifier(ip){ if(!ip.isReferencedIdentifier())return;
        const b=ip.scope.getBinding(ip.node.name); if(b&&b.scope.block.type!=='Program')return; add(ip.node.name); },
      JSXIdentifier(ip){ const pt=ip.parent.type;
        if(pt==='JSXOpeningElement'||pt==='JSXClosingElement') add(ip.node.name);
        else if(pt==='JSXMemberExpression'&&ip.parent.object===ip.node) add(ip.node.name); },
      AssignmentExpression(ip){ const L=ip.node.left; if(L.type!=='Identifier')return;
        const b=ip.scope.getBinding(L.name); if(b&&b.scope.block.type!=='Program')return;
        if(owner.has(L.name)&&owner.get(L.name)!==s.idx){ writes.add(L.name); add(L.name);
          writeSites.push({target:L.name,stmtIdx:s.idx,node:ip.node}); } }
    });
    s.refs=[...refs]; s.writes=[...writes];
  });
  path.stop();
}});

/* ---------- 3. placement rules for mutable shared state ---------- */
const writersOf=new Map(); // name -> Set(stmtIdx)
writeSites.forEach(w=>{ if(!writersOf.has(w.target)) writersOf.set(w.target,new Set()); writersOf.get(w.target).add(w.stmtIdx); });

const toBootstrap=new Set();   // decl stmt idx that must live inside bootstrap
const mergeInto=new Map();     // decl stmt idx -> host stmt idx
const setterFor=new Map();     // name -> setter fn name
for(const [name,wset] of writersOf){
  const oIdx=owner.get(name);
  const ws=[...wset];
  const declWriters=ws.filter(i=>stmts[i].kind==='decl');
  if(declWriters.length===0){ toBootstrap.add(oIdx); continue; }   // Rule A: only side-effect writers
  mergeInto.set(oIdx,declWriters[0]);                              // Rule B: host = first decl writer
  if(declWriters.length>1) setterFor.set(name,'__set_'+name.replace(/^_+/,''));
}

/* ---------- 4. module assignment ---------- */
function moduleFor(n){ for(const [re,m] of RULES) if(re.test(n)) return m; return 'shared'; }

/* resolve final host for each decl */
const hostOf=new Map();
stmts.filter(s=>s.kind==='decl').forEach(s=>{
  let h=s.idx, guard=0;
  while(mergeInto.has(h)&&guard++<10) h=mergeInto.get(h);
  hostOf.set(s.idx,toBootstrap.has(s.idx)?'BOOTSTRAP':h);
});
const hosts=[...new Set([...hostOf.values()].filter(v=>v!=='BOOTSTRAP'))];
const hostMeta=new Map();
const BASE_OVERRIDE={useState:'reactHooks'};
hosts.forEach(h=>{ const first=stmts[h].names[0]; const base=BASE_OVERRIDE[first]||first; const m=moduleFor(first);
  hostMeta.set(h,{module:m,file:`${m}/${base}.jsx`,base}); });

const fileOf=new Map(); // binding name -> file
stmts.filter(s=>s.kind==='decl').forEach(s=>{
  const h=hostOf.get(s.idx); if(h==='BOOTSTRAP'){ s.names.forEach(n=>fileOf.set(n,'bootstrap.jsx')); return; }
  s.names.forEach(n=>fileOf.set(n,hostMeta.get(h).file));
});

/* ---------- 5. verbatim slicing (+ minimal setter rewrites) ---------- */
function sliceOf(s){
  let start=s.node.start;
  const lc=s.node.leadingComments;
  if(lc&&lc.length){ const prevEnd=s.idx>0?body[s.idx-1].end:0; const f=lc.find(c=>c.start>=prevEnd); if(f) start=f.start; }
  let text=src.slice(start,s.node.end);
  // rewrite external writes that need a setter
  const edits=writeSites.filter(w=>w.stmtIdx===s.idx&&setterFor.has(w.target)
      &&hostOf.get(owner.get(w.target))!==hostOf.get(s.idx))
    .sort((a,b)=>b.node.start-a.node.start);
  for(const e of edits){
    const a=e.node.start-start, b=e.node.end-start;
    const rhs=src.slice(e.node.right.start,e.node.right.end);
    text=text.slice(0,a)+`${setterFor.get(e.target)}(${rhs})`+text.slice(b);
    REWRITES.push({file:fileOf.get(s.names[0]),target:e.target,
      line:src.slice(0,e.node.start).split('\n').length,
      before:src.slice(e.node.start,e.node.end),after:`${setterFor.get(e.target)}(${rhs})`});
  }
  return text;
}
const REWRITES=[];

/* ---------- 6. emit ---------- */
fs.rmSync(OUT,{recursive:true,force:true});
function importsBlock(fromFile,refs,selfNames){
  const bySrc=new Map();
  for(const r of refs){
    let f=fileOf.get(r); if(!f||f===fromFile) continue;
    if(selfNames.includes(r)) continue;
    let rel=p.relative(p.dirname(p.join(OUT,fromFile)),p.join(OUT,f)).replace(/\\/g,'/');
    if(!rel.startsWith('.')) rel='./'+rel;
    const nm = setterFor.has(r)&&fileOf.get(r)!==fromFile ? setterFor.get(r) : r;
    if(!bySrc.has(rel)) bySrc.set(rel,new Set()); bySrc.get(rel).add(nm);
  }
  return [...bySrc.entries()].sort().map(([f,ns])=>`import { ${[...ns].sort().join(', ')} } from '${f}';`).join('\n');
}

let written=0;
for(const h of hosts){
  const meta=hostMeta.get(h);
  const members=stmts.filter(s=>s.kind==='decl'&&hostOf.get(s.idx)===h).sort((a,b)=>a.idx-b.idx);
  const selfNames=members.flatMap(m=>m.names);
  const allRefs=[...new Set(members.flatMap(m=>m.refs))];
  const dir=p.join(OUT,meta.module); fs.mkdirSync(dir,{recursive:true});
  const code=members.map(sliceOf).join('\n\n');
  const setters=selfNames.filter(n=>setterFor.has(n))
    .map(n=>`\nexport function ${setterFor.get(n)}(v){ ${n} = v; }`).join('');
  const header=`/* Migré depuis public/app.jsx — extraction verbatim (non-régression).\n   Module: ${meta.module} | Déclaration(s): ${selfNames.join(', ')} */\n`;
  fs.writeFileSync(p.join(OUT,meta.file),
    header+(importsBlock(meta.file,allRefs,selfNames)||'')+'\n\n'+code+'\n'+setters+`\nexport { ${selfNames.join(', ')} };\n`);
  written++;
}

/* bootstrap */
{
  const side=stmts.filter(s=>s.kind==='side-effect');
  const bsDecls=stmts.filter(s=>s.kind==='decl'&&hostOf.get(s.idx)==='BOOTSTRAP');
  const all=[...side,...bsDecls].sort((a,b)=>a.idx-b.idx);
  const selfNames=bsDecls.flatMap(d=>d.names);
  const refs=[...new Set(all.flatMap(s=>s.refs))];
  fs.writeFileSync(p.join(OUT,'bootstrap.jsx'),
    `/* Instructions à effet de bord du monolithe — ordre d'origine strictement préservé. */\n`
    +(importsBlock('bootstrap.jsx',refs,selfNames)||'')+'\n\n'+all.map(sliceOf).join('\n\n')
    +(selfNames.length?`\n\nexport { ${selfNames.join(', ')} };\n`:'\n'));
}

/* barrels */
const mods=[...new Set(hosts.map(h=>hostMeta.get(h).module))].sort();
for(const m of mods){
  const list=hosts.filter(h=>hostMeta.get(h).module===m).map(h=>hostMeta.get(h));
  fs.writeFileSync(p.join(OUT,m,'index.js'),
    `/* Barrel ${m} — ${list.length} fichiers */\n`+list.map(x=>`export * from './${x.base}.jsx';`).sort().join('\n')+'\n');
}
fs.writeFileSync(p.join(OUT,'index.js'),mods.map(m=>`export * from './${m}/index.js';`).join('\n')+'\n');

console.log('module files written:',written,'| modules:',mods.join(', '));
console.log('merged-into-host decls:',mergeInto.size,'| moved to bootstrap:',toBootstrap.size);
console.log('generated setters:',[...setterFor.keys()].join(', ')||'(none)');
console.log('SOURCE LINE REWRITES:',REWRITES.length);
REWRITES.forEach(r=>console.log(`   app.jsx:${r.line}  "${r.before}"  ->  "${r.after}"   [${r.file}]`));
const counts={}; hosts.forEach(h=>{const m=hostMeta.get(h).module;counts[m]=(counts[m]||0)+1;});
console.log('per-module file counts:',JSON.stringify(counts));
