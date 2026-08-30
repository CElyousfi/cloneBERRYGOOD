const { chromium } = require(process.env.PW);
const fs=require('fs');
(async ()=>{
  const url=process.argv[2], out=process.argv[3];
  const b=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
  const pg=await b.newPage();
  let cerr=[];
  pg.on('console',m=>{ if(m.type()==='error') cerr.push(m.text().split('\n')[0].slice(0,160)); });
  pg.on('pageerror',e=>cerr.push('PAGEERROR: '+String(e.message).split('\n')[0].slice(0,160)));
  try{ await pg.goto(url,{waitUntil:'domcontentloaded',timeout:45000}); }catch(e){}
  await pg.waitForTimeout(6000);

  const profiles=await pg.$$eval('.profile-chip',els=>els.map(e=>e.innerText.trim()));
  const result={profiles:[],tabs:[]};
  for(const prof of profiles){
    // select profile
    const ok=await pg.evaluate(p=>{const el=[...document.querySelectorAll('.profile-chip')].find(x=>x.innerText.trim()===p); if(el){el.click();return true;} return false;},prof);
    if(!ok) continue;
    await pg.waitForTimeout(1200);
    // open "Plus" if present to expose more-menu-items
    const tabs=await pg.evaluate(()=>{
      const more=[...document.querySelectorAll('.bnav-item')].find(x=>/Plus/i.test(x.innerText));
      if(more) more.click();
      return null;
    });
    await pg.waitForTimeout(400);
    const labels=await pg.evaluate(()=>[...document.querySelectorAll('.bnav-item,.more-menu-item')]
        .map(e=>e.innerText.trim()).filter(t=>t&&!/^Plus$/i.test(t)));
    result.profiles.push({profile:prof,tabCount:labels.length});
    for(const lab of labels){
      cerr=[];
      const clicked=await pg.evaluate(l=>{
        const more=[...document.querySelectorAll('.bnav-item')].find(x=>/Plus/i.test(x.innerText));
        let el=[...document.querySelectorAll('.bnav-item,.more-menu-item')].find(x=>x.innerText.trim()===l);
        if(!el&&more){ more.click(); el=[...document.querySelectorAll('.more-menu-item')].find(x=>x.innerText.trim()===l); }
        if(el){ el.click(); return true; } return false;
      },lab);
      if(!clicked){ result.tabs.push({profile:prof,tab:lab,status:'NOT_FOUND'}); continue; }
      await pg.waitForTimeout(700);
      const sig=await pg.evaluate(()=>{
        const r=document.getElementById('root');
        const txt=(document.body.innerText||'');
        return { len:r?r.innerHTML.length:-1,
                 crash:/Erreur d'affichage|Une erreur|ErrorBoundary|ERREUR JS/i.test(txt),
                 words:txt.replace(/\s+/g,' ').trim().split(' ').length };
      });
      result.tabs.push({profile:prof,tab:lab,len:sig.len,words:sig.words,crash:sig.crash,
                        errs:[...new Set(cerr)].filter(e=>!/favicon|404|net::ERR|Failed to load resource/i.test(e)).slice(0,3)});
    }
  }
  fs.writeFileSync(out,JSON.stringify(result,null,1));
  console.log('profiles walked:',result.profiles.length,'| tab renders:',result.tabs.length);
  console.log('crashes:',result.tabs.filter(t=>t.crash).length,'| with errors:',result.tabs.filter(t=>t.errs&&t.errs.length).length);
  await b.close();
})();
