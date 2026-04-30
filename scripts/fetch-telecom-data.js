/**
 * Script pour récupérer les données télécom depuis Espace Business IAM
 * Usage: node scripts/fetch-telecom-data.js
 *
 * Requiert un fichier .env avec:
 *   IAM_USERNAME=votre_identifiant
 *   IAM_PASSWORD=votre_mot_de_passe
 */

require("dotenv").config();
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE_URL = "https://espacebusiness.iam.ma/Entreprise/Pages/login.aspx";

async function fetchTelecomData() {
  const username = process.env.IAM_USERNAME;
  const password = process.env.IAM_PASSWORD;

  if (!username || !password) {
    console.error("❌ Identifiants manquants. Créez un fichier .env avec IAM_USERNAME et IAM_PASSWORD");
    process.exit(1);
  }

  console.log("🚀 Lancement du navigateur...");
  const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
  const browser = await chromium.launch({ headless: isCI });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  page.setDefaultNavigationTimeout(120000);

  const outputDir = path.join(__dirname, "..", "data");
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
  const timestamp = new Date().toISOString().slice(0, 10);

  // Mapping mois FR → numéro (toutes variantes d'accents possibles)
  const moisFR = {
    janvier:'01', jan:'01',
    fevrier:'02', 'février':'02', fev:'02', 'fév':'02',
    mars:'03', mar:'03',
    avril:'04', avr:'04',
    mai:'05',
    juin:'06',
    juillet:'07', jul:'07',
    aout:'08', 'août':'08',
    septembre:'09', sep:'09',
    octobre:'10', oct:'10',
    novembre:'11', nov:'11',
    decembre:'12', 'décembre':'12', dec:'12', 'déc':'12',
  };
  // Helper: normalise un nom de mois (enlève accents)
  function normalizeMois(str) {
    const s = str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return moisFR[s] || moisFR[str.toLowerCase()] || null;
  }

  try {
    // ===== 1. LOGIN =====
    console.log("📡 Connexion à Espace Business IAM...");
    // Le site IAM est souvent très lent — on tente plusieurs stratégies
    let pageLoaded = false;
    for (let navAttempt = 0; navAttempt < 3 && !pageLoaded; navAttempt++) {
      try {
        if (navAttempt > 0) console.log(`   Tentative ${navAttempt + 1}...`);
        await page.goto(BASE_URL, { waitUntil: "load", timeout: 120000 });
        pageLoaded = true;
      } catch (e) {
        console.log(`   ⚠️ Navigation lente (${e.message.split('\n')[0]})`);
        // Check if page partially loaded
        const hasInputs = await page.$('input[type="text"]').catch(() => null);
        if (hasInputs) { pageLoaded = true; break; }
        if (navAttempt < 2) await page.waitForTimeout(3000);
      }
    }
    // Attendre que les champs soient présents
    for (let attempt = 0; attempt < 4; attempt++) {
      const hasInputs = await page.$('input[type="text"]');
      if (hasInputs) break;
      console.log(`   Attente des champs de login... (${attempt + 1}/4)`);
      await page.waitForTimeout(5000);
    }

    const usernameInput = await page.$('input[type="text"]');
    const passwordInput = await page.$('input[type="password"]');
    if (!usernameInput || !passwordInput) throw new Error("Champs de connexion non trouvés");

    await usernameInput.fill(username);
    await passwordInput.fill(password);

    console.log("🔐 Envoi des identifiants...");
    await page.evaluate(() => document.getElementById('lnkBtnConnex')?.click());
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(5000);

    if (page.url().includes('login')) throw new Error("Login échoué");
    console.log("✅ Connecté !");

    // ===== 2. PAGE FACTURATION — Historique des factures globales =====
    console.log("\n📊 Navigation vers Facturation...");
    try {
      await page.goto('https://espacebusiness.iam.ma/entreprise/Pages/Facturation.aspx', { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch (e) {
      console.log("   ⚠️ Navigation lente...");
    }
    await page.waitForTimeout(5000);

    // Extraire le tableau des factures
    const factures = await page.evaluate(() => {
      const results = [];
      // Le tableau GvListeFacturePaye contient l'historique
      const rows = document.querySelectorAll('table tr');
      for (const row of rows) {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 5) {
          const mois = cells[1]?.textContent?.trim() || '';
          const montant = cells[2]?.textContent?.trim() || '';
          const solde = cells[3]?.textContent?.trim() || '';
          const statut = cells[4]?.textContent?.trim() || '';
          const reference = cells[5]?.textContent?.trim() || '';
          if (mois && /\d/.test(montant)) {
            results.push({ mois, montant, solde, statut, reference });
          }
        }
      }
      return results;
    });

    console.log(`   ${factures.length} factures trouvées dans l'historique:`);
    for (const f of factures) {
      console.log(`   • ${f.mois}: ${f.montant} DH (${f.statut}) — Réf: ${f.reference}`);
    }

    // ===== 3. PAGE DÉTAIL DE CONSOMMATION — Par ligne =====
    console.log("\n📱 Navigation vers Détail de consommation...");
    try {
      await page.goto('https://espacebusiness.iam.ma/entreprise/Pages/Detail-consommation.aspx', { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch (e) {
      console.log("   ⚠️ Navigation lente...");
    }
    await page.waitForTimeout(5000);
    await page.screenshot({ path: path.join(outputDir, "telecom-detail-conso.png"), timeout: 15000 }).catch(() => {});

    // Explorer la page de détail
    const detailInfo = await page.evaluate(() => {
      const info = { selects: [], tables: [], texts: [] };
      document.querySelectorAll('select').forEach(sel => {
        const opts = [];
        sel.querySelectorAll('option').forEach(o => {
          if (o.value !== '-1' && o.value !== '') opts.push({ value: o.value, text: o.textContent.trim() });
        });
        info.selects.push({ id: sel.id, name: sel.name, opts, totalOpts: sel.options.length });
      });
      document.querySelectorAll('table').forEach((table, idx) => {
        const rows = [];
        table.querySelectorAll('tr').forEach(tr => {
          const cells = [];
          tr.querySelectorAll('th, td').forEach(cell => cells.push(cell.textContent.trim().replace(/\s+/g, ' ').substring(0, 120)));
          if (cells.length > 0 && cells.some(c => c.length > 0)) rows.push(cells);
        });
        if (rows.length > 0) info.tables.push({ idx, rows: rows.slice(0, 20) });
      });
      // Page text excerpt
      info.bodyText = document.body.innerText.substring(0, 3000);
      return info;
    });

    console.log("\n=== DÉTAIL CONSO - SELECTS ===");
    for (const sel of detailInfo.selects) {
      console.log(`   #${sel.id} (${sel.totalOpts} options):`);
      for (const o of sel.opts.slice(0, 5)) console.log(`      ${o.value} = "${o.text}"`);
      if (sel.opts.length > 5) console.log(`      ... +${sel.opts.length - 5} options`);
    }

    console.log("\n=== DÉTAIL CONSO - TABLEAUX ===");
    for (const table of detailInfo.tables) {
      console.log(`\n   Tableau #${table.idx}:`);
      for (const row of table.rows.slice(0, 8)) console.log(`      ${row.join(' | ')}`);
      if (table.rows.length > 8) console.log(`      ... +${table.rows.length - 8} lignes`);
    }

    // ===== 4. EXPORTER LA LISTE DES CONTRATS (Excel) =====
    console.log("\n📥 Export des contrats...");
    try {
      await page.goto('https://espacebusiness.iam.ma/entreprise/Pages/Gestion-des-contrats.aspx', { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch (e) {}
    await page.waitForTimeout(5000);

    // Cliquer sur "Gérer les contrats"
    await page.evaluate(() => {
      const links = document.querySelectorAll('a, button, input');
      for (const el of links) {
        if ((el.textContent || el.value || '').includes('rer les contrats')) { el.click(); return; }
      }
    });
    await page.waitForTimeout(8000);

    // Extraire la liste des lignes/contrats directement du tableau
    const lignesContrats = await page.evaluate(() => {
      const lignes = [];
      document.querySelectorAll('table tr').forEach(tr => {
        const cells = tr.querySelectorAll('td');
        if (cells.length >= 3) {
          const numero = cells[0]?.textContent?.trim()?.replace(/\s/g, '') || '';
          const forfait = cells[1]?.textContent?.trim() || '';
          const dateActivation = cells[2]?.textContent?.trim() || '';
          if (/^0[6-7]\d{8}$/.test(numero)) {
            lignes.push({ numero, forfait, dateActivation });
          }
        }
      });
      return lignes;
    });

    console.log(`   ${lignesContrats.length} lignes mobiles trouvées`);
    for (const l of lignesContrats.slice(0, 5)) console.log(`      ${l.numero} — ${l.forfait}`);
    if (lignesContrats.length > 5) console.log(`      ... +${lignesContrats.length - 5} lignes`);

    // Tenter l'export Excel
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }).catch(() => null),
      page.evaluate(() => {
        const btn = document.getElementById('btnExport');
        if (btn) { btn.click(); return; }
        const els = document.querySelectorAll('input, button, a');
        for (const el of els) {
          if ((el.textContent || el.value || '').includes('Exporter')) { el.click(); return; }
        }
      })
    ]);
    if (download) {
      const ext = path.extname(download.suggestedFilename()) || '.xlsx';
      const dlPath = path.join(outputDir, `telecom-contrats-export${ext}`);
      await download.saveAs(dlPath);
      console.log(`   ✅ Export: ${dlPath}`);
    }

    // ===== 5. CONSTRUIRE LES DONNÉES FINALES =====
    console.log("\n📊 Construction des données...");

    const bills = [];

    // A) Factures globales mensuelles
    for (const f of factures) {
      const montant = parseFloat(f.montant.replace(/\s/g, '').replace(',', '.')) || 0;
      if (montant <= 0) continue;

      // Convertir "mars 2026" → "2026-03" (gestion accents)
      const moisMatch = f.mois.match(/([\wéèêëàâäùûüôöîïç]+)\s+(\d{4})/i);
      let periode = f.mois;
      if (moisMatch) {
        const moisNum = normalizeMois(moisMatch[1]) || '01';
        periode = `${moisMatch[2]}-${moisNum}`;
      }

      bills.push({
        ligne: 'GLOBAL',
        periode,
        montant,
        forfait: '',
        appels: 0, sms: 0, data: 0, roaming: 0,
        dateFacture: '',
        numFacture: f.reference || '',
        statut: f.statut || '',
        solde: parseFloat((f.solde || '0').replace(/\s/g, '').replace(',', '.')) || 0,
      });
    }

    console.log(`   ${bills.length} factures mensuelles`);
    console.log(`   ${lignesContrats.length} lignes mobiles`);

    // Sauvegarder les contrats séparément
    if (lignesContrats.length > 0) {
      const contratsPath = path.join(outputDir, `telecom-contrats-${timestamp}.json`);
      fs.writeFileSync(contratsPath, JSON.stringify(lignesContrats, null, 2), "utf-8");
      console.log(`   ✅ Contrats sauvegardés: ${contratsPath}`);

      // Générer le mapping pour le frontend
      const mapping = {};
      for (const l of lignesContrats) {
        mapping[l.numero] = { collaborateur: '', service: '', forfait: l.forfait, dateActivation: l.dateActivation };
      }
      const mappingPath = path.join(__dirname, "..", "public", "telecom-line-mapping.json");
      // Ne pas écraser si le fichier existe déjà avec des données
      const existingMapping = fs.existsSync(mappingPath) ? JSON.parse(fs.readFileSync(mappingPath, 'utf-8')) : {};
      if (Object.keys(existingMapping).length === 0) {
        fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 2), "utf-8");
        console.log(`   ✅ Mapping généré: ${mappingPath}`);
      } else {
        // Merge: add new lines, keep existing data
        let updated = false;
        for (const [num, data] of Object.entries(mapping)) {
          if (!existingMapping[num]) {
            existingMapping[num] = data;
            updated = true;
          }
        }
        if (updated) {
          fs.writeFileSync(mappingPath, JSON.stringify(existingMapping, null, 2), "utf-8");
          console.log(`   ✅ Mapping mis à jour (nouvelles lignes ajoutées)`);
        }
      }
    }

    // Sauvegarder les factures
    if (bills.length > 0) {
      const jsonPath = path.join(outputDir, `telecom-bills-${timestamp}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify(bills, null, 2), "utf-8");
      console.log(`\n✅ Factures sauvegardées: ${jsonPath} (${bills.length} factures)`);

      const csvHeader = "Ligne,Période,Montant,Statut,Solde,Référence";
      const csvRows = bills.map(b =>
        [b.ligne, b.periode, b.montant, b.statut, b.solde, b.numFacture]
          .map(v => `"${(String(v) || '').replace(/"/g, '""')}"`)
          .join(",")
      );
      fs.writeFileSync(path.join(outputDir, `telecom-bills-${timestamp}.csv`), [csvHeader, ...csvRows].join("\n"), "utf-8");

      // Auto-import dans Firestore
      if (process.env.TELECOM_IMPORT_KEY) {
        console.log("🔥 Import dans Firestore...");
        try {
          const { execSync } = require("child_process");
          execSync(`node ${path.join(__dirname, "import-telecom-to-firestore.js")}`, { stdio: "inherit" });
        } catch (importErr) {
          console.error("❌ Import Firestore échoué:", importErr.message);
          process.exitCode = 1;
        }
      } else {
        console.log("ℹ️  TELECOM_IMPORT_KEY non défini — import Firestore ignoré");
      }
    }

    // Save HTML for debugging
    const pageContent = await page.content();
    fs.writeFileSync(path.join(outputDir, `telecom-page-${timestamp}.html`), pageContent, "utf-8");

  } catch (error) {
    console.error("❌ Erreur:", error.message);
    try {
      await page.screenshot({ path: path.join(outputDir, "debug-telecom-screenshot.png"), fullPage: true, timeout: 15000 });
    } catch (e) {}
  } finally {
    await browser.close();
    console.log("\n🏁 Terminé.");
  }
}

fetchTelecomData();
