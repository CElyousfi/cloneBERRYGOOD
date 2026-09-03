/* Actions 2/6 de stockManagement — corps repris VERBATIM.
   Le contexte du handler (req, res, action, helpers) arrive par `ctx` ; la
   destructuration ci-dessous recree exactement les liaisons d'origine, si bien
   que les corps n'ont pas ete touches. */
'use strict';
const { NOT_HANDLED } = require("./_dispatch");
const { admin, consoAccessControl, db_firestore, demandeCreationArticle, functions, getPool, getSql, resolveCallerRole, withCache, articleMerge, articleCategories, stockRoles, stockMovementGuard, consoValorisationLib, consoBons, parcelleGroupSplit, uniteConso, bcDate, bcDoublons, bcSuppression, identiteArticle, stockFilesRecord, enregistrerDemandesCreation, getNextNumber } = require("./magasin.stock.deps");

module.exports = async function stockActions2(ctx) {
  const { req, res, action, adminSecret, authUser, updateStockBalance, applyStockImpact, reverseStockImpact, getChefProfileForFerme, resolveRequesterIdentity } = ctx;



      if (action === "create-bc" && req.method === "POST") {
        const { date, authorized_by, items, scan_url, created_by } = req.body;
        // `type` est une DÉCLARATION D'INTENTION du magasinier : il ne pilote
        // PLUS la classification analytique, qui vient désormais de la fiche
        // catalogue de chaque ARTICLE (functions/lib/consoBons). L'onglet
        // « Tous » n'a pas de type ; plutôt qu'un repli MUET côté client
        // (`type || 'engrais'`, qui a produit 48 bons /48 en engrais et un
        // onglet Pesticides structurellement vide), le défaut est posé ICI,
        // explicitement et en un seul endroit.
        const type = String(req.body.type || "").trim() || "engrais";
        if (!items?.length) {
          return res.status(400).json({ success: false, error: "Champs requis: items[]" });
        }
        if (!["engrais", "pesticide"].includes(type)) {
          return res.status(400).json({ success: false, error: "Type invalide (engrais|pesticide)" });
        }
        for (const it of items) {
          if (!it.parcelle) return res.status(400).json({ success: false, error: "Parcelle requise pour chaque article" });
        }

        // --- GROUPES DE PARCELLES : éclatement au prorata des Ha ---
        // Un item saisi sur un « groupe » (parcelle combinée) est remplacé par N
        // lignes de parcelles RÉELLES, quantités au prorata du `ha` de
        // sb_parcelle_referentiel (Σ des parts == quantité saisie, exactement).
        // Le libellé de groupe n'est JAMAIS persisté comme parcelle : toute la
        // jointure aval (analytique, coût/Ha, Mapping Conso) se fait par égalité
        // de chaîne sur le libellé de parcelle réel.
        let bcSourceItems = items;
        if (items.some((it) => it && it.groupe_id)) {
          const [grpSnapBc, refSnapBc] = await Promise.all([
            db_firestore.collection("sb_parcelle_groupes").get(),
            db_firestore.collection("sb_parcelle_referentiel").get(),
          ]);
          const haByLabelBc = {};
          refSnapBc.forEach((doc) => {
            const d = doc.data() || {};
            const lbl = (d.label_bee_one || doc.id || "").toUpperCase().trim();
            if (lbl) haByLabelBc[lbl] = parseFloat(d.ha) || 0;
          });
          const groupesById = {};
          grpSnapBc.forEach((doc) => {
            const d = doc.data() || {};
            if (d.actif === false) return; // soft delete : groupe inutilisable en saisie
            groupesById[doc.id] = {
              id: doc.id,
              label: d.label || doc.id,
              // Ha relus À CHAQUE SAISIE (jamais figés dans le groupe) : une
              // correction de Ha dans le Référentiel se propage immédiatement.
              membres: (d.membres || []).map((lbl) => ({
                label: lbl,
                ha: haByLabelBc[(lbl || "").toUpperCase().trim()] || 0,
              })),
            };
          });
          try {
            bcSourceItems = parcelleGroupSplit.expandItems(items, groupesById);
          } catch (e) {
            return res.status(400).json({ success: false, error: e.message });
          }
        }

        const bcItemsSaisis = bcSourceItems.map((it) => ({
          article: it.article || "", quantite: parseFloat(it.quantite) || 0, unite: it.unite || "kg",
          parcelle: it.parcelle || "", culture: it.culture || "", ferme: it.ferme || "",
          // parcelle_ref : clé stable BEE ONE envoyée par le front, jusqu'ici
          // droppée par ce mapping. groupe_id/groupe_label : traçabilité de la
          // saisie combinée (vides pour une saisie parcelle simple).
          parcelle_ref: it.parcelle_ref || "",
          groupe_id: it.groupe_id || "", groupe_label: it.groupe_label || "",
        }));

        // --- CONVERSION D'UNITÉ (lib/uniteConso) ---------------------------
        // Mesuré en production : 87 lignes sur 648 sont saisies dans une unité
        // qui n'est PAS celle où le stock est tenu (Acide Nitrique acheté au KG,
        // dosé au L). Jusqu'ici le système retirait « 5 L » d'un solde en kilos.
        // La quantité DÉDUITE est donc désormais convertie vers l'unité de
        // stock quand la fiche article porte `unite_consommation` +
        // `stock_par_unite_consommation` (« 1 L = 1,32 KG »).
        //
        // ⚠️ PORTÉE STRICTEMENT LIMITÉE AU SOLDE DE STOCK. La VALORISATION
        // (lib/consoBons/bonsToConsoRows.js → lib/valorisation/consoValorisation.js)
        // lit toujours la quantité SAISIE et la multiplie par un PMP exprimé
        // dans l'unité de stock : pour 5 L d'acide nitrique, le solde est juste
        // mais le coût reste sous-estimé de 32 %. Chantier séparé, au backlog
        // (validé par Omar) — ne pas lire ce bloc comme si le coût suivait.
        //
        // FAIL-CLOSED, et sans blocage (décision d'Omar) : sans conversion
        // exploitable, la ligne est déduite TELLE QUELLE — comportement
        // strictement identique à avant — mais marquée `conversion_manquante`
        // et remontée dans `lignes_non_convertibles`, pour être signalée au
        // magasinier et rester repérable après coup. Aucun facteur n'est
        // deviné : une densité est propre au produit.
        //
        // ⚠️ Le catalogue est désormais lu ENTIER (le `where active == true` a
        // sauté) pour un SEUL usage supplémentaire : l'index d'IDENTITÉ, qui
        // doit voir les fiches désactivées par une fusion pour suivre leur
        // chaîne `merged_into`. Toujours UNE lecture — c'est le branchement le
        // moins coûteux du dépôt, le catalogue était déjà sur ce chemin
        // critique. La conversion d'unité, elle, continue de ne voir QUE les
        // fiches actives : son comportement est strictement inchangé.
        const bcCatalogSnap = await db_firestore.collection("articles_catalog").get();
        const bcCatalogDocs = bcCatalogSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        // `active === true` STRICTEMENT, pas `!== false` : la requête d'avant
        // (`where("active","==",true)`) excluait les documents SANS champ
        // `active` — les 5 fantômes de production. Le filtre mémoire doit
        // rendre exactement le même ensemble, sinon ce lot changerait la
        // conversion d'unité par effet de bord.
        const bcIndexUnites = uniteConso.indexerArticles(bcCatalogDocs.filter((a) => a.active === true));
        const bcIndexIdentite = identiteArticle.indexerFiches(bcCatalogDocs);
        const bcConversion = uniteConso.analyserLignes(bcItemsSaisis, bcIndexUnites);
        const bcItems = bcItemsSaisis.map((it, i) => {
          const v = bcConversion.lignes[i];
          // Le bon conserve la saisie du magasinier (`quantite`/`unite`) : c'est
          // ce qui est écrit sur le bon papier. La quantité en unité de stock
          // est AJOUTÉE à côté, jamais substituée.
          return Object.assign({}, it, {
            unite_stock: v.converti ? v.unite_stock : it.unite,
            quantite_stock: v.converti ? v.quantite_stock : it.quantite,
            conversion_facteur: v.facteur,
            conversion_appliquee: v.converti,
            conversion_manquante: !v.convertible,
            conversion_motif: v.convertible ? "" : v.motif,
          });
        });
        // --- IDENTITÉ D'ARTICLE (lib/stock/identiteArticle) ----------------
        // Résolution AVANT `getNextNumber` et avant toute écriture : un bon
        // refusé ne doit consommer ni numéro de séquence, ni document.
        // FAIL-CLOSED (décision d'Omar) : un article inconnu ou ambigu fait
        // échouer le bon, en le nommant.
        //
        // Le BON, lui, garde le libellé dans `items[].article` : c'est ce qui
        // est écrit sur le papier. Seules les LIGNES DE STOCK reçoivent
        // l'identité, via cette table.
        const bcResolution = identiteArticle.resoudreLignes(
          bcItems.map((it) => ({ article: it.article })),
          bcIndexIdentite
        );
        if (!bcResolution.ok) {
          // Même sortie que create-movement : le refus ouvre la demande.
          const bcDemandes = await enregistrerDemandesCreation(
            db_firestore,
            bcResolution.refus.details,
            { uid: authUser.uid, profileId: (created_by || {}).profileId || "", name: (created_by || {}).name || "" },
            { origine: "create-bc", type: type || "", numero: "" }
          );
          return res.status(400).json({
            success: false,
            error: demandeCreationArticle.messageRefus(bcResolution.refus.details, bcDemandes),
            code: bcResolution.refus.code,
            demandes_creation: bcDemandes,
          });
        }
        // Table construite par le CONSTRUCTEUR de Map, jamais par mutation :
        // le cliquet createBcDoublonsWiring interdit toute forme d'écriture
        // avant le refus de doublon, pour prouver qu'un bon refusé n'écrit
        // rien. Il lit le source brut et ne peut pas distinguer une mutation
        // mémoire d'une écriture Firestore — l'affaiblir pour lui plaire serait
        // exactement le mauvais arbitrage.
        const bcFicheParArticle = new Map(
          bcItems.map((it, i) => [it.article || "", bcResolution.lignes[i].article_ref])
        );

        const allParcelles = [...new Set(bcItems.map(i => i.parcelle).filter(Boolean))];
        const allFermes = [...new Set(bcItems.map(i => i.ferme).filter(Boolean))];
        // Date résolue UNE fois : le bon et ses mouvements de stock doivent
        // porter la même (deux `new Date()` peuvent enjamber minuit).
        const bcDateValue = date || new Date().toISOString().split("T")[0];

        // --- GARDE ANTI-DOUBLON (lib/stock/bcDoublons) ---
        // Le magasinier soumet deux fois le même scan : mesuré 2 fois sur 49
        // bons en production (BC-2026-0032/0033, BC-2026-0039/0040), à 23 et 29
        // secondes d'intervalle, avec le MÊME `scan_url`. On bloque, on nomme le
        // bon existant, et le magasinier peut forcer — le forçage est tracé.
        //
        // Fenêtre BORNÉE aux 200 bons les plus récents, comme `scan-bc` : un
        // scan complet de l'historique à chaque création se dégraderait avec le
        // temps. Comparaison faite APRÈS l'éclatement des groupes de parcelles,
        // sur les items tels qu'ils seront persistés, et AVANT `getNextNumber` —
        // un bon refusé ne doit pas consommer de numéro de séquence.
        const bcRecentsSnap = await db_firestore.collection("consumption_vouchers")
          .orderBy("created_at", "desc").limit(200).get();
        const bcRecents = bcRecentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const bcVerdict = bcDoublons.detecterDoublon(
          { scan_url: scan_url || null, date: bcDateValue, items: bcItems },
          bcRecents
        );
        const bcForceDemande = bcDoublons.forcageDemande(req.body && req.body.force_doublon);
        if (bcVerdict.doublon && !bcForceDemande) {
          return res.status(409).json({
            success: false,
            error: bcVerdict.message,
            doublon: {
              motif: bcVerdict.motif,
              bon_id: bcVerdict.bon_id,
              bon_numero: bcVerdict.bon_numero,
            },
          });
        }
        // Trace du forçage : construite SERVEUR à partir du token
        // (resolveCallerRole), JAMAIS d'une identité lue dans le body.
        let bcForceTrace = null;
        if (bcVerdict.doublon && bcForceDemande) {
          const bcForceRole = await resolveCallerRole(authUser);
          bcForceTrace = bcDoublons.construireTraceForcage({
            verdict: bcVerdict,
            by: {
              uid: (authUser && authUser.uid) || "",
              profileId: bcForceRole || "",
              name: (authUser && (authUser.name || authUser.email)) || "",
            },
            at: Date.now(),
          });
        }

        const numero = await getNextNumber("consumption_voucher", "BC");
        const bcData = {
          numero, type,
          parcelle: allParcelles.join(", "), culture: "", ferme: allFermes.join(", "),
          date: bcDateValue,
          // motif : champ « Motif » du bon papier (ex. « Fertigation/Traitement »),
          // lu par le scan et éditable côté front. Ajout PUREMENT ADDITIF et
          // OPTIONNEL : aucune validation, absent du body -> "" (comportement
          // strictement identique à avant pour tous les appelants existants).
          motif: typeof req.body.motif === "string" ? req.body.motif.trim() : "",
          authorized_by: authorized_by || {},
          items: bcItems,
          cpc_categorie: type === "engrais" ? "Engrais" : "Pesticides",
          scan_url: scan_url || null,
          created_by: created_by || {},
          created_at: Date.now(),
          // Trace du forçage d'un doublon détecté (null si aucun forçage) : qui,
          // quand, quel bon était jugé doublon, et pour quel motif.
          // Lignes dont l'unité de saisie diffère de l'unité de stock SANS
          // conversion exploitable sur la fiche : déduites telles quelles, mais
          // consignées ici pour rester repérables après coup (même esprit que
          // les « articles non valorisés » de l'écran Campagne). Vide dans le
          // cas normal.
          lignes_non_convertibles: bcConversion.non_convertibles,
          doublon_force: bcForceTrace,
          history: bcForceTrace
            ? [{ action: bcDoublons.HISTORY_ACTION_FORCAGE, by: bcForceTrace.by, at: bcForceTrace.at, motif: bcForceTrace.motif, bon_doublon_numero: bcForceTrace.bon_doublon_numero }]
            : [],
        };
        const docRef = await db_firestore.collection("consumption_vouchers").add(bcData);

        // Create stock_movements grouped by parcelle + update stock_balances
        // Identité créateur : userId = uid du TOKEN (anti-spoof), profileId/name
        // conservés. Cf. stockMovementGuard.
        const bcCreatedBy = { ...(created_by || {}), userId: authUser.uid };
        const lieuSource = req.body.lieu_source || { type: "magasin", id: allFermes[0] || "F1" };
        const validBcItems = bcItems.filter((it) => it.quantite > 0);
        const itemsByParcelle = {};
        for (const it of validBcItems) {
          const key = it.parcelle || "unknown";
          if (!itemsByParcelle[key]) itemsByParcelle[key] = [];
          itemsByParcelle[key].push(it);
        }
        for (const [parcelle, parcItems] of Object.entries(itemsByParcelle)) {
          const bcsNumero = await getNextNumber("stock_consommation", "BCS");
          // Le MOUVEMENT de stock (et donc le solde) est en unité de STOCK :
          // c'est tout l'objet du ticket. Une ligne sans conversion exploitable
          // garde sa quantité et son unité de saisie — comportement d'avant —
          // et porte `conversion_manquante` pour rester repérable.
          const bcsItems = parcItems.map((it) => ({
            // IDENTITÉ = docId de fiche (résolu plus haut) ; le libellé saisi
            // reste dans `article_nom`.
            article_ref: bcFicheParArticle.get(it.article || "") || "",
            article_nom: it.article || "",
            quantite: it.conversion_appliquee ? it.quantite_stock : (it.quantite || 0),
            unite: it.conversion_appliquee ? it.unite_stock : (it.unite || "kg"),
            quantite_saisie: it.quantite || 0,
            unite_saisie: it.unite || "kg",
            conversion_facteur: it.conversion_facteur === undefined ? null : it.conversion_facteur,
            conversion_appliquee: !!it.conversion_appliquee,
            conversion_manquante: !!it.conversion_manquante,
          }));
          const movData = {
            numero: bcsNumero, type: "consommation",
            date: bcDateValue,
            lieu_source: lieuSource,
            lieu_destination: { type: "parcelle", id: parcelle },
            ferme: parcItems[0]?.ferme || "", items: bcsItems,
            ref_bl_fournisseur: "", bdc_id: null, bl_id: null,
            reception_libre: false, reception_libre_motif: "",
            ref_bon_physique: req.body.ref_bon_physique || "",
            sortie_type: null, scan_url: null,
            status: "valide_mag",
            validations: { magasinier: { by: bcCreatedBy.userId || "", name: bcCreatedBy.name || "", at: Date.now() } },
            rejection: null, created_by: bcCreatedBy,
            created_at: Date.now(), updated_at: Date.now(),
            bc_id: docRef.id, bc_numero: numero,
          };
          await db_firestore.collection("stock_movements").add(movData);
          const balPromises = bcsItems.map((it) =>
            updateStockBalance(lieuSource.type, lieuSource.id, it.article_ref, it.article_nom, it.unite, -it.quantite)
          );
          await Promise.all(balPromises);
        }

        // `lignes_non_convertibles` est renvoyé pour que l'écran de saisie le
        // dise TOUT DE SUITE au magasinier, en nommant l'article et les deux
        // unités : le bon est créé, mais la déduction s'est faite dans l'unité
        // de saisie faute de conversion sur la fiche.
        return res.json({
          success: true, id: docRef.id, numero,
          lignes_non_convertibles: bcConversion.non_convertibles,
        });
      }


      // ========== MODIFICATION DE LA DATE D'UN BON DE CONSOMMATION ==========
      // Périmètre volontairement étroit (ticket sb/bc-modifier-date) : LA DATE,
      // et rien d'autre. Articles/quantités/parcelles restent immuables — les
      // toucher obligerait à recalculer des soldes de stock déjà décrémentés.
      //
      // POINT CRITIQUE : un bon porte une date ET les `stock_movements` créés
      // par `create-bc` (type consommation, BCS-…) en portent une COPIE. Ce sont
      // ces mouvements que lisent les analyses par période. Les deux sont donc
      // mis à jour dans la MÊME transaction — jamais l'un sans l'autre.
      // Logique pure (validation, campagne, patch) : lib/stock/bcDate.js.
      if (action === "update-bc-date" && req.method === "POST") {
        // Rôle résolu SERVEUR (resolveCallerRole), jamais depuis le body.
        const bcDateRole = await resolveCallerRole(authUser);
        if (bcDateRole !== "magasinier" && bcDateRole !== "dg") {
          return res.status(403).json({ success: false, error: "Réservé au profil magasinier (ou dg)" });
        }

        const bcDateId = req.body && req.body.bc_id;
        const bcNewDate = req.body && req.body.date;
        if (!bcDateId || typeof bcDateId !== "string") {
          return res.status(400).json({ success: false, error: "bc_id requis" });
        }
        // Date du jour calculée SERVEUR (Africa/Casablanca) — jamais l'horloge client.
        const bcDateCheck = bcDate.validateBcDate(bcNewDate, stockFilesRecord.todayInCasablanca());
        if (!bcDateCheck.valid) {
          return res.status(400).json({ success: false, error: bcDateCheck.error });
        }

        const bcDateActor = {
          uid: authUser.uid || "",
          profileId: bcDateRole || "",
          name: authUser.name || authUser.email || "",
        };
        const bcDateRef = db_firestore.collection("consumption_vouchers").doc(bcDateId);
        const bcDateMovQuery = db_firestore.collection("stock_movements").where("bc_id", "==", bcDateId);

        const bcDateResult = await db_firestore.runTransaction(async (tx) => {
          // Toutes les lectures AVANT toute écriture (contrainte Firestore).
          const bcSnap = await tx.get(bcDateRef);
          if (!bcSnap.exists) return { notFound: true };
          const movSnap = await tx.get(bcDateMovQuery);

          const before = bcSnap.data() || {};
          const patch = bcDate.buildDateUpdate({
            bc: before, date: bcNewDate, by: bcDateActor, at: Date.now(),
          });
          tx.update(bcDateRef, patch.bcUpdate);
          movSnap.docs.forEach((d) => tx.update(d.ref, patch.movementUpdate));
          return {
            notFound: false,
            date_avant: before.date || "",
            movements_updated: movSnap.size,
            campagne: bcDate.campagneChange(before.date, bcNewDate),
          };
        });

        if (bcDateResult.notFound) {
          return res.status(404).json({ success: false, error: "Bon de consommation introuvable" });
        }
        return res.json({
          success: true,
          date: bcNewDate,
          date_avant: bcDateResult.date_avant,
          movements_updated: bcDateResult.movements_updated,
          campagne_changed: bcDateResult.campagne.changed,
          campagne_avant: bcDateResult.campagne.from,
          campagne_apres: bcDateResult.campagne.to,
        });
      }


      // ========== SUPPRESSION D'UN BON DE CONSOMMATION ==========
      // Il n'existait AUCUNE suppression de bon de consommation. Une suppression
      // brute serait pire que rien : `create-bc` décrémente `stock_balances` au
      // moment même de la création (mouvements BCS-…, type consommation, en
      // `valide_mag`). Effacer le bon seul laisserait la consommation déduite
      // pour toujours — le bon disparaît, le stock reste amputé.
      //
      // On suit donc la mécanique éprouvée de `delete-movement` : soft-delete
      // (jamais de destruction) + `reverseStockImpact` sur les mouvements dont
      // l'impact était matérialisé. Logique pure : lib/stock/bcSuppression.
      if (action === "delete-bc" && req.method === "POST") {
        // Rôle résolu SERVEUR (resolveCallerRole), jamais depuis le body.
        // `achats`, `dg` ou `magasinier` (stockRoles) : celui qui saisit le bon
        // est celui qui repère son doublon, il doit pouvoir le défaire.
        // Le serveur ne valide QUE le rôle et le motif : la double confirmation
        // du magasinier est une protection d'interface (MagBCTab.jsx), il n'y a
        // volontairement AUCUN drapeau client à vérifier ici.
        const bcDelRole = await resolveCallerRole(authUser);
        const bcDelId = req.body && req.body.bc_id;
        const bcDelRef = bcDelId && typeof bcDelId === "string"
          ? db_firestore.collection("consumption_vouchers").doc(bcDelId) : null;
        const bcDelSnap = bcDelRef ? await bcDelRef.get() : null;
        const bcDelDoc = bcDelSnap && bcDelSnap.exists ? bcDelSnap.data() : null;

        const bcDelCheck = bcSuppression.validerSuppression({
          role: bcDelRole,
          motif: req.body && req.body.motif,
          bc: bcDelDoc,
          exists: !!bcDelDoc,
        });
        if (!bcDelCheck.ok) {
          return res.status(bcDelCheck.code).json({ success: false, error: bcDelCheck.error });
        }

        const bcDelActor = {
          uid: (authUser && authUser.uid) || "",
          profileId: bcDelRole || "",
          name: (authUser && (authUser.name || authUser.email)) || "",
        };
        const bcDelMovSnap = await db_firestore.collection("stock_movements")
          .where("bc_id", "==", bcDelId).get();
        const bcDelMovs = bcDelMovSnap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));
        const bcDelTri = bcSuppression.trierMouvements(bcDelMovs);
        const bcDelPatch = bcSuppression.buildSuppressionUpdate({
          bc: bcDelDoc, motif: bcDelCheck.motif, by: bcDelActor, at: Date.now(),
        });

        // 1) Annuler l'impact stock AVANT le soft-delete (le mouvement est encore
        //    dans son état impactant ; reverseStockImpact applique l'inverse exact
        //    de applyStockImpact). Un mouvement déjà supprimé est ignoré par
        //    trierMouvements : le re-créditer serait un double comptage.
        for (const mov of bcDelTri.aAnnuler) {
          await reverseStockImpact(mov);
        }
        // 2) Puis marquer les mouvements, puis le bon.
        for (const mov of bcDelTri.aMarquer) {
          await mov.ref.update(bcDelPatch.movementUpdate);
        }
        await bcDelRef.update(bcDelPatch.bcUpdate);

        return res.json({
          success: true,
          id: bcDelId,
          numero: (bcDelDoc && bcDelDoc.numero) || "",
          movements_deleted: bcDelTri.aMarquer.length,
          movements_reversed: bcDelTri.aAnnuler.length,
        });
      }


      // ========== STOCK DASHBOARD ==========

      if (action === "stock-dashboard") {
        const result = await withCache("stock_dashboard", 2 * 60 * 1000, async () => {
          const [bdcSnap, facSnap, bcSnap2, blSnap2] = await Promise.all([
            db_firestore.collection("purchase_orders").get(),
            db_firestore.collection("invoices").get(),
            db_firestore.collection("consumption_vouchers").get(),
            db_firestore.collection("delivery_notes").get(),
          ]);

          const bdcs = bdcSnap.docs.map((d) => d.data());
          const factures = facSnap.docs.map((d) => d.data());

          const bdcEnCours = bdcs.filter((b) => !["rejete", "envoye"].includes(b.status)).length;
          const bdcEnAttente = bdcs.filter((b) => b.status?.startsWith("en_attente")).length;
          const totalBdcTTC = bdcs.filter((b) => b.status !== "rejete").reduce((s, b) => s + (b.total_ttc || 0), 0);

          const facturesNonPayees = factures.filter((f) => f.payment_status !== "payee").length;
          const totalFacturesTTC = factures.reduce((s, f) => s + (f.total_ttc || 0), 0);
          const facturesAvecEcarts = factures.filter((f) => f.has_discrepancies).length;

          const pipelinePaiement = {
            non_payee: factures.filter((f) => f.payment_status === "non_payee").length,
            en_validation: factures.filter((f) => f.payment_status === "en_validation").length,
            validee_achats: factures.filter((f) => f.payment_status === "validee_achats").length,
            validee_finance: factures.filter((f) => f.payment_status === "validee_finance").length,
            validee_dg: factures.filter((f) => f.payment_status === "validee_dg").length,
            payee: factures.filter((f) => f.payment_status === "payee").length,
          };

          return {
            success: true,
            kpis: {
              bdc_en_cours: bdcEnCours, bdc_en_attente: bdcEnAttente,
              total_bdc_ttc: Math.round(totalBdcTTC * 100) / 100,
              factures_non_payees: facturesNonPayees,
              total_factures_ttc: Math.round(totalFacturesTTC * 100) / 100,
              factures_avec_ecarts: facturesAvecEcarts,
              pipeline_paiement: pipelinePaiement,
              nb_bl: blSnap2.size, nb_bc: bcSnap2.size,
            },
          };
        });
        return res.json(result);
      }


      if (action === "pending-validations") {
        const role = req.query.role;
        const ferme = req.query.ferme;
        const results = { bdc: [], factures: [] };

        if (role === "chef" && ferme) {
          const snap = await db_firestore.collection("purchase_orders").where("status", "==", "en_attente_chef").where("ferme", "==", ferme).get();
          results.bdc = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        }
        if (role === "dg") {
          const bdcSnap = await db_firestore.collection("purchase_orders").where("status", "==", "en_attente_dg").get();
          results.bdc = bdcSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
          const facSnap = await db_firestore.collection("invoices").where("payment_status", "==", "validee_finance").get();
          results.factures = facSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        }
        if (role === "finance") {
          const facSnap = await db_firestore.collection("invoices").where("payment_status", "==", "validee_achats").get();
          results.factures = facSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        }
        if (role === "achats") {
          const facSnap = await db_firestore.collection("invoices").where("payment_status", "==", "en_validation").get();
          results.factures = facSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        }

        return res.json({ success: true, ...results });
      }


      // ========== IMPORT FOURNISSEURS DEPUIS SQL ==========

      if (action === "import-fournisseurs-sql" && req.method === "POST") {
        const { imported_by } = req.body || {};
        const db = await getPool();

        // Phase 1 : Découverte des colonnes réelles de BR_Achat
        const schemaRes = await db.request()
          .input("tbl", getSql().NVarChar, "BR_Achat")
          .query(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                  WHERE TABLE_NAME = @tbl ORDER BY ORDINAL_POSITION`);

        if (schemaRes.recordset.length === 0) {
          return res.status(404).json({ success: false, error: "Table BR_Achat introuvable dans SQL Server" });
        }

        const actualCols = schemaRes.recordset.map(r => r.COLUMN_NAME);
        const colsLower = actualCols.map(c => c.toLowerCase());

        const findCol = (...candidates) => {
          for (const c of candidates) {
            const idx = colsLower.indexOf(c.toLowerCase());
            if (idx !== -1) return actualCols[idx];
          }
          return null;
        };

        // Phase 2 : Mapping colonnes → champs Firestore
        const nomCol       = findCol("Fournisseur", "NomFournisseur", "Nom_Fournisseur", "Nom", "RaisonSociale");
        const iceCol       = findCol("ICE", "Ice", "NumICE", "Num_ICE", "CodeFisc");
        const adresseCol   = findCol("Adresse", "Adress", "Address");
        const villeCol     = findCol("Ville", "City", "Localite");
        const telCol       = findCol("Tel", "Telephone", "Phone", "GSM", "Mobile");
        const emailCol     = findCol("Email", "Mail");
        const contactCol   = findCol("Contact", "NomContact", "Nom_Contact", "Interlocuteur");
        const categorieCol = findCol("Categorie", "TypeFournisseur", "Famille", "Type");

        if (!nomCol) {
          return res.status(422).json({
            success: false,
            error: "Colonne Nom/Fournisseur introuvable dans BR_Achat",
            columns_found: actualCols,
          });
        }

        // Phase 3 : SELECT fournisseurs distincts avec normalisation et exclusions
        // - Exclus : fermes (F-01/F-02/F-05), entrées internes (INVENTAIRE, STOCK INITIAL, INV-*)
        // - Normalisé : variantes HAROUACH → "STE AGRI HAROUACH", AGRIVIVOS → "STÉ AGRIVIVOS", TIMAC → "TIMAC AGRO MAROC"
        // - Catégorie inférée depuis Article_Categorie le plus fréquent
        const hasArchive = colsLower.includes("is_archive");
        const archiveFilter = hasArchive ? "AND is_archive = 0" : "";
        const hasCatCol = colsLower.includes("article_categorie");

        const sqlQuery = `
          WITH normalized AS (
            SELECT
              CASE
                WHEN UPPER(LTRIM(RTRIM([${nomCol}]))) LIKE '%HAROUACH%' THEN 'STE AGRI HAROUACH'
                WHEN UPPER(LTRIM(RTRIM([${nomCol}]))) LIKE '%AGRIVIVOS%' THEN 'STÉ AGRIVIVOS'
                WHEN UPPER(LTRIM(RTRIM([${nomCol}]))) = 'TIMAC' THEN 'TIMAC AGRO MAROC'
                ELSE LTRIM(RTRIM([${nomCol}]))
              END AS nom,
              ${hasCatCol ? "[Article_Categorie]" : "NULL AS Article_Categorie"}
            FROM BR_Achat
            WHERE [${nomCol}] IS NOT NULL
              AND LEN(LTRIM(RTRIM([${nomCol}]))) > 0
              AND UPPER(LTRIM(RTRIM([${nomCol}]))) NOT IN (
                'INVENTAIRE','STOCK INITIAL','INV-291125',
                'F-01','F-02','F-02 AVOCAT','F-05'
              )
              AND UPPER(LTRIM(RTRIM([${nomCol}]))) NOT LIKE 'INV-%'
              ${archiveFilter}
          ),
          ${hasCatCol ? `
          cat_counts AS (
            SELECT nom, Article_Categorie,
              ROW_NUMBER() OVER (PARTITION BY nom ORDER BY COUNT(*) DESC) AS rn
            FROM normalized
            WHERE Article_Categorie IS NOT NULL
            GROUP BY nom, Article_Categorie
          ),` : ""}
          fournisseurs AS (
            SELECT DISTINCT nom FROM normalized
          )
          SELECT
            f.nom,
            NULL AS ice, NULL AS adresse, NULL AS ville,
            NULL AS tel, NULL AS email, NULL AS contact_nom,
            ${hasCatCol ? "cc.Article_Categorie AS categorie" : "NULL AS categorie"}
          FROM fournisseurs f
          ${hasCatCol ? "LEFT JOIN cat_counts cc ON f.nom = cc.nom AND cc.rn = 1" : ""}
          ORDER BY f.nom
        `;
        const sqlRows = (await db.request().query(sqlQuery)).recordset;

        // Phase 4 : Chargement Firestore pour déduplication
        const existingSnap = await db_firestore.collection("suppliers").get();
        const existingByIce = {}, existingByNom = {};
        existingSnap.docs.forEach(doc => {
          const d = doc.data();
          if (d.ice && d.ice.trim()) existingByIce[d.ice.trim().toLowerCase()] = doc.id;
          if (d.nom && d.nom.trim()) existingByNom[d.nom.trim().toLowerCase()] = doc.id;
        });

        // Phase 5 : Normalisation catégorie
        const CATS = ["engrais","phyto","emballage","materiel","semences","autre"];
        const normCat = (raw) => {
          if (!raw) return "autre";
          const v = String(raw).toLowerCase().trim();
          return CATS.find(c => v.includes(c)) || "autre";
        };

        // Phase 6 : Écriture Firestore en batch (chunks de 400)
        const now = Date.now();
        const importedBy = imported_by || { uid: "system", email: "import@sql", name: "Import SQL" };
        let imported = 0, skipped = 0;
        const skippedNames = [];
        let batch = db_firestore.batch(), batchCount = 0;

        for (const row of sqlRows) {
          const nom = (row.nom || "").toString().trim();
          const ice = (row.ice || "").toString().trim();
          if (!nom) { skipped++; continue; }
          const iceKey = ice ? ice.toLowerCase() : null;
          if ((iceKey && existingByIce[iceKey]) || existingByNom[nom.toLowerCase()]) {
            skipped++; skippedNames.push(nom); continue;
          }
          const docRef = db_firestore.collection("suppliers").doc();
          batch.set(docRef, {
            nom, ice: ice || "",
            adresse: (row.adresse || "").toString().trim(),
            ville: (row.ville || "").toString().trim(),
            tel: (row.tel || "").toString().trim(),
            email: (row.email || "").toString().trim(),
            contact_nom: (row.contact_nom || "").toString().trim(),
            categorie: normCat(row.categorie),
            status: "valide",
            active: true,
            created_by: importedBy,
            source: "sql_import",
            history: [{ action: "import_sql", by: importedBy, at: now,
              comment: "Importé automatiquement depuis BR_Achat (SQL Server)" }],
            created_at: now, updated_at: now,
          });
          batchCount++; imported++;
          if (batchCount >= 400) { await batch.commit(); batch = db_firestore.batch(); batchCount = 0; }
        }
        if (batchCount > 0) await batch.commit();

        await db_firestore.collection("supplier_imports").add({
          type: "sql_import", source: "BR_Achat", imported_by: importedBy, imported_at: now,
          stats: { total_sql: sqlRows.length, imported, skipped },
          columns_mapped: { nomCol, iceCol, adresseCol, villeCol, telCol, emailCol, contactCol, categorieCol },
        });

        return res.json({
          success: true,
          stats: { total_found: sqlRows.length, imported, skipped, skipped_sample: skippedNames.slice(0, 10) },
          columns_mapped: { nomCol, iceCol, adresseCol, villeCol, telCol, emailCol, contactCol, categorieCol },
        });
      }


      // ========== IMPORT FOURNISSEURS DEPUIS EXCEL ==========

      if (action === "import-fournisseurs-xls" && req.method === "POST") {
        const { file_base64, imported_by, dry_run } = req.body || {};
        if (!file_base64) return res.status(400).json({ success: false, error: "Fichier Excel requis (file_base64)" });

        const XLSX = require("xlsx");
        const buffer = Buffer.from(file_base64, "base64");
        const wb = XLSX.read(buffer, { type: "buffer" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

        if (rows.length < 2) return res.status(400).json({ success: false, error: "Fichier vide ou sans données" });

        // Normalisation des villes
        const VILLE_CORRECTIONS = {
          "CASA BLANCA": "CASABLANCA", "CIDI KACEM": "SIDI KACEM",
          "MOULAY": "MOULAY BOUSELHAM",
        };
        const normalizeVille = (v) => {
          const trimmed = (v || "").toString().trim().toUpperCase();
          return VILLE_CORRECTIONS[trimmed] || trimmed;
        };

        // Parse rows (skip header)
        const parsed = [];
        const warnings = [];
        const seenICE = {};

        for (let i = 1; i < rows.length; i++) {
          const r = rows[i];
          const nom = (r[1] || "").toString().trim();
          if (!nom) { warnings.push(`Ligne ${i + 1}: nom vide, ignorée`); continue; }

          const code = (r[0] || "").toString().trim();
          const prenom = (r[3] || "").toString().trim();
          const civilite = (r[4] || "").toString().trim();
          const nomContact = (r[2] || "").toString().trim();
          const contactParts = [civilite, nomContact, prenom].filter(Boolean);
          const contact_nom = contactParts.join(" ");

          const ice = (r[12] || "").toString().trim();
          const identifiant_fiscal = (r[13] || "").toString().trim();
          const tel = (r[8] || "").toString().trim();
          const gsm = (r[9] || "").toString().trim();
          const email = (r[11] || "").toString().trim().toLowerCase();
          const adresse = (r[5] || "").toString().trim();
          const ville = normalizeVille(r[6]);

          // Détection ICE dupliqué dans le fichier
          if (ice) {
            if (seenICE[ice]) {
              warnings.push(`ICE dupliqué "${ice}" : "${nom}" (ligne ${i + 1}) et "${seenICE[ice].nom}" — ICE ignoré pour le second`);
              parsed.push({ code, nom, contact_nom, adresse, ville, tel, gsm, email, ice: "", identifiant_fiscal });
              continue;
            }
            seenICE[ice] = { nom, line: i + 1 };
          }

          parsed.push({ code, nom, contact_nom, adresse, ville, tel, gsm, email, ice, identifiant_fiscal });
        }

        // Déduplication avec Firestore existant
        const existingSnap = await db_firestore.collection("suppliers").get();
        const existingByIce = {}, existingByNom = {};
        existingSnap.docs.forEach(doc => {
          const d = doc.data();
          if (d.ice && d.ice.trim()) existingByIce[d.ice.trim().toLowerCase()] = { id: doc.id, nom: d.nom };
          if (d.nom && d.nom.trim()) existingByNom[d.nom.trim().toLowerCase()] = { id: doc.id, nom: d.nom };
        });

        const toImport = [], duplicates = [], incomplete = [];
        for (const row of parsed) {
          const iceKey = row.ice ? row.ice.toLowerCase() : null;
          const nomKey = row.nom.toLowerCase();
          if (iceKey && existingByIce[iceKey]) {
            duplicates.push({ ...row, reason: `ICE "${row.ice}" existe déjà (${existingByIce[iceKey].nom})` });
          } else if (existingByNom[nomKey]) {
            duplicates.push({ ...row, reason: `Nom "${row.nom}" existe déjà` });
          } else {
            toImport.push(row);
            if (!row.ice && !row.tel && !row.adresse) {
              incomplete.push(row.nom);
            }
          }
        }

        // Dry-run : retourner le rapport sans écrire
        if (dry_run) {
          return res.json({
            success: true, dry_run: true,
            stats: { total_fichier: parsed.length, a_importer: toImport.length, doublons: duplicates.length, incomplets: incomplete.length },
            duplicates: duplicates.map(d => ({ code: d.code, nom: d.nom, reason: d.reason })),
            incomplete,
            warnings,
            preview: toImport.slice(0, 10).map(r => ({ code: r.code, nom: r.nom, ville: r.ville, ice: r.ice })),
          });
        }

        // Écriture Firestore en batch
        const now = Date.now();
        const importedBy = imported_by || { uid: "system", email: "import@xls", name: "Import Excel" };
        let imported = 0;
        let batch = db_firestore.batch(), batchCount = 0;

        for (const row of toImport) {
          const docRef = db_firestore.collection("suppliers").doc();
          batch.set(docRef, {
            nom: row.nom, ice: row.ice, adresse: row.adresse, ville: row.ville,
            tel: row.tel, gsm: row.gsm, email: row.email,
            contact_nom: row.contact_nom,
            code_fournisseur: row.code,
            identifiant_fiscal: row.identifiant_fiscal,
            categorie: "autre",
            status: "valide",
            active: true,
            created_by: importedBy,
            source: "xls_import",
            history: [{ action: "import_xls", by: importedBy, at: now,
              comment: "Importé depuis fichier Excel (Les fournisseurs)" }],
            created_at: now, updated_at: now,
          });
          batchCount++; imported++;
          if (batchCount >= 400) { await batch.commit(); batch = db_firestore.batch(); batchCount = 0; }
        }
        if (batchCount > 0) await batch.commit();

        await db_firestore.collection("supplier_imports").add({
          type: "xls_import", source: "fichier_excel", imported_by: importedBy, imported_at: now,
          stats: { total_fichier: parsed.length, imported, doublons: duplicates.length, incomplets: incomplete.length },
          warnings,
        });

        return res.json({
          success: true,
          stats: { total_fichier: parsed.length, imported, doublons: duplicates.length, incomplets: incomplete.length },
          duplicates: duplicates.map(d => ({ code: d.code, nom: d.nom, reason: d.reason })),
          warnings,
        });
      }


      // ========== CATALOGUE ARTICLES SQL ==========

      if (action === "import-articles-sql" && req.method === "POST") {
        const db = await getPool();
        const sqlRes = await db.request().query(`
          SELECT LTRIM(RTRIM(Article)) AS nom,
            Article_Categorie AS categorie,
            Article_Sous_Categorie AS sous_categorie,
            UPPER(LTRIM(RTRIM(Unite))) AS unite,
            AVG(NULLIF(Cout,0)/NULLIF(Quantite,0)) AS prix_ref,
            COUNT(*) AS nb_achats
          FROM BR_Achat
          WHERE is_archive=0 AND Article IS NOT NULL AND LEN(LTRIM(RTRIM(Article)))>0
            AND Article NOT IN ('INVENTAIRE','STOCK INITIAL')
            AND Article NOT LIKE 'INV-%'
          GROUP BY LTRIM(RTRIM(Article)), Article_Categorie, Article_Sous_Categorie, UPPER(LTRIM(RTRIM(Unite)))
          ORDER BY Article_Categorie, LTRIM(RTRIM(Article))
        `);
        const rows = sqlRes.recordset;
        const now = Date.now();
        let imported = 0, updated = 0;
        let batch = db_firestore.batch(), batchCount = 0;

        // Index de résolution construit UNE SEULE FOIS avant la boucle.
        // Remplace le get() par ligne qui était fait ici : 1 lecture de collection
        // au lieu de N lectures unitaires (et c'est ce qui rend la résolution par
        // nom possible sans dégrader l'import).
        const sqlCatalogSnap = await db_firestore.collection("articles_catalog").get();
        const sqlIndex = articleMerge.buildArticleIndex(
          sqlCatalogSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        );

        for (const row of rows) {
          const nom = (row.nom || "").trim();
          if (!nom) continue;
          // FORMULE D'IDENTIFIANT INCHANGÉE (categorie brute) : la normaliser ici
          // réétiquetterait toutes les fiches existantes et l'import suivant
          // recréerait une vague de doublons. On corrige la RÉSOLUTION, pas l'id.
          const docId = Buffer.from(`${nom}|${row.categorie || ""}`).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 50);
          const target = articleMerge.resolveArticleTarget(sqlIndex, docId, nom);
          const data = {
            nom,
            // LIBELLÉ CANONIQUE à l'enregistrement (et NON la minuscule d'avant) :
            // la source SQL renvoie `engrais`/`pesticides`, qui repeuplaient le
            // catalogue de variantes à chaque réimport. La formule du docId,
            // elle, reste sur la catégorie BRUTE (cf. ci-dessus) : le réimport
            // retrouve donc la fiche et se contente de corriger son libellé.
            categorie: articleCategories.categorieCanonique(row.categorie),
            sous_categorie: row.sous_categorie || "",
            unite: row.unite || "KG",
            prix_ref: row.prix_ref ? Math.round(row.prix_ref * 100) / 100 : null,
            nb_achats: row.nb_achats || 0,
            source: "sql_import",
            active: true,
            updated_at: now,
          };
          const docRef = db_firestore.collection("articles_catalog").doc(target.id);
          // Un document EXISTE déjà à cet identifiant sans être résolu ? C'est une
          // fiche désactivée par `validate-delete-article` : ni active (donc hors
          // de byId/byName), ni fusionnée (donc pas de redirection merged_into).
          // Un `set()` la REMPLACERAIT — prix_pmp, nb_achats et created_at perdus,
          // et la valorisation de l'article tomberait à zéro. On met à jour, comme
          // le faisait le code d'origine sur `existSnap.exists`.
          const sqlReactivation = target.isNew && sqlIndex.allIds.has(target.id);
          if (!target.isNew || sqlReactivation) { batch.update(docRef, data); updated++; }
          else {
            batch.set(docRef, { ...data, created_at: now });
            imported++;
          }
          // La fiche écrite entre dans l'index : deux lignes du MÊME import ne
          // différant que par la casse de la catégorie convergent sur elle.
          if (target.isNew) articleMerge.rememberArticle(sqlIndex, target.id, nom);
          batchCount++;
          if (batchCount >= 400) { await batch.commit(); batch = db_firestore.batch(); batchCount = 0; }
        }
        if (batchCount > 0) await batch.commit();
        return res.json({ success: true, stats: { total: rows.length, imported, updated } });
      }


      if (action === "import-articles-excel" && req.method === "POST") {
        const { articles } = req.body;
        if (!articles || !articles.length) return res.status(400).json({ success: false, error: "articles[] requis" });
        const now = Date.now();
        let imported = 0, updated = 0, skipped = 0;

        // Pre-fetch all existing articles in one query
        const existingSnap = await db_firestore.collection("articles_catalog").get();
        const existingMap = {};
        existingSnap.docs.forEach(d => { existingMap[d.id] = d.data(); });
        // Même index de résolution que l'import SQL : une fiche active de même
        // nom normalisé est MISE À JOUR, jamais dupliquée.
        const xlsIndex = articleMerge.buildArticleIndex(
          existingSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        );

        let batch = db_firestore.batch(), batchCount = 0;
        for (const art of articles) {
          const nom = (art.nom || "").trim();
          if (!nom) { skipped++; continue; }
          const ref = (art.reference || "").trim();
          // FORMULE D'IDENTIFIANT INCHANGÉE — cf. import-articles-sql.
          const docId = ref
            ? ref.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 50)
            : Buffer.from(`${nom}|${art.categorie || ""}`).toString("base64").replace(/[^a-zA-Z0-9]/g, "").slice(0, 50);
          const target = articleMerge.resolveArticleTarget(xlsIndex, docId, nom);
          const data = {
            nom, reference: ref,
            reference_technique: (art.reference_technique || "").trim(),
            // LIBELLÉ CANONIQUE — cf. import-articles-sql. C'est ce chemin qui a
            // posé `IMMOBILISATIONS` (11 fiches) et `PHYTO-SANITAIRE` (2).
            categorie: articleCategories.categorieCanonique(art.categorie),
            sous_categorie: (art.sous_categorie || "").trim(),
            unite: (art.unite || "U").trim(),
            prix_ht: art.prix_ht || 0, taux_tva: art.taux_tva || 0, prix_ttc: art.prix_ttc || 0,
            prix_ref: art.prix_ht || null,
            type_article: (art.type || "").trim(),
            invisible: art.invisible || 0, multi_ferme: art.multi_ferme || 0,
            source: "excel_import", active: true, updated_at: now,
          };
          // ⚠️ NE PAS écrire `reference` sur une fiche résolue par NOM (ou par
          // redirection) : son docId est celui d'une AUTRE fiche — souvent un
          // base64 issu de l'import SQL — et y poser la référence de la ligne
          // Excel fabriquerait un document où `docId !== reference`. Or
          // `suggest-article-duplicates` renvoie `data.reference || d.id` alors
          // que `merge-articles` résout par `doc(master_ref)` : la fusion depuis
          // l'écran Catalogue partirait en 404. C'est exactement l'invariant que
          // 5 fiches cassent déjà en prod (ex. AZO PRO : ENG0149 / « ENG 0149 »)
          // et que ce lot ne doit surtout pas propager.
          if (target.matchedBy === "nom" || target.matchedBy === "merged_into") delete data.reference;
          const docRef = db_firestore.collection("articles_catalog").doc(target.id);
          const existing = existingMap[target.id];
          // Même garde de résurrection que l'import SQL : un `set()` sur une fiche
          // désactivée la remplacerait (prix_ref, nb_achats, created_at perdus).
          const xlsReactivation = target.isNew && xlsIndex.allIds.has(target.id);
          if (!target.isNew || xlsReactivation) {
            if (data.prix_ht > 0 || !(existing && existing.prix_ref)) data.prix_ref = data.prix_ht || (existing && existing.prix_ref) || null;
            data.nb_achats = (existing && existing.nb_achats) || 0;
            batch.update(docRef, data);
            updated++;
          } else {
            batch.set(docRef, { ...data, nb_achats: 0, created_at: now });
            imported++;
          }
          if (target.isNew) articleMerge.rememberArticle(xlsIndex, target.id, nom);
          batchCount++;
          if (batchCount >= 450) { await batch.commit(); batch = db_firestore.batch(); batchCount = 0; }
        }
        if (batchCount > 0) await batch.commit();
        return res.json({ success: true, stats: { total: articles.length, imported, updated, skipped } });
      }


      if (action === "list-articles") {
        const { categorie, q } = req.query;
        let query = db_firestore.collection("articles_catalog").where("active", "==", true);
        const snap = await query.get();
        let articles = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        if (categorie) {
          const catLower = categorie.toLowerCase();
          articles = articles.filter(a => (a.categorie || "").toLowerCase() === catLower);
        }
        articles.sort((a, b) => (a.nom || "").localeCompare(b.nom || "", "fr", { sensitivity: "base" }));
        if (q) { const ql = q.toLowerCase(); articles = articles.filter(a => a.nom.toLowerCase().includes(ql)); }
        return res.json({ success: true, articles });
      }


      // --- CONSO VALORISÉE AU PMP (lecture seule) -------------------------
      // État CONSOMMATION par parcelle / Ha / famille (engrais|pesticide|autre),
      // VALORISÉE au PMP grand livre (articles_catalog.prix_pmp), depuis le
      // 01/07/2025. AUCUNE écriture, AUCUN recalcul du PMP : on lit le mirror
      // de conso + le PMP catalogue et on agrège en mémoire (module pur).
      // Périmètre = consommation SAISIE uniquement (plancher) — cf. bandeau UI.
      if (action === "conso-valorisee") {
        const DEFAULT_SINCE = "2025-07-01";
        // 0) CONTRÔLE D'ACCÈS — barrière sécurité. Le périmètre ferme est IMPOSÉ
        //    serveur via le profil de l'appelant (users/{uid}). Un Chef de Ferme
        //    est forcé sur SA ferme : tout param ?ferme= incompatible est ignoré.
        let callerProfile = {};
        if (authUser && authUser.uid && authUser.uid !== "admin-cli") {
          const uDoc = await db_firestore.collection("users").doc(authUser.uid).get();
          callerProfile = uDoc.exists ? (uDoc.data() || {}) : {};
        } else if (authUser && authUser.uid === "admin-cli") {
          // Accès CLI admin-secret : périmètre global.
          callerProfile = { profileId: "dg", role: "admin" };
        }
        const fermeDemandee = req.query.ferme;
        const perim = consoAccessControl.resolvePerimetre(callerProfile, fermeDemandee);
        if (!perim.autorise) {
          return res.status(403).json({ success: false, error: perim.error || "Accès non autorisé" });
        }
        // Périmètre vide (chef sans ferme résolue) : on renvoie un agrégat vide.
        if (perim.ferme_filtre === "__none__") {
          return res.json({
            success: true,
            role: perim.role,
            perimetre_ferme: perim.perimetre_ferme,
            perimetre_culture: perim.culture_filtre || null,
            parcelles_ferme_indeterminee: [],
            since: DEFAULT_SINCE,
            campagne: "2025/2026",
            dateExtraction: new Date().toLocaleDateString("fr-FR"),
            parcelles: [], par_ferme: [], par_culture: [],
            total: { total_engrais_mad: 0, total_pest_mad: 0, total_autre_mad: 0, total_mad: 0, nb_parcelles: 0 },
            couverture: { nb_articles_total: 0, nb_valorises: 0, pct_articles: 0, qte_totale: 0, qte_valorisee: 0, pct_quantite: 0 },
            articles_non_valorises: [],
          });
        }

        // 1) Filtres période + culture (paramètres optionnels).
        const since = (req.query.since && /^\d{4}-\d{2}-\d{2}$/.test(req.query.since)) ? req.query.since : DEFAULT_SINCE;
        const culture = req.query.culture && String(req.query.culture).trim() ? String(req.query.culture).trim() : undefined;
        // NOTE: on ne filtre PAS sur un champ Ferme de la source.
        // Dans le mirror BEE ONE il valait « BERRY GOOD Farms » sur 100 % des
        // lignes ; dans les bons Smart Berry, `item.ferme` porte cette même
        // valeur fourre-tout sur 212 items /500 (mesuré en prod). Inexploitable
        // dans les deux cas : la vraie ferme est encodée dans le libellé de
        // parcelle. Le cloisonnement chef se fait ci-dessous par dérivation
        // en mémoire, fail-closed — inchangé.

        // 2) Lignes de conso depuis les BONS SMART BERRY (`consumption_vouchers`).
        //    Bascule décidée par Omar (ticket sb/conso-campagne-bons) : la source
        //    BEE ONE `sql_mirror_consommation` est TARIE (dernières lignes en
        //    avril 2026), la consommation réelle est saisie dans les bons par le
        //    magasinier. Bons UNIQUEMENT : pas d'union avec BEE ONE, pas de
        //    bascule à une date. Conséquence ASSUMÉE : la période antérieure aux
        //    premiers bons s'affiche vide. Rien n'est supprimé côté BEE ONE, et
        //    `getConsommationRows` reste utilisé par les autres écrans
        //    (fertigation, phytosanitaire, produits, parcelles, dashboard,
        //    agroSummary, exports campagne).
        //    L'adaptateur produit exactement la forme de ligne mirror consommée
        //    par `aggregateConsoValorisee` — aucun changement en aval.
        const [bonsConso, refParcelles, catalogueDocs] = await Promise.all([
          consoBons.fetchBonsConsommation(db_firestore),
          consoBons.fetchReferentielParcelles(db_firestore),
          // UNE SEULE lecture d'`articles_catalog`, pour DEUX usages : le PMP
          // (§3 ci-dessous) et la catégorie par article. Cette lecture existait
          // déjà plus bas ; elle est simplement remontée ici. Ne pas la
          // dédoubler en appelant `consoBons.fetchArticleCategories`.
          db_firestore.collection("articles_catalog").get().then((snap) => {
            const out = [];
            snap.forEach((doc) => out.push(doc.data() || {}));
            return out;
          }),
        ]);
        // Index « nom d'article → catégorie ». La catégorie était jusqu'ici
        // JETÉE à la construction de la map PMP, et `Article_Categorie` valait
        // la catégorie du BON ENTIER — d'où BENEVIA compté en engrais.
        const catByArticle = consoBons.buildArticleCategoryIndex(catalogueDocs);
        let consoRows = consoBons.adaptBonsToConsoRows(bonsConso, {
          since,
          haByLabel: refParcelles.haByLabel,
          sbMap: refParcelles.sbMap,
          catByArticle,
        });
        // Filtre culture optionnel (param client), à l'identique de l'ancien
        // filtre `getConsommationRows({culture})` — mais sur la culture RÉSOLUE
        // (référentiel SB puis repli), et non sur le champ brut du bon, vide ou
        // sale sur la majorité des items.
        if (culture) {
          consoRows = consoRows.filter((r) => r.Culture === culture);
        }

        // Libellés dont la ferme est indéterminable — capturés AVANT tout filtre
        // de périmètre : après filtrage ils ont justement disparu, et la liste
        // serait systématiquement vide pour le seul profil que ça concerne.
        const fermeIndeterminee = consoBons.resolveFermeInconnue(
          consoRows.map((r) => r.Parcelle_Culturale)
        );

        // 2bis) Cloisonnement ferme FAIL-CLOSED pour un périmètre chef.
        //   perimetre_ferme === 'all' (DG/Finance/admin) → aucune restriction,
        //   y compris les parcelles non dérivables. Sinon (chef), on ne garde
        //   QUE les lignes dont la ferme dérivée du libellé == son périmètre.
        //   Une parcelle dérivée à null est EXCLUE (jamais montrée à un chef).
        //   Dérivation = `consoBons.fermeDeParcelle`, RÈGLE UNIQUE partagée avec
        //   l'écran Campagne. Elle compose `deriveFermeFromParcelle` (utilisée
        //   ici jusqu'ici) et le repli SECTEUR : sans ce repli, `chef_f5`
        //   perdait ses 2 parcelles S8 (BREEZE/CASCADE MYRTILLE, 40 lignes),
        //   dérivées à null par la seule règle valorisation.
        if (perim.perimetre_ferme !== 'all') {
          const cible = perim.perimetre_ferme;
          consoRows = consoRows.filter(
            (r) => consoBons.fermeDeParcelle(r.Parcelle_Culturale) === cible
          );
        }
        // 2ter) Cloisonnement CULTURE FAIL-CLOSED — barrière IMPOSÉE serveur.
        //   Sans elle, `chef_f1` (perimetre_ferme 'all' + culture_filtre
        //   'Framboise') échappait à TOUT filtrage : le bloc 2bis est sauté pour
        //   un périmètre 'all', et la culture n'était appliquée nulle part.
        //   Mesuré avant correction : `chef_f1` recevait les 500 lignes, dont 78
        //   d'Avocatier et 125 de F5-Myrtille. `chef_f5` voyait en plus les
        //   parcelles F5-Framboise. Le filtre porte sur la culture RÉSOLUE par
        //   l'adaptateur (référentiel `culture_sb` puis repli), jamais sur le
        //   champ brut du bon. C'est le pendant exact du filtre appliqué dans
        //   `aggregateConsoParcelle` pour l'écran Campagne.
        //   ⚠️ Distinct du `?culture=` client ci-dessus : celui-ci est un confort
        //   d'affichage, celui-là n'est pas négociable.
        if (perim.culture_filtre) {
          consoRows = consoRows.filter((r) => r.Culture === perim.culture_filtre);
        }
        // 3) Map de PMP par canon(nom) depuis articles_catalog, déjà lu ci-dessus.
        const canon = consoValorisationLib.canon;
        const pmpMap = {};
        catalogueDocs.forEach((a) => {
          if (!a.nom) return;
          const p = parseFloat(a.prix_pmp);
          if (!isFinite(p)) return;
          const key = canon(a.nom);
          // Garde l'entrée au prix_pmp le plus élevé si collision sur le canon
          // (préfère un vrai prix à un placeholder <=1).
          if (!pmpMap[key] || p > pmpMap[key].pmp) {
            pmpMap[key] = { pmp: p, source: a.prix_pmp_source || "pmp" };
          }
        });
        // 4) Agrégation pure.
        const agg = consoValorisationLib.aggregateConsoValorisee(consoRows, pmpMap);
        // Liste à plat des articles non valorisés (toutes parcelles), dédoublonnée.
        const nonValMap = {};
        for (const p of agg.parcelles) {
          for (const a of (p.articles_non_valorises || [])) {
            const k = canon(a.article) + "|" + (a.unite || "");
            if (!nonValMap[k]) nonValMap[k] = { article: a.article, unite: a.unite, famille: a.famille, source_prix: a.source_prix, quantite: 0 };
            nonValMap[k].quantite += a.quantite || 0;
          }
        }
        const articles_non_valorises = Object.values(nonValMap);
        return res.json({
          success: true,
          role: perim.role,
          perimetre_ferme: perim.perimetre_ferme,
          // Périmètre cultural IMPOSÉ (chef_f1 → Framboise, chef_f5 → Myrtille).
          // Additif : rend le cloisonnement lisible côté client au lieu de le
          // laisser deviner à partir d'un tableau incomplet.
          perimetre_culture: perim.culture_filtre || null,
          since,
          culture: culture || null,
          campagne: "2025/2026",
          dateExtraction: new Date().toLocaleDateString("fr-FR"),
          // Libellés dont la ferme est indéterminable : ils sont EXCLUS du
          // périmètre d'un chef (fail-closed). Remontés pour que l'écran puisse
          // le dire, plutôt que d'afficher un tableau vide sans explication.
          // Vide sur les 19 libellés réels d'aujourd'hui.
          parcelles_ferme_indeterminee: fermeIndeterminee,
          articles_non_valorises,
          ...agg,
        });
      }

  return NOT_HANDLED;
};
