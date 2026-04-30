/**
 * Script d'exploration de la page Facturation IAM
 * pour trouver comment récupérer l'historique complet
 */
require("dotenv").config();
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE_URL = "https://espacebusiness.iam.ma/Entreprise/Pages/login.aspx";

async function explore() {
  const username = process.env.IAM_USERNAME;
  const password = process.env.IAM_PASSWORD;
  if (!username || !password) { console.error("❌ Credentials manquants"); process.exit(1); }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(120000);

  const outputDir = path.join(__dirname, "..", "data");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  try {
    // LOGIN
    console.log("📡 Login...");
    for (let navAttempt = 0; navAttempt < 3; navAttempt++) {
      try {
        await page.goto(BASE_URL, { waitUntil: "load", timeout: 120000 });
        break;
      } catch (e) {
        console.log(`   ⚠️ Tentative ${navAttempt + 1} lente...`);
        if (await page.$('input[type="text"]')) break;
      }
    }
    for (let i = 0; i < 6; i++) {
      if (await page.$('input[type="text"]')) break;
      console.log(`   Attente login... (${i+1})`);
      await page.waitForTimeout(5000);
    }
    const uInput = await page.$('input[type="text"]');
    const pInput = await page.$('input[type="password"]');
    if (!uInput || !pInput) throw new Error("Champs login non trouvés");
    await uInput.fill(username);
    await pInput.fill(password);
    await page.evaluate(() => document.getElementById('lnkBtnConnex')?.click());
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(5000);

    if (page.url().includes('login')) {
      console.log("   ⚠️ Toujours sur login, retry...");
      await page.evaluate(() => document.getElementById('lnkBtnConnex')?.click());
      await page.waitForTimeout(10000);
    }
    console.log(`✅ Connecté ! URL: ${page.url()}`);

    // FACTURATION
    console.log("\n📊 Navigation vers Facturation...");
    try {
      await page.goto('https://espacebusiness.iam.ma/entreprise/Pages/Facturation.aspx', { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch (e) {
      console.log("   ⚠️ Navigation lente, attente...");
    }
    await page.waitForTimeout(8000);
    console.log(`   URL: ${page.url()}`);
    await page.screenshot({ path: path.join(outputDir, 'explore-facturation.png'), fullPage: true, timeout: 15000 }).catch(() => {});

    // Explorer TOUS les éléments interactifs de la page
    const pageElements = await page.evaluate(() => {
      const info = {
        buttons: [],
        links: [],
        selects: [],
        inputs: [],
        paginationOrMore: [],
        allText: '',
      };

      // Boutons
      document.querySelectorAll('button, input[type="button"], input[type="submit"], a[id]').forEach(el => {
        const text = (el.textContent || el.value || '').trim();
        if (text.length > 0 || el.id) {
          info.buttons.push({
            tag: el.tagName, id: el.id, text: text.substring(0, 80),
            href: el.href || '', visible: el.offsetWidth > 0,
            onclick: el.getAttribute('onclick') || el.getAttribute('href') || ''
          });
        }
      });

      // Links avec PostBack (ASP.NET)
      document.querySelectorAll('a[href*="PostBack"], a[href*="doPostBack"]').forEach(el => {
        info.links.push({
          id: el.id, text: (el.textContent || '').trim().substring(0, 60),
          href: el.href.substring(0, 200)
        });
      });

      // Selects
      document.querySelectorAll('select').forEach(sel => {
        const opts = [];
        sel.querySelectorAll('option').forEach(o => opts.push({ value: o.value, text: o.textContent.trim(), selected: o.selected }));
        info.selects.push({ id: sel.id, name: sel.name, opts });
      });

      // Inputs (date pickers, etc.)
      document.querySelectorAll('input[type="date"], input[type="text"][id*="date" i], input[id*="Date" i], input[id*="mois" i], input[id*="period" i]').forEach(inp => {
        info.inputs.push({ id: inp.id, name: inp.name, type: inp.type, value: inp.value, placeholder: inp.placeholder });
      });

      // Pagination or "voir plus" or "historique" links
      document.querySelectorAll('a, button, input').forEach(el => {
        const text = (el.textContent || el.value || '').trim().toLowerCase();
        if (text.includes('suivant') || text.includes('next') || text.includes('plus') || text.includes('page')
            || text.includes('précédent') || text.includes('prev') || text.includes('historique')
            || text.includes('tout') || text.includes('all') || /^\d+$/.test(text)) {
          info.paginationOrMore.push({
            tag: el.tagName, id: el.id, text: (el.textContent || el.value || '').trim().substring(0, 60),
            href: el.href || ''
          });
        }
      });

      // Full page text for context
      info.allText = (document.body?.innerText || '').substring(0, 8000);

      return info;
    });

    console.log("\n=== BOUTONS & LIENS AVEC ID ===");
    for (const b of pageElements.buttons.filter(b => b.visible)) {
      console.log(`   [${b.tag}#${b.id}] "${b.text}" ${b.onclick ? '→ ' + b.onclick.substring(0, 100) : ''}`);
    }

    console.log("\n=== LIENS POSTBACK ===");
    for (const l of pageElements.links) {
      console.log(`   [${l.id}] "${l.text}" → ${l.href.substring(0, 120)}`);
    }

    console.log("\n=== SELECTS ===");
    for (const s of pageElements.selects) {
      console.log(`   #${s.id}: ${s.opts.map(o => `"${o.text}"(${o.value})${o.selected ? '*' : ''}`).join(', ')}`);
    }

    console.log("\n=== INPUTS DATE/PERIODE ===");
    for (const i of pageElements.inputs) {
      console.log(`   #${i.id} type=${i.type} value="${i.value}" placeholder="${i.placeholder}"`);
    }

    console.log("\n=== PAGINATION / VOIR PLUS ===");
    for (const p of pageElements.paginationOrMore) {
      console.log(`   [${p.tag}#${p.id}] "${p.text}" → ${p.href.substring(0, 120)}`);
    }

    // Sauvegarder le HTML complet
    const html = await page.content();
    fs.writeFileSync(path.join(outputDir, 'telecom-facturation-full.html'), html, 'utf-8');
    console.log("\n📄 HTML sauvegardé: telecom-facturation-full.html");

    // Screenshot
    await page.screenshot({ path: path.join(outputDir, 'telecom-facturation-full.png'), fullPage: true, timeout: 15000 }).catch(() => {});

    // Texte de la page (extrait)
    console.log("\n=== TEXTE PAGE (extrait) ===");
    console.log(pageElements.allText.substring(0, 3000));

  } catch (error) {
    console.error("❌ Erreur:", error.message);
  } finally {
    await browser.close();
    console.log("\n🏁 Terminé.");
  }
}

explore();
