/* verify-fidelity — chaque statement top-level de src/modules doit venir VERBATIM
   de public/app.jsx.

   Deux écarts sont produits par l'extraction elle-même et ne sont donc pas des
   divergences de code :
     - setter généré : `X = rhs` devient `__set_X(rhs)` quand un binding est
       écrit depuis un autre module (cf. extract-modules.cjs §5) ;
     - réindentation : un module entier peut être désindenté du niveau 1 du
       monolithe (8 espaces), le contenu des lignes restant identique.
   Ils sont comptés à part, après avoir été explicitement reconnus. Tout autre
   écart est une divergence réelle : le rapport la détaille et le script sort en
   erreur — la fidélité est une garantie, pas une statistique. */
const fs=require('fs'),p=require('path'),R=process.cwd();
const parser=require(p.join(R,'node_modules/@babel/parser'));
const OUT=p.join(R,'src/modules');
const src=fs.readFileSync(p.join(R,'public/app.jsx'),'utf8');
const norm=s=>s.replace(/\r\n/g,'\n').trim();
const SRC=norm(src);
const files=[];(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);e.isDirectory()?w(f):(e.name.endsWith('.jsx')&&files.push(f));}})(OUT);

const PARSE_OPTS={sourceType:'module',plugins:['jsx','classProperties','optionalChaining','nullishCoalescingOperator','objectRestSpread']};

/* Noms des setters réellement générés dans l'arbre : seules ces écritures-là
   seront normalisées côté app.jsx. Un `__set_*` inventé ailleurs ne passerait
   pas — la normalisation reste bornée à ce que l'extraction a produit. */
const SETTERS=new Set();
for(const f of files){
  for(const m of fs.readFileSync(f,'utf8').matchAll(/export function (__set_([A-Za-z0-9$_]+))\s*\(/g)) SETTERS.add(m[2]);
}

/** `_x = rhs;` → `__set_x(rhs);` pour les seuls bindings dotés d'un setter généré. */
function applySetterRewrites(text){
  let out=text;
  for(const base of SETTERS){
    const re=new RegExp('(^|[^\\w.$])_*'+base.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*=\\s*([^;\\n]*);','g');
    out=out.replace(re,(mm,pre,rhs)=>`${pre}__set_${base}(${rhs.trim()});`);
  }
  return out;
}
/** Retire l'indentation de chaque ligne — ne masque que le blanc de tête. */
const deindent=s=>s.split('\n').map(l=>l.replace(/^[ \t]+/,'')).join('\n');

let stmtTotal=0, stmtVerbatim=0, generated=0, setterRewritten=0, reindented=0;
const bad=[];
for(const f of files){
  const code=fs.readFileSync(f,'utf8');
  const ast=parser.parse(code,PARSE_OPTS);
  for(const n of ast.program.body){
    if(n.type==='ImportDeclaration') continue;
    if(n.type==='ExportNamedDeclaration'&&!n.declaration) continue;   // export { ... }
    // generated setter: export function __set_*(v){...}
    if(n.type==='ExportNamedDeclaration'&&n.declaration&&n.declaration.type==='FunctionDeclaration'
       &&/^__set_/.test(n.declaration.id.name)){ generated++; continue; }
    const text=norm(code.slice(n.start,n.end));
    stmtTotal++;
    if(SRC.includes(text)){ stmtVerbatim++; continue; }
    // écart connu 1 — le monolithe réécrit en setters donne bien ce statement
    if(applySetterRewrites(SRC).includes(text)){ setterRewritten++; continue; }
    // écart connu 2 — même contenu, indentation retirée
    if(deindent(SRC).includes(deindent(text))){ reindented++; continue; }
    bad.push({file:p.relative(R,f),line:code.slice(0,n.start).split('\n').length,head:text.slice(0,90).replace(/\n/g,' ')});
  }
}
console.log('top-level statements checked :',stmtTotal);
console.log('byte-identical to app.jsx    :',stmtVerbatim);
console.log('generated setters (expected) :',generated);
console.log('setter call rewrites (idem)  :',setterRewritten);
console.log('reindented only (idem)       :',reindented);
console.log('NON-VERBATIM                 :',bad.length);
bad.slice(0,20).forEach(b=>console.log('   ',b.file+':'+b.line,'::',b.head));
if(bad.length){ console.error('\nverify-fidelity: divergence réelle vs public/app.jsx — voir ci-dessus.'); process.exit(1); }
