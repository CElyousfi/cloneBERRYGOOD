const fs=require('fs'),p=require('path'),R=process.cwd();
const parser=require(p.join(R,'node_modules/@babel/parser'));
const OUT=p.join(R,'src/modules');
const src=fs.readFileSync(p.join(R,'public/app.jsx'),'utf8');
const norm=s=>s.replace(/\r\n/g,'\n').trim();
const SRC=norm(src);
const files=[];(function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);e.isDirectory()?w(f):(e.name.endsWith('.jsx')&&files.push(f));}})(OUT);
let stmtTotal=0, stmtVerbatim=0, generated=0;
const bad=[];
for(const f of files){
  const code=fs.readFileSync(f,'utf8');
  const ast=parser.parse(code,{sourceType:'module',plugins:['jsx','classProperties','optionalChaining','nullishCoalescingOperator','objectRestSpread']});
  for(const n of ast.program.body){
    if(n.type==='ImportDeclaration') continue;
    if(n.type==='ExportNamedDeclaration'&&!n.declaration) continue;   // export { ... }
    // generated setter: export function __set_*(v){...}
    if(n.type==='ExportNamedDeclaration'&&n.declaration&&n.declaration.type==='FunctionDeclaration'
       &&/^__set_/.test(n.declaration.id.name)){ generated++; continue; }
    const text=norm(code.slice(n.start,n.end));
    stmtTotal++;
    if(SRC.includes(text)) stmtVerbatim++;
    else bad.push({file:p.relative(R,f),line:code.slice(0,n.start).split('\n').length,head:text.slice(0,90).replace(/\n/g,' ')});
  }
}
console.log('top-level statements checked :',stmtTotal);
console.log('byte-identical to app.jsx    :',stmtVerbatim);
console.log('generated setters (expected) :',generated);
console.log('NON-VERBATIM                 :',bad.length);
bad.slice(0,20).forEach(b=>console.log('   ',b.file+':'+b.line,'::',b.head));
