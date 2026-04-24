/**
 * Script pour récupérer les données carburant depuis MyTotalFuelCard
 * Usage: node scripts/fetch-fuel-data.js
 *
 * Requiert un fichier .env avec:
 *   TOTAL_USERNAME=votre_identifiant
 *   TOTAL_PASSWORD=votre_mot_de_passe
 */

require("dotenv").config();
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE_URL = "https://www.mytotalfuelcard.com/Client/app/index.html";

async function fetchFuelData() {
  const username = process.env.TOTAL_USERNAME;
  const password = process.env.TOTAL_PASSWORD;

  if (!username || !password) {
    console.error(
      "❌ Identifiants manquants. Créez un fichier .env avec TOTAL_USERNAME et TOTAL_PASSWORD"
    );
    process.exit(1);
  }

  console.log("🚀 Lancement du navigateur...");
  const isCI = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
  const browser = await chromium.launch({ headless: isCI }); // headless en CI, visible en local
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  try {
    // 1. Aller sur la page de connexion
    console.log("📡 Connexion à MyTotalFuelCard...");
    await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 30000 });

    // 2. Remplir le formulaire de connexion
    await page.waitForSelector('input[type="text"], input[name*="user"], input[name*="login"], input[id*="user"], input[id*="login"]', { timeout: 15000 });

    // Trouver les champs de login (peut varier selon le site)
    const usernameInput = await page.$('input[type="text"], input[name*="user"], input[name*="login"], input[id*="user"], input[id*="login"]');
    const passwordInput = await page.$('input[type="password"]');

    if (!usernameInput || !passwordInput) {
      // Essayer avec des sélecteurs plus larges
      console.log("🔍 Recherche des champs de connexion...");
      const inputs = await page.$$("input");
      console.log(`   Trouvé ${inputs.length} champs input`);
      for (const input of inputs) {
        const type = await input.getAttribute("type");
        const name = await input.getAttribute("name");
        const id = await input.getAttribute("id");
        console.log(`   - type="${type}" name="${name}" id="${id}"`);
      }
      throw new Error("Champs de connexion non trouvés. Voir les logs ci-dessus.");
    }

    await usernameInput.fill(username);
    await passwordInput.fill(password);

    // 3. Soumettre le formulaire
    console.log("🔐 Envoi des identifiants...");
    const submitBtn = await page.$(
      'button[type="submit"], input[type="submit"], button:has-text("Login"), button:has-text("Connexion"), .login-btn, #loginBtn'
    );
    if (submitBtn) {
      await submitBtn.click();
    } else {
      await passwordInput.press("Enter");
    }

    // 4. Attendre que la page se charge après connexion
    await page.waitForNavigation({ waitUntil: "networkidle", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);

    console.log("✅ Connecté !");

    // 4b. Fermer le popup cookies (tarteaucitron)
    console.log("🍪 Gestion du popup cookies...");
    try {
      // D'abord essayer de cliquer sur "OK, accept all"
      const cookieBtn = await page.waitForSelector(
        '#tarteaucitronAllAllowed, button:has-text("OK, accept all"), button:has-text("Deny all")',
        { timeout: 5000 }
      );
      if (cookieBtn) {
        await cookieBtn.click({ force: true });
        console.log("   ✅ Popup cookies accepté");
        await page.waitForTimeout(1000);
      }
    } catch {
      console.log("   Pas de bouton cookie trouvé");
    }
    // Supprimer l'overlay tarteaucitron du DOM pour débloquer les clics
    await page.evaluate(() => {
      const el = document.getElementById('tarteaucitronRoot');
      if (el) el.remove();
      // Supprimer aussi tout overlay bloquant
      document.querySelectorAll('[id*="tarteaucitron"]').forEach(e => e.remove());
    });
    console.log("   ✅ Overlay tarteaucitron supprimé du DOM");

    // 5. Naviguer vers Transactions
    console.log("📊 Navigation vers Transactions...");
    const transactionsLink = await page.$(
      'a:has-text("Transactions"), a[href*="transaction"], li:has-text("Transactions")'
    );
    if (transactionsLink) {
      await transactionsLink.click();
      await page.waitForTimeout(3000);
    }

    // Attendre que le formulaire soit entièrement chargé (4 selects)
    console.log("⏳ Attente du chargement complet du formulaire...");
    for (let attempt = 0; attempt < 10; attempt++) {
      const selCount = await page.$$eval('select', sels => sels.length);
      const clientOpts = await page.$$eval('#cb_client option', opts => opts.length);
      if (selCount >= 4 && clientOpts >= 2) {
        console.log(`   ✅ Formulaire prêt (${selCount} selects, ${clientOpts} clients)`);
        break;
      }
      console.log(`   ... ${selCount} selects, ${clientOpts} clients - attente...`);
      await page.waitForTimeout(2000);
    }

    // 5b. Debug: lister les selects et leurs options
    console.log("🔍 Analyse des éléments du formulaire...");
    const allSelects = await page.$$('select');
    console.log(`   Trouvé ${allSelects.length} select(s)`);
    for (let i = 0; i < allSelects.length; i++) {
      const sel = allSelects[i];
      const id = await sel.getAttribute('id');
      const name = await sel.getAttribute('name');
      const ngModel = await sel.getAttribute('ng-model') || await sel.getAttribute('data-bind') || '';
      const options = await sel.$$eval('option', opts => opts.map(o => ({ value: o.value, text: o.textContent.trim() })));
      console.log(`   Select #${i}: id="${id}" name="${name}" model="${ngModel}"`);
      console.log(`   Options:`, JSON.stringify(options));
    }

    // Lister les images/boutons cliquables
    const allImages = await page.$$eval('img', imgs => imgs.map(i => ({ src: i.src, alt: i.alt, onclick: i.getAttribute('onclick') || i.getAttribute('ng-click') || '' })));
    console.log(`   Images:`, JSON.stringify(allImages));

    // Sélectionner le client BERRY GOOD FARMS
    console.log("🔍 Sélection du client BERRY GOOD FARMS...");
    const clientSelect = await page.$('#cb_client');
    if (clientSelect) {
      const options = await clientSelect.$$eval('option', opts => opts.map(o => ({ value: o.value, text: o.textContent.trim() })));
      const berryOption = options.find(o => o.text.includes('BERRY GOOD'));
      if (berryOption) {
        await clientSelect.selectOption(berryOption.value);
        await clientSelect.evaluate(el => el.dispatchEvent(new Event('change', { bubbles: true })));
        console.log(`   ✅ Client sélectionné: ${berryOption.text}`);
        await page.waitForTimeout(1000);
      }
    }

    // Helper: cliquer sur la loupe de recherche
    async function clickSearch() {
      await page.evaluate(() => {
        const imgs = document.querySelectorAll('img');
        for (const img of imgs) {
          if (img.offsetWidth > 0 && img.offsetHeight > 0 && img.closest('a, button, [ng-click], [onclick]')) {
            img.click();
            return;
          }
        }
      });
      await page.waitForTimeout(4000);
    }

    // 6. Appeler directement l'API /Operations avec les cookies de session
    const outputDir = path.join(__dirname, "..", "data");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const timestamp = new Date().toISOString().slice(0, 10);

    // Récupérer les cookies de session
    const cookies = await context.cookies();
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // Définir les périodes à scraper (campagne Jul 2025 → maintenant)
    const now = new Date();
    const campagneYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    const campagneStart = new Date(campagneYear, 6, 1); // July 1

    // Format date: MM/DD/YYYY (format utilisé par l'API)
    function formatDate(d) {
      return `${String(d.getMonth()+1).padStart(2,'0')}%2F${String(d.getDate()).padStart(2,'0')}%2F${d.getFullYear()}`;
    }

    const dateDebut = formatDate(campagneStart);
    const dateFin = formatDate(now);

    console.log(`📡 Appel API /Operations (${campagneStart.toLocaleDateString('fr-FR')} → ${now.toLocaleDateString('fr-FR')})...`);

    const apiUrl = `https://www.mytotalfuelcard.com/Operations?idClient=12626&idCarte=-1&dateDebut=${dateDebut}&dateFin=${dateFin}&typeOp=transaction`;
    console.log(`   URL: ${apiUrl}`);

    // Ouvrir un nouvel onglet pour appeler l'API directement (avec les cookies de session)
    const apiPage = await context.newPage();
    const response = await apiPage.goto(apiUrl, { waitUntil: "networkidle", timeout: 30000 });
    const apiResponse = await apiPage.content();
    await apiPage.close();

    // Parse la réponse (HTML tableau ou JSON)
    console.log(`   Réponse: ${apiResponse.length} chars`);
    let tableData = [];

    // Extraire le JSON de la réponse (peut être enveloppé dans du HTML <pre>)
    let jsonText = apiResponse;
    const preMatch = apiResponse.match(/<pre[^>]*>([\s\S]*?)<\/pre>/);
    if (preMatch) jsonText = preMatch[1];
    // Ou chercher directement le JSON
    const jsonStart = jsonText.indexOf('{');
    if (jsonStart > 0) jsonText = jsonText.substring(jsonStart);

    try {
      const jsonData = JSON.parse(jsonText);
      const items = jsonData.data || jsonData;
      console.log(`   ${items.length} transactions dans la réponse API (count: ${jsonData.count || '?'})`);

      // Debug: afficher les clés et un exemple
      if (items.length > 0) {
        console.log(`   Clés API: ${Object.keys(items[0]).join(', ')}`);
        console.log(`   Exemple item[0]:`, JSON.stringify(items[0]).substring(0, 500));
      }

      for (const t of items) {
        // Parser date_trans: "/Date(1774566000000+0100)/" → Date
        let dateStr = "";
        if (t.date_trans) {
          const tsMatch = t.date_trans.match(/\/Date\((\d+)/);
          if (tsMatch) {
            const d = new Date(parseInt(tsMatch[1]));
            const hStr = String(t.heure_trans || 0).padStart(6, '0');
            const hh = hStr.substring(0, 2);
            const mm = hStr.substring(2, 4);
            dateStr = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()} ${hh}:${mm}`;
          }
        }
        tableData.push({
          carte: t.id_carte || "",
          date: dateStr,
          ticket: String(t.no_ticket || "").replace(/\.0$/, ''),
          lieu: t.lieu || "",
          produit: t.prod || t.produit || "",
          kms: String(t.kms || 0),
          quantite: String(t.qtt || 0),
          montant: `${t.montant || 0} MAD`,
          dateFacture: t.date_facture || "",
          numFacture: t.no_facture || "",
        });
      }
      console.log(`   ${tableData.length} transactions parsées`);
    } catch (parseErr) {
      console.log(`   ❌ Erreur parsing JSON: ${parseErr.message}`);
      console.log(`   Premiers 500 chars: ${jsonText.substring(0, 500)}`);
      // Fallback
      console.log("📋 Fallback au scraping...");
      await clickSearch();
      tableData = await scrapeTransactionsTable(page);
    }

    // Dédupliquer
    const seen = new Set();
    tableData = tableData.filter(t => {
      const key = `${t.carte}_${t.date}_${t.ticket}_${t.montant}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    console.log(`📊 ${tableData.length} transactions uniques`);
    if (tableData.length > 0) {
      const jsonPath = path.join(outputDir, `fuel-transactions-${timestamp}.json`);
      fs.writeFileSync(jsonPath, JSON.stringify(tableData, null, 2), "utf-8");
      console.log(`✅ Données JSON sauvegardées: ${jsonPath} (${tableData.length} transactions)`);

      // Générer aussi un CSV
      const csvHeader = "Carte,Date,N° Ticket,Lieu,Produit,Kms,Quantité,Montant,Date facture,N° facture";
      const csvRows = tableData.map(t =>
        [t.carte, t.date, t.ticket, t.lieu, t.produit, t.kms, t.quantite, t.montant, t.dateFacture, t.numFacture]
          .map(v => `"${(v || '').replace(/"/g, '""')}"`)
          .join(",")
      );
      const csvPath = path.join(outputDir, `fuel-transactions-${timestamp}.csv`);
      fs.writeFileSync(csvPath, [csvHeader, ...csvRows].join("\n"), "utf-8");
      console.log(`✅ Données CSV sauvegardées: ${csvPath}`);

      // Auto-import dans Firestore
      console.log("🔥 Import dans Firestore...");
      try {
        const { execSync } = require("child_process");
        execSync(`node ${path.join(__dirname, "import-fuel-to-firestore.js")}`, { stdio: "inherit" });
      } catch (importErr) {
        console.error("❌ Import Firestore échoué:", importErr.message);
        process.exitCode = 1;
      }
    }
  } catch (error) {
    console.error("❌ Erreur:", error.message);

    // Screenshot pour debug
    const screenshotPath = path.join(__dirname, "..", "data", "debug-screenshot.png");
    const dir = path.dirname(screenshotPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`📸 Screenshot de debug sauvegardé: ${screenshotPath}`);
  } finally {
    await browser.close();
    console.log("🏁 Terminé.");
  }
}

async function scrapeCurrentPage(page) {
  const rows = await page.$$("table tr");
  const pageData = [];
  for (const row of rows) {
    const cells = await row.$$("td");
    if (cells.length >= 8) {
      const values = await Promise.all(cells.map((c) => c.innerText()));
      pageData.push({
        carte: values[0]?.trim(),
        date: values[1]?.trim(),
        ticket: values[2]?.trim(),
        lieu: values[3]?.trim(),
        produit: values[4]?.trim(),
        kms: values[5]?.trim(),
        quantite: values[6]?.trim(),
        montant: values[7]?.trim(),
        dateFacture: values[8]?.trim() || "",
        numFacture: values[9]?.trim() || "",
      });
    }
  }
  return pageData;
}

async function scrapeTransactionsTable(page) {
  const transactions = [];

  // Trouver le nombre total de pages via les liens de pagination
  const pageLinks = await page.$$eval(
    'a, span',
    els => els
      .map(el => el.textContent.trim())
      .filter(t => /^\d+$/.test(t))
      .map(Number)
  );
  const totalPages = pageLinks.length > 0 ? Math.max(...pageLinks) : 1;
  console.log(`   ${totalPages} page(s) détectée(s)`);

  // Scraper page 1
  console.log(`   Page 1...`);
  transactions.push(...await scrapeCurrentPage(page));

  // Scraper les pages suivantes en cliquant sur le numéro de page
  for (let p = 2; p <= totalPages; p++) {
    console.log(`   Page ${p}...`);
    // Cliquer sur le lien de la page par son texte exact
    try {
      await page.evaluate((pageNum) => {
        const links = document.querySelectorAll('a');
        for (const link of links) {
          if (link.textContent.trim() === String(pageNum)) {
            link.click();
            return;
          }
        }
      }, p);
      await page.waitForTimeout(3000);
      transactions.push(...await scrapeCurrentPage(page));
    } catch (e) {
      console.log(`   ⚠️ Erreur page ${p}: ${e.message}`);
      break;
    }
  }

  return transactions;
}

fetchFuelData();
