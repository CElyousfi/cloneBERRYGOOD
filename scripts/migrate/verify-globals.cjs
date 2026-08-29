const fs=require('fs'),p=require('path'),R=process.cwd();
const parser=require(p.join(R,'node_modules/@babel/parser'));
const traverse=require(p.join(R,'node_modules/@babel/traverse')).default;
const names=new Set(require(p.join(__dirname,'graph.json')).flatMap(d=>d.names));
const out={};
for(const d of ['public/lib','public/components']){
  for(const f of fs.readdirSync(d)){
    if(!/\.jsx?$/.test(f)) continue;
    const fp=p.join(d,f); let ast;
    try{ ast=parser.parse(fs.readFileSync(fp,'utf8'),{sourceType:'script',errorRecovery:true,allowReturnOutsideFunction:true,plugins:['jsx','classProperties','optionalChaining','nullishCoalescingOperator','objectRestSpread']}); }
    catch(e){ out[fp]=['<parse error>']; continue; }
    const bare=new Set(), viaWindow=new Set();
    traverse(ast,{
      Identifier(ip){
        const nm=ip.node.name; if(!names.has(nm))return;
        if(!ip.isReferencedIdentifier())return;
        if(ip.scope.getBinding(nm))return;                  // locally declared -> not a global read
        if(ip.parent.type==='MemberExpression'&&ip.parent.property===ip.node&&!ip.parent.computed){
          if(ip.parent.object.type==='Identifier'&&ip.parent.object.name==='window'){ viaWindow.add(nm); }
          return;                                           // it's a property access, not a bare global
        }
        bare.add(nm);
      }
    });
    if(bare.size||viaWindow.size) out[fp]={bare:[...bare],viaWindow:[...viaWindow]};
  }
}
let bareTotal=0;
console.log('=== REAL global reads from external scripts ===');
for(const [f,v] of Object.entries(out)){
  if(v.length){console.log(f,v);continue;}
  if(v.bare.length) bareTotal+=v.bare.length;
  console.log(p.relative(R,f));
  if(v.bare.length)      console.log('    BARE GLOBAL (breaks under ES modules):',v.bare.join(', '));
  if(v.viaWindow.length) console.log('    window.X (safe if exposed)          :',v.viaWindow.join(', '));
}
console.log('\nTOTAL bare-global reads needing exposure:',bareTotal);
