const fs=require('fs'),p=require('path');
const R=process.cwd();
const parser=require(p.join(R,'node_modules/@babel/parser'));
const traverse=require(p.join(R,'node_modules/@babel/traverse')).default;
const OUT=p.join(R,'src/modules');
const files=[]; (function w(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=p.join(d,e.name);e.isDirectory()?w(f):(e.name.endsWith('.jsx')&&files.push(f));}})(OUT);

// global exported name set
const exported=new Set();
for(const f of files){const m=fs.readFileSync(f,'utf8').match(/\nexport \{([^}]*)\};/);if(m)m[1].split(',').forEach(s=>exported.add(s.trim()));}

let problems=0, totalFree=0;
const missingByFile={};
for(const f of files){
  const code=fs.readFileSync(f,'utf8');
  const ast=parser.parse(code,{sourceType:'module',plugins:['jsx','classProperties','optionalChaining','nullishCoalescingOperator','objectRestSpread']});
  const missing=new Set();
  traverse(ast,{Program(path){
    const g=path.scope.globals; // free identifiers not bound in this module
    for(const nm of Object.keys(g)){ totalFree++; if(exported.has(nm)) missing.add(nm); }
    path.stop();
  }});
  if(missing.size){ problems++; missingByFile[p.relative(OUT,f)]=[...missing]; }
}
console.log('modules scanned:',files.length);
console.log('files with UNRESOLVED top-level refs:',problems);
const ents=Object.entries(missingByFile);
ents.slice(0,15).forEach(([f,ns])=>console.log('  ',f,'->',ns.join(', ')));
if(ents.length>15) console.log('  ... +',ents.length-15,'more');
