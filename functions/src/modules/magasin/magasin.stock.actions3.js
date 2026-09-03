/* Actions 3/6 de stockManagement — corps repris VERBATIM.
   Le contexte du handler (req, res, action, helpers) arrive par `ctx` ; la
   destructuration ci-dessous recree exactement les liaisons d'origine, si bien
   que les corps n'ont pas ete touches. */
'use strict';
const { NOT_HANDLED } = require("./_dispatch");
const { admin, bucket, db_firestore, demandeCreationArticle, invalidateApiCachePrefix, resolveCallerRole, articleMerge, articleCategories, stockRoles, consoValorisationLib, consoBons, uniteConso, identiteArticle, invalidateIdentiteArticleIndex, getIdentiteArticleIndex, enregistrerDemandesCreation, cloturerDemandesCreationSatisfaites, getNextNumber } = require("./magasin.stock.deps");

module.exports = async function stockActions3(ctx) {
  const { req, res, action, adminSecret, authUser, updateStockBalance, applyStockImpact, reverseStockImpact, getChefProfileForFerme, resolveRequesterIdentity } = ctx;



      if (action === "update-article" && req.method === "POST") {
        const { id, updates, updated_by } = req.body;
        // Rôle résolu SERVEUR (jamais depuis le body) — sans cette garde,
        // n'importe quel utilisateur authentifié réécrivait n'importe quelle
        // fiche du catalogue.
        //
        // Périmètre INCHANGÉ : `achats` ou `dg`, accès complet pour les deux.
        // La condition n'a fait que sortir du monolithe vers le module pur
        // `lib/stockRoles` (testable) ; elle n'a été ni élargie ni restreinte.
        // Le message de refus, lui, est corrigé : il disait « Réservé au
        // responsable achats » alors que le DG passait.
        //
        // AJOUT 2026-08-29 (ticket sb/unite-conversion) : le MAGASINIER entre
        // dans cette action, mais sur DEUX CHAMPS SEULEMENT —
        // `unite_consommation` et `stock_par_unite_consommation`. C'est lui qui
        // sait qu'un fût d'acide nitrique de 25 L pèse 33 kg, et c'est lui que
        // la ligne non convertible bloque au quotidien ; il n'a en revanche
        // aucun accès à l'écran Stock › Articles.
        // ⚠️ La décision se prend sur le CONTENU RÉEL de `updates`, jamais sur
        // une déclaration du client : un magasinier qui joindrait `prix_ht` est
        // refusé en bloc. `achats`/`dg` ne sont PAS bridés par champ (cf. le
        // pavé d'en-tête de lib/stockRoles/articlePermissions.js : ce bridage a
        // déjà été tenté et retiré).
        const updateArticleRole = await resolveCallerRole(authUser);
        const updateArticlePerm = stockRoles.peutModifierChampsArticle(updateArticleRole, updates);
        if (!updateArticlePerm.ok) {
          return res.status(403).json({ success: false, error: updateArticlePerm.raison });
        }
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        // `unite_consommation` / `stock_par_unite_consommation` : conversion
        // « unité de consommation → unité de stock » (lib/uniteConso). Le
        // facteur se lit « 1 <unite_consommation> = X <unite> ».
        const allowed = ["nom", "reference", "reference_technique", "unite", "prix_ht", "taux_tva", "prix_ttc", "categorie", "sous_categorie", "type", "multi_ferme", "unite_consommation", "stock_par_unite_consommation"];
        const clean = {};
        for (const k of allowed) { if (updates && updates[k] !== undefined) clean[k] = updates[k]; }
        // La conversion est NORMALISÉE ici, à l'écriture, et une seule fois :
        // un facteur illisible (« abc », 0, négatif) est écrit `null` plutôt
        // que stocké tel quel. Une fiche ne doit jamais porter un facteur que
        // le module de conversion refusera silencieusement à la lecture — sinon
        // l'écran affiche une conversion et le stock en applique une autre.
        if (clean.unite_consommation !== undefined) {
          clean.unite_consommation = clean.unite_consommation === null ? null : String(clean.unite_consommation).trim();
        }
        if (clean.stock_par_unite_consommation !== undefined) {
          clean.stock_par_unite_consommation = uniteConso.lireFacteur(clean.stock_par_unite_consommation);
        }
        clean.updated_at = Date.now();
        // TRAÇABILITÉ : l'identité vient du TOKEN, pas du body. Le client peut
        // enrichir (nom affiché), mais ni se renommer ni s'effacer : sans ces
        // trois champs imposés, un `updated_by: {}` rendait la modification
        // anonyme — y compris un changement de catégorie fait par le DG.
        clean.updated_by = Object.assign({}, updated_by || {}, {
          uid: (authUser && authUser.uid) || null,
          email: (authUser && authUser.email) || null,
          profileId: updateArticleRole || null,
        });
        await db_firestore.collection("articles_catalog").doc(id).update(clean);
        // Une catégorie modifiée change ce que renvoie `campagne-conso-parcelle`
        // (catégorie résolue à la LECTURE) : son cache 30 min doit tomber.
        if (clean.categorie !== undefined) {
          await invalidateApiCachePrefix(consoBons.CONSO_PARCELLE_CACHE_PREFIX);
        }
        return res.json({ success: true });
      }


      // ------ CLASSER-ARTICLE : classer un article PAR SON NOM (bandeau Campagne) ------
      // Le bandeau « articles à classer » de Campagne › Campagne analytique ne
      // connaît que des NOMS d'articles (ceux lus sur les bons), jamais un
      // identifiant de fiche. D'où une action dédiée plutôt qu'un
      // `update-article` tordu : `update-article` écrit UNE fiche désignée par
      // son id, ce qui ne peut pas marcher ici.
      //
      // ⚠️ TOUTES les fiches actives de même nom normalisé sont mises à jour.
      // Le catalogue porte ~105 paires de doublons ; n'en reclasser qu'une rend
      // la clé AMBIGUË pour `lookupArticleCategorie` (fail-closed) et l'article
      // RESTE « à classer » — la correction paraîtrait sans effet.
      if (action === "classer-article" && req.method === "POST") {
        const { article, categorie, updated_by } = req.body || {};
        // MÊME règle de rôle qu'`update-article`, sur le même module pur
        // (`achats` ou `dg`) : classer un article, c'est écrire au catalogue,
        // il n'y a aucune raison que ce soit ouvert plus largement.
        const classerRole = await resolveCallerRole(authUser);
        const classerPerm = stockRoles.peutModifierArticle(classerRole);
        if (!classerPerm.ok) {
          return res.status(403).json({ success: false, error: classerPerm.raison });
        }
        const classerNom = article == null ? "" : String(article).trim();
        if (!classerNom) return res.status(400).json({ success: false, error: "Nom d'article requis" });
        // LIBELLÉ CANONIQUE — la même règle que create-article et les imports.
        // Le bandeau envoie `engrais` / `pesticide` : écrits tels quels, ils
        // fabriquaient une orthographe de plus à chaque classement (`pesticide`
        // au singulier n'existe nulle part ailleurs au catalogue).
        const classerCat = articleCategories.categorieCanonique(categorie);
        // Le classement n'ouvre PAS l'écriture d'une catégorie quelconque : la
        // porte du DG est « ranger dans l'une des deux familles de l'écran ».
        if (consoValorisationLib.familleBucket(classerCat) === "autre") {
          return res.status(400).json({
            success: false,
            error: "Catégorie invalide : seuls « engrais » et « pesticide » sont acceptés ici.",
          });
        }
        const classerSnap = await db_firestore.collection("articles_catalog").get();
        const classerCibles = stockRoles.referencesAClasserParNom(
          classerSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
          classerNom
        );
        if (classerCibles.length === 0) {
          // Aucune création implicite : deux articles des bons (GENAKTIS,
          // Maspilan) n'ont pas de fiche, et leur orthographe est à vérifier sur
          // le bon papier avant d'en créer une.
          return res.status(404).json({
            success: false,
            fiches_mises_a_jour: 0,
            error: "Aucune fiche active « " + classerNom + " » au catalogue. "
              + "Créez d'abord l'article dans Stock › Articles (vérifiez l'orthographe du bon).",
          });
        }
        const classerNow = Date.now();
        // Identité imposée par le TOKEN (cf. update-article).
        const classerBy = Object.assign({}, updated_by || {}, {
          uid: (authUser && authUser.uid) || null,
          email: (authUser && authUser.email) || null,
          profileId: classerRole || null,
        });
        // Chunks de 400 (limite Firestore 500/batch, marge de 100).
        for (let i = 0; i < classerCibles.length; i += 400) {
          const classerBatch = db_firestore.batch();
          classerCibles.slice(i, i + 400).forEach((refId) => {
            classerBatch.update(db_firestore.collection("articles_catalog").doc(refId), {
              categorie: classerCat,
              updated_at: classerNow,
              updated_by: classerBy,
            });
          });
          await classerBatch.commit();
        }
        // ⚠️ SANS CETTE PURGE, LA FONCTIONNALITÉ PARAÎT CASSÉE : la réponse de
        // `campagne-conso-parcelle` est cachée 30 min et la catégorie y est
        // résolue à la LECTURE. On classe, on recharge, rien ne bouge.
        // Purge par PRÉFIXE : une entrée existe par périmètre (`_all`, `_f1`,
        // `_f1_framboise`…), les énumérer serait un fail-open.
        const classerPurged = await invalidateApiCachePrefix(consoBons.CONSO_PARCELLE_CACHE_PREFIX);
        return res.json({
          success: true,
          article: classerNom,
          categorie: classerCat,
          fiches_mises_a_jour: classerCibles.length,
          references: classerCibles,
          cache_entrees_purgees: classerPurged,
        });
      }


      if (action === "create-article" && req.method === "POST") {
        const { reference, nom, unite, prix_ht, taux_tva, prix_ttc, categorie, sous_categorie, type, reference_technique, multi_ferme, created_by } = req.body;
        // Rôle résolu SERVEUR : il était lu depuis le body de la requête, donc
        // usurpable (et contournable en omettant simplement le champ).
        const createArticleRole = await resolveCallerRole(authUser);
        if (createArticleRole !== "achats" && createArticleRole !== "dg") {
          return res.status(403).json({ success: false, error: "Seul le responsable achats peut créer des articles" });
        }
        if (!nom || !reference) return res.status(400).json({ success: false, error: "Nom et référence requis" });
        const existing = await db_firestore.collection("articles_catalog").doc(reference).get();
        if (existing.exists && existing.data().active !== false) return res.status(400).json({ success: false, error: "Un article avec cette référence existe déjà" });
        const now = Date.now();
        const createData = {
          reference, nom, unite: unite || "U", prix_ht: prix_ht || 0, taux_tva: taux_tva || 20,
          prix_ttc: prix_ttc || 0, categorie: articleCategories.categorieCanonique(categorie), sous_categorie: sous_categorie || "",
          type: type || "", reference_technique: reference_technique || "", multi_ferme: multi_ferme || false,
          active: true, invisible: false, updated_at: now, created_by: created_by || {}
        };
        // Résolution par NOM NORMALISÉ avant création : une fiche active portant
        // déjà ce nom est MISE À JOUR. Sans cela, créer « Engrais NPK » alors que
        // « ENGRAIS  NPK » existe déjà pose un second docId — le doublon exact
        // que ce ticket ferme. La formule d'identifiant, elle, reste intacte.
        const createCatalogSnap = await db_firestore.collection("articles_catalog").get();
        const createIndex = articleMerge.buildArticleIndex(
          createCatalogSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        );
        const createTarget = articleMerge.resolveArticleTarget(createIndex, reference, nom);
        // Repli limité au match par NOM. La redirection `merged_into` est
        // légitime pour un IMPORT (même article, ancien identifiant) mais PAS
        // pour une saisie libre : une référence tapée qui tombe sur le docId
        // d'un doublon déjà fusionné enverrait l'update sur le MASTER de la
        // fusion et écraserait son nom par celui saisi ici.
        if (createTarget.matchedBy === "nom") {
          // On met à jour une fiche EXISTANTE : ni `nom` ni `reference` ne sont
          // touchés. Les écrire renommerait un autre article et casserait
          // l'invariant docId == reference (cf. import Excel ci-dessus) — le
          // tout sous l'apparence d'une création réussie.
          const createPatch = { ...createData };
          delete createPatch.nom;
          delete createPatch.reference;
          await db_firestore.collection("articles_catalog").doc(createTarget.id).update(createPatch);
          return res.json({
            success: true,
            id: createTarget.id,
            existing_article: true,
            updated_existing: true,
            matched_by: "nom",
            message: "Un article portant ce nom existait déjà : sa fiche a été mise à jour, aucune nouvelle fiche n'a été créée.",
          });
        }
        // La référence saisie est celle d'un doublon ABSORBÉ par une fusion. On
        // refuse plutôt que d'écrire : un `set()` remplacerait la pierre tombale
        // (`active:false` + `merged_into`), donc (a) le pointeur qui redirige les
        // imports futurs vers le master serait perdu, et (b) le doublon
        // RÉAPPARAÎTRAIT ACTIF au catalogue — une fusion annulée en silence.
        // NB : le rollback, lui, ne dépend PAS de cette tombe. Il vit dans le
        // document `article_merges` (master_ref, doublon_refs,
        // doublon_balances_snapshot, reassigned_*_ids) et survit à l'écrasement.
        //
        // La garde s'indexe sur `createIndex.mergedInto`, PAS sur
        // `createTarget.matchedBy` : `resolveArticleTarget` n'émet
        // `matchedBy: 'merged_into'` que si le master est ENCORE ACTIF. Si le
        // master a été désactivé depuis (validate-delete-article), la résolution
        // retombe en 'none' — ni repli par nom, ni refus — et on écrasait la
        // tombe. L'index, lui, est indépendant de l'état du master.
        if (createIndex.mergedInto.has(reference)) {
          return res.status(400).json({ success: false, error: "Cette référence est celle d'un article fusionné dans un autre. Choisir une autre référence." });
        }
        await db_firestore.collection("articles_catalog").doc(reference).set({ ...createData, created_at: now });
        // Purge de l'index d'identité : depuis le refus fail-closed, un index
        // périmé refuserait pendant 5 minutes un bon portant l'article qu'on
        // vient précisément de créer pour pouvoir le saisir. C'est la sortie
        // « Créer cet article au catalogue » — elle doit être immédiate.
        invalidateIdentiteArticleIndex();
        // ── LA VALIDATION DU DG, C'EST LA CRÉATION ELLE-MÊME ────────────────
        // Il n'y a pas de bouton « valider la demande » à cliquer : le DG crée
        // l'article sur l'écran Catalogue qu'il a déjà, et la demande se ferme
        // d'elle-même. La correspondance passe par `canon`, la MÊME règle que
        // l'identité — pas une comparaison de noms réécrite pour l'occasion.
        const demandesClosesCreate = await cloturerDemandesCreationSatisfaites(db_firestore)
          .catch((e) => { console.error("clôture demandes création:", e.message); return 0; });
        return res.json({ success: true, id: reference, demandes_closes: demandesClosesCreate });
      }


      if (action === "request-delete-article" && req.method === "POST") {
        const { article_id, article_nom, requested_by } = req.body;
        if (!article_id) return res.status(400).json({ success: false, error: "article_id requis" });
        const now = Date.now();
        const ref = await db_firestore.collection("article_delete_requests").add({
          article_id, article_nom: article_nom || "", status: "pending",
          requested_by: requested_by || {}, requested_at: now, validated_by: null, validated_at: null
        });
        return res.json({ success: true, id: ref.id });
      }


      if (action === "validate-delete-article" && req.method === "POST") {
        const { request_id, approved, validated_by } = req.body;
        // Rôle résolu SERVEUR : cette action écrit `active:false` sur une fiche
        // catalogue. Sans garde, n'importe quel utilisateur authentifié pouvait
        // désactiver n'importe quel article.
        // PÉRIMÈTRE = l'EXPOSITION RÉELLE de l'écran « Suppr. Articles »
        // (`fin_delete_articles`, NAV_ITEMS_FINANCE) : dg | finance | audit_interne.
        // La garde passe de « tout utilisateur authentifié » à « les profils qui
        // ont légitimement l'écran », rien de plus. Restreindre davantage — par
        // exemple retirer `audit_interne`, profil de lecture — retirerait une
        // capacité existante : c'est une décision PRODUIT, distincte de la
        // fermeture de cette faille, et elle ne se prend pas ici.
        const deleteArticleRole = await resolveCallerRole(authUser);
        if (deleteArticleRole !== "dg" && deleteArticleRole !== "finance" && deleteArticleRole !== "audit_interne") {
          return res.status(403).json({ success: false, error: "Réservé au DG, à la Finance ou à l'audit interne" });
        }
        if (!request_id) return res.status(400).json({ success: false, error: "request_id requis" });
        const docRef = db_firestore.collection("article_delete_requests").doc(request_id);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Demande introuvable" });
        const data = snap.data();
        const now = Date.now();
        if (approved) {
          await db_firestore.collection("articles_catalog").doc(data.article_id).update({ active: false, updated_at: now });
          // La fiche n'est plus une identité valide : l'index doit le voir tout
          // de suite, sinon la saisie continuerait 5 min à écrire du stock sous
          // un article supprimé.
          invalidateIdentiteArticleIndex();
          await docRef.update({ status: "approved", validated_by: validated_by || {}, validated_at: now });
        } else {
          await docRef.update({ status: "rejected", validated_by: validated_by || {}, validated_at: now });
        }
        return res.json({ success: true });
      }


      if (action === "list-delete-requests") {
        const { status } = req.query;
        let query = db_firestore.collection("article_delete_requests");
        if (status) query = query.where("status", "==", status);
        const snap = await query.get();
        const requests = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        requests.sort((a, b) => (b.requested_at || 0) - (a.requested_at || 0));
        return res.json({ success: true, requests });
      }


      // ========== DEMANDES DE CRÉATION D'ARTICLE (magasinier → DG) ==========
      //
      // Bâti sur le patron d'`article_delete_requests`, MAIS SANS SES DEUX
      // DÉFAUTS : ses actions `request-*` / `list-*` n'ont AUCUNE garde de rôle
      // (n'importe quel utilisateur authentifié pouvait demander la suppression
      // de n'importe quel article, et lire toutes les demandes), et elle
      // n'envoie AUCUNE notification — ni au valideur, ni au demandeur. Une
      // demande que personne ne voit n'est pas une demande.

      // --- DEMANDER la création d'un article (saisie explicite) ---
      if (action === "request-article-creation" && req.method === "POST") {
        // Rôle résolu SERVEUR, jamais depuis le body. Périmètre = les profils
        // qui saisissent réellement des bons de stock, plus ceux qui créent
        // l'article au bout de la chaîne.
        const demandeRole = await resolveCallerRole(authUser);
        const DEMANDE_ROLES = ["magasinier", "achats", "dg", "chef_f1", "chef_f5", "chef_avo"];
        if (!DEMANDE_ROLES.includes(demandeRole)) {
          return res.status(403).json({ success: false, error: "Profil non autorisé à demander la création d'un article" });
        }
        const libelleDemande = String((req.body && req.body.libelle) || "").trim();
        if (!libelleDemande) return res.status(400).json({ success: false, error: "libelle requis" });
        // Un article qui EXISTE déjà ne se demande pas : on le dit, plutôt que
        // d'ouvrir une demande que le DG refermerait aussitôt.
        const demandeIndex = await getIdentiteArticleIndex(db_firestore, { force: true });
        const dejaLa = identiteArticle.resoudreIdentite(libelleDemande, demandeIndex);
        if (dejaLa.issue === identiteArticle.ISSUE_RESOLU) {
          return res.json({
            success: true, deja_au_catalogue: true, article_id: dejaLa.ficheId,
            message: "L'article « " + dejaLa.nom + " » existe déjà au catalogue.",
          });
        }
        const demandesFaites = await enregistrerDemandesCreation(
          db_firestore,
          [{ issue: identiteArticle.ISSUE_INTROUVABLE, libelle: libelleDemande }],
          { uid: authUser.uid, profileId: demandeRole, name: (authUser && (authUser.name || authUser.email)) || "" },
          { origine: "request-article-creation", type: (req.body && req.body.origine) || "", numero: (req.body && req.body.numero) || "" }
        );
        return res.json({
          success: true,
          demandes_creation: demandesFaites,
          message: "Demande de création envoyée au DG pour « " + libelleDemande + " ».",
        });
      }


      // --- LISTER les demandes (écran DG / suivi) ---
      if (action === "list-article-creation-requests") {
        // Garde de rôle : lecture d'un flux de travail interne.
        const listeRole = await resolveCallerRole(authUser);
        const LISTE_ROLES = ["dg", "achats", "finance", "audit_interne", "magasinier"];
        if (!LISTE_ROLES.includes(listeRole)) {
          return res.status(403).json({ success: false, error: "Profil non autorisé" });
        }
        // Balayage de clôture AVANT de lister : sans lui, une demande satisfaite
        // par un autre chemin que `create-article` (import CANEVA, fusion)
        // resterait affichée indéfiniment.
        const closes = await cloturerDemandesCreationSatisfaites(db_firestore)
          .catch((e) => { console.error("clôture demandes création:", e.message); return 0; });
        let demandeQuery = db_firestore.collection(demandeCreationArticle.COLLECTION);
        if (req.query && req.query.statut) demandeQuery = demandeQuery.where("statut", "==", req.query.statut);
        const demandeSnap = await demandeQuery.get();
        const demandes = demandeSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        demandes.sort((a, b) => (b.derniere_demande_at || 0) - (a.derniere_demande_at || 0));
        return res.json({ success: true, demandes, demandes_closes: closes });
      }


      // --- CLÔTURER les demandes satisfaites (idempotent, sans effet de bord) ---
      if (action === "close-article-creation-requests" && req.method === "POST") {
        const clotureRole = await resolveCallerRole(authUser);
        if (clotureRole !== "dg" && clotureRole !== "achats") {
          return res.status(403).json({ success: false, error: "Réservé au DG et aux achats" });
        }
        const closes = await cloturerDemandesCreationSatisfaites(db_firestore);
        return res.json({ success: true, demandes_closes: closes });
      }


      // ========== FUSION D'ARTICLES EN DOUBLON ==========

      // --- SUGGEST DUPLICATES (groupes par nom normalisé, active=true, >=2) ---
      if (action === "suggest-article-duplicates") {
        // Rôle résolu SERVEUR (jamais depuis le body), règle PURE partagée avec
        // `merge-articles` : `achats` OU `dg`. La garde était en dur sur
        // `achats`, un profil qu'aucun humain n'utilise — la fusion des ~105
        // paires de doublons n'a donc jamais pu être lancée en production.
        const callerRole = await resolveCallerRole(authUser);
        const suggestDupPerm = stockRoles.peutFusionnerArticles(callerRole);
        if (!suggestDupPerm.ok) {
          return res.status(403).json({ success: false, error: suggestDupPerm.raison });
        }
        const snap = await db_firestore.collection("articles_catalog").where("active", "==", true).get();
        // `prix_pmp`, `prix_ht` et `nb_achats` sont les DONNÉES DE DÉCISION :
        // `merge-articles` ne les transfère PAS du doublon vers le maître, donc
        // retenir la fiche sans prix laisse un article actif non valorisable.
        // Sans elles dans la projection, l'écran ne peut ni les afficher ni
        // suggérer un maître (cf. lib/stockMerge/masterSuggestion.js).
        const articles = snap.docs.map(d => {
          const data = d.data();
          return {
            // `id` = docId : SEULE clé acceptée par `merge-articles`, qui
            // résout par `.doc(<clé>)`. Le champ `reference` diverge du docId
            // sur 92 fiches (« ENG 0149 » vs « ENG0149 ») et 5 documents
            // fantômes existent aux références espacées : l'envoyer comme
            // master_ref ferait fusionner vers un document sans nom.
            id: d.id,
            reference: data.reference || d.id,
            nom: data.nom || "",
            categorie: data.categorie || "",
            unite: data.unite || "",
            prix_pmp: data.prix_pmp === undefined ? null : data.prix_pmp,
            prix_ht: data.prix_ht === undefined ? null : data.prix_ht,
            nb_achats: data.nb_achats === undefined ? null : data.nb_achats,
          };
        });
        const groups = articleMerge.groupDuplicates(articles);
        return res.json({ success: true, groups });
      }


      // --- MERGE ARTICLES (preview | execute) ---
      if (action === "merge-articles" && req.method === "POST") {
        const { master_ref, doublon_refs, mode, by } = req.body || {};
        // Rôle : `achats` OU `dg` — résolu depuis le token Firebase (anti-spoof
        // body), via la MÊME règle pure que `suggest-article-duplicates`. Le
        // message disait « Seul le responsable achats » alors que la fusion est
        // une écriture au catalogue, ouverte au DG comme update-article.
        const callerRole = await resolveCallerRole(authUser);
        const mergeArticlesPerm = stockRoles.peutFusionnerArticles(callerRole);
        if (!mergeArticlesPerm.ok) {
          return res.status(403).json({ success: false, error: mergeArticlesPerm.raison });
        }
        if (!master_ref || !Array.isArray(doublon_refs) || doublon_refs.length === 0) {
          return res.status(400).json({ success: false, error: "master_ref et doublon_refs[] requis" });
        }
        const mergeMode = mode === "execute" ? "execute" : "preview";
        const doublonSet = new Set(doublon_refs);
        if (doublonSet.has(master_ref)) {
          return res.status(400).json({ success: false, error: "Le master ne peut pas être dans les doublons" });
        }

        // Validation existence + INTÉGRITÉ du master.
        // La garde ne testait que `active === false` : un document sans champ
        // `active` passait (`undefined !== false`). Il existe en production 5
        // documents FANTÔMES sans `nom` ni `active` (références espacées dont
        // le docId ne l'est pas) — fusionner vers l'un d'eux réécrit les
        // libellés de mouvements et de BDC avec une chaîne vide. Règle pure
        // partagée avec la validation des doublons ci-dessous.
        const masterSnap = await db_firestore.collection("articles_catalog").doc(master_ref).get();
        if (!masterSnap.exists) {
          return res.status(404).json({ success: false, error: "Article master introuvable: " + master_ref });
        }
        const masterData = masterSnap.data();
        const masterIntegrite = articleMerge.verifierIntegriteFiche(masterData, master_ref, "master");
        if (!masterIntegrite.ok) {
          return res.status(400).json({ success: false, error: masterIntegrite.erreur });
        }
        const masterNom = masterData.nom || "";
        const masterUnite = masterData.unite || "kg";

        // Validation existence des doublons + map ref->nom (pour matcher movements/bdc par nom OU ref)
        const doublonRefs = Array.from(doublonSet);
        const doublonDocs = await Promise.all(doublonRefs.map(r => db_firestore.collection("articles_catalog").doc(r).get()));
        const doublonNoms = {}; // ref -> nom
        for (let i = 0; i < doublonDocs.length; i++) {
          if (!doublonDocs[i].exists) {
            return res.status(404).json({ success: false, error: "Article doublon introuvable: " + doublonRefs[i] });
          }
          const doublonData = doublonDocs[i].data();
          // MÊME garde que le master : un doublon fantôme se ferait désactiver
          // à la place de la vraie fiche — « fusion effectuée » à l'écran, et
          // le doublon toujours là au rechargement (cas réel « ksc 7 perla »).
          const doublonIntegrite = articleMerge.verifierIntegriteFiche(doublonData, doublonRefs[i], "doublon");
          if (!doublonIntegrite.ok) {
            return res.status(400).json({ success: false, error: doublonIntegrite.erreur });
          }
          doublonNoms[doublonRefs[i]] = doublonData.nom || "";
        }
        // Ensembles de valeurs identifiant un doublon dans les docs opérationnels :
        // - stock_movements.items[].article_ref peut contenir la référence OU le nom (legacy)
        // - purchase_orders.items[].article contient le NOM
        // Normalisation IDENTIQUE à la détection (normalizeArticleName : NFD + diacritiques
        // + espaces réduits) pour que les accents/doubles-espaces matchent malgré legacy.
        const doublonKeysNorm = new Set();
        for (const r of doublonRefs) {
          doublonKeysNorm.add(articleMerge.normalizeArticleName(r));
          const nm = doublonNoms[r];
          if (nm) doublonKeysNorm.add(articleMerge.normalizeArticleName(nm));
        }
        doublonKeysNorm.delete("");
        const itemMatchesDoublon = (refOrName) => doublonKeysNorm.has(articleMerge.normalizeArticleName(refOrName));

        // ---------- Collecte des mouvements OUVERTS contenant un doublon ----------
        const movSnap = await db_firestore.collection("stock_movements").get();
        const openMovements = []; // { id, items, ... }
        for (const d of movSnap.docs) {
          const mov = d.data();
          if (!articleMerge.isMovementOpen(mov)) continue;
          const hit = (mov.items || []).some(it => itemMatchesDoublon(it.article_ref) || itemMatchesDoublon(it.article));
          if (hit) openMovements.push({ id: d.id, ref: d.ref, data: mov });
        }

        // ---------- Collecte des BDC OUVERTS contenant un doublon ----------
        const bdcSnap = await db_firestore.collection("purchase_orders").get();
        const openBdc = [];
        for (const d of bdcSnap.docs) {
          const bdc = d.data();
          if (!articleMerge.isBdcOpen(bdc)) continue;
          const hit = (bdc.items || []).some(it => itemMatchesDoublon(it.article) || itemMatchesDoublon(it.article_ref));
          if (hit) openBdc.push({ id: d.id, ref: d.ref, data: bdc });
        }

        // ---------- Agrégation des stock_balances DOUBLON -> MASTER ----------
        // On somme les soldes des doublons par (lieu_type, lieu_id) sur le master.
        const balSnap = await db_firestore.collection("stock_balances").get();
        const doublonBalances = []; // balances appartenant à un doublon
        for (const d of balSnap.docs) {
          const b = d.data();
          if (itemMatchesDoublon(b.article_ref)) {
            doublonBalances.push({ id: d.id, ref: d.ref, data: b });
          }
        }
        // Solde courant du master par lieu (pour l'affichage preview du solde résultant)
        const masterRefNorm = articleMerge.normalizeArticleName(master_ref);
        const masterBalByLieu = {}; // `${lieu_type}|${lieu_id}` -> { docId, balance }
        for (const d of balSnap.docs) {
          const b = d.data();
          if (articleMerge.normalizeArticleName(b.article_ref) === masterRefNorm) {
            masterBalByLieu[`${b.lieu_type}|${b.lieu_id}`] = { docId: d.id, balance: b.balance || 0 };
          }
        }
        // Calcul des soldes agrégés résultants sur le master
        const aggByLieu = {}; // key -> { lieu_type, lieu_id, unite, doublon_sum, master_current, resulting }
        for (const db of doublonBalances) {
          const b = db.data;
          const key = `${b.lieu_type}|${b.lieu_id}`;
          if (!aggByLieu[key]) {
            aggByLieu[key] = {
              lieu_type: b.lieu_type, lieu_id: b.lieu_id,
              unite: b.unite || masterUnite,
              doublon_sum: 0,
              master_current: masterBalByLieu[key] ? masterBalByLieu[key].balance : 0,
              resulting: 0,
            };
          }
          aggByLieu[key].doublon_sum = Math.round((aggByLieu[key].doublon_sum + (b.balance || 0)) * 100) / 100;
        }
        for (const key of Object.keys(aggByLieu)) {
          const a = aggByLieu[key];
          a.resulting = Math.round((a.master_current + a.doublon_sum) * 100) / 100;
        }
        const aggregatedBalances = Object.values(aggByLieu);

        // ---------- Counts des docs historiques laissés INTACTS ----------
        let historicalMovements = 0, validatedMovements = 0, closedBdc = 0;
        for (const d of movSnap.docs) {
          const mov = d.data();
          if (articleMerge.isMovementOpen(mov)) continue;
          const hit = (mov.items || []).some(it => itemMatchesDoublon(it.article_ref) || itemMatchesDoublon(it.article));
          if (hit) { historicalMovements++; if (mov.status === "valide_chef") validatedMovements++; }
        }
        for (const d of bdcSnap.docs) {
          const bdc = d.data();
          if (articleMerge.isBdcOpen(bdc)) continue;
          const hit = (bdc.items || []).some(it => itemMatchesDoublon(it.article) || itemMatchesDoublon(it.article_ref));
          if (hit) closedBdc++;
        }
        // delivery_notes + invoices : toujours laissés intacts (historiques/financiers)
        const blSnap = await db_firestore.collection("delivery_notes").get();
        let untouchedBl = 0;
        for (const d of blSnap.docs) {
          const bl = d.data();
          const hit = (bl.items || []).some(it => itemMatchesDoublon(it.article) || itemMatchesDoublon(it.article_ref));
          if (hit) untouchedBl++;
        }
        const invSnap = await db_firestore.collection("invoices").get();
        let untouchedInvoices = 0;
        for (const d of invSnap.docs) {
          const inv = d.data();
          const hit = (inv.items || []).some(it => itemMatchesDoublon(it.article) || itemMatchesDoublon(it.article_ref));
          if (hit) untouchedInvoices++;
        }

        const counts = {
          movements: openMovements.length,
          balances: doublonBalances.length,
          bdc: openBdc.length,
        };

        if (mergeMode === "preview") {
          return res.json({
            success: true,
            preview: {
              master: { reference: master_ref, nom: masterNom },
              doublons: doublonRefs.map(r => ({ reference: r, nom: doublonNoms[r] })),
              open_movements: openMovements.length,
              open_bdc: openBdc.length,
              aggregated_balances: aggregatedBalances,
              doublon_balances_count: doublonBalances.length,
              untouched: {
                historical_movements: historicalMovements,
                validated_movements: validatedMovements,
                closed_bdc: closedBdc,
                delivery_notes: untouchedBl,
                invoices: untouchedInvoices,
              },
            },
          });
        }

        // ---------- EXECUTE : fusion atomique (batchs de 400, marge 100) ----------
        const now = Date.now();
        const ops = []; // { type:'set'|'update'|'delete', ref, data, options }

        // 1) Réassigner les items des mouvements ouverts (ref + nom -> master)
        for (const m of openMovements) {
          const newItems = (m.data.items || []).map(it => {
            if (itemMatchesDoublon(it.article_ref) || itemMatchesDoublon(it.article)) {
              return { ...it, article_ref: master_ref, article_nom: masterNom };
            }
            return it;
          });
          ops.push({ type: "update", ref: m.ref, data: { items: newItems, updated_at: now } });
        }

        // 2) Réassigner les items des BDC ouverts (article = nom du master)
        for (const b of openBdc) {
          const newItems = (b.data.items || []).map(it => {
            if (itemMatchesDoublon(it.article) || itemMatchesDoublon(it.article_ref)) {
              const ni = { ...it, article: masterNom };
              if (it.article_ref !== undefined) ni.article_ref = master_ref;
              return ni;
            }
            return it;
          });
          ops.push({ type: "update", ref: b.ref, data: { items: newItems, updated_at: now } });
        }

        // 3) Agréger les balances : INCRÉMENT RELATIF du master par lieu (anti-TOCTOU),
        //    puis neutraliser les doublons (delete). On écrit FieldValue.increment(doublon_sum)
        //    et NON une valeur absolue : une validation de mouvement concurrente qui modifie
        //    la balance master n'est plus écrasée. set(..., {merge:true}) crée le doc (incr depuis 0)
        //    ou l'incrémente s'il existe.
        for (const key of Object.keys(aggByLieu)) {
          const a = aggByLieu[key];
          const balanceId = `${a.lieu_type}_${a.lieu_id}_${master_ref}`.replace(/\s+/g, "_");
          const masterBalRef = db_firestore.collection("stock_balances").doc(balanceId);
          ops.push({
            type: "set",
            ref: masterBalRef,
            data: {
              lieu_type: a.lieu_type, lieu_id: a.lieu_id,
              article_ref: master_ref, article_nom: masterNom,
              unite: a.unite || masterUnite,
              balance: admin.firestore.FieldValue.increment(a.doublon_sum),
              updated_at: admin.firestore.FieldValue.serverTimestamp(),
            },
            options: { merge: true },
          });
        }
        // Supprimer les balances du doublon APRÈS calcul de doublon_sum (déjà agrégées)
        for (const db of doublonBalances) {
          ops.push({ type: "delete", ref: db.ref });
        }

        // 4) Désactiver les doublons + tracer merged_into
        for (const r of doublonRefs) {
          ops.push({
            type: "update",
            ref: db_firestore.collection("articles_catalog").doc(r),
            data: { active: false, merged_into: master_ref, updated_at: now },
          });
        }

        // 5) Doc d'audit — snapshot pour rollback manuel.
        //    On capture les balances doublon AVANT suppression + les ids réassignés.
        //    Plafond 1000 entrées par liste (flag truncated) pour borner la taille du doc.
        const SNAP_CAP = 1000;
        const capList = (arr) => ({
          list: arr.slice(0, SNAP_CAP),
          truncated: arr.length > SNAP_CAP,
        });
        const doublonBalancesSnapshotFull = doublonBalances.map((db) => ({
          docId: db.id,
          lieu_type: db.data.lieu_type || "",
          lieu_id: db.data.lieu_id || "",
          article_ref: db.data.article_ref || "",
          balance: db.data.balance || 0,
          unite: db.data.unite || "",
        }));
        const reassignedMovementIdsFull = openMovements.map((m) => m.id);
        const reassignedBdcIdsFull = openBdc.map((b) => b.id);
        const snapBalances = capList(doublonBalancesSnapshotFull);
        const snapMovIds = capList(reassignedMovementIdsFull);
        const snapBdcIds = capList(reassignedBdcIdsFull);

        const auditRef = db_firestore.collection("article_merges").doc();
        ops.push({
          type: "set",
          ref: auditRef,
          data: {
            master_ref, master_nom: masterNom,
            doublon_refs: doublonRefs,
            by: {
              uid: authUser.uid || "", profileId: callerRole || "",
              name: (by && by.name) || "", email: authUser.email || "",
            },
            at: admin.firestore.FieldValue.serverTimestamp(),
            counts,
            mode: "execute",
            doublon_balances_snapshot: snapBalances.list,
            doublon_balances_snapshot_truncated: snapBalances.truncated,
            reassigned_movement_ids: snapMovIds.list,
            reassigned_movement_ids_truncated: snapMovIds.truncated,
            reassigned_bdc_ids: snapBdcIds.list,
            reassigned_bdc_ids_truncated: snapBdcIds.truncated,
          },
          options: {},
        });

        // Commit par batchs de 400
        for (let i = 0; i < ops.length; i += 400) {
          const batch = db_firestore.batch();
          for (const op of ops.slice(i, i + 400)) {
            if (op.type === "set") batch.set(op.ref, op.data, op.options || {});
            else if (op.type === "update") batch.update(op.ref, op.data);
            else if (op.type === "delete") batch.delete(op.ref);
          }
          await batch.commit();
        }

        // Une fusion pose `merged_into` et désactive des fiches : l'index
        // d'identité change, la résolution doit le voir tout de suite (sans
        // quoi une saisie continuerait 5 min à viser la fiche absorbée).
        invalidateIdentiteArticleIndex();
        return res.json({ success: true, counts, audit_id: auditRef.id });
      }


      // ========== CODES ANALYTIQUES ==========

      if (action === "list-codes-analytiques") {
        const snap = await db_firestore.collection("config_analytique").where("actif", "==", true).orderBy("code").get();
        return res.json({ success: true, codes: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
      }


      if (action === "save-code-analytique" && req.method === "POST") {
        const { id, code, libelle, ferme, categorie_achat, nature_cpc, saved_by } = req.body;
        if (!code || !libelle) return res.status(400).json({ success: false, error: "Code et libellé requis" });
        const data = { code, libelle, ferme: ferme || "Toutes", categorie_achat: categorie_achat || "autre",
          nature_cpc: nature_cpc || "621", actif: true, updated_at: Date.now(), updated_by: saved_by || {} };
        if (id) {
          await db_firestore.collection("config_analytique").doc(id).update(data);
          return res.json({ success: true, id });
        } else {
          const ref = await db_firestore.collection("config_analytique").add({ ...data, created_at: Date.now() });
          return res.json({ success: true, id: ref.id });
        }
      }


      if (action === "delete-code-analytique" && req.method === "POST") {
        const { id } = req.body;
        if (!id) return res.status(400).json({ success: false, error: "ID requis" });
        await db_firestore.collection("config_analytique").doc(id).update({ actif: false });
        return res.json({ success: true });
      }


      // ========== CONSULTATIONS (Appels d'offres) ==========

      if (action === "list-consultations") {
        const { ferme, status } = req.query;
        let q = db_firestore.collection("consultations");
        if (ferme) q = q.where("ferme", "==", ferme);
        if (status) q = q.where("status", "==", status);
        const snap = await q.orderBy("created_at", "desc").get();
        return res.json({ success: true, consultations: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
      }


      if (action === "create-consultation" && req.method === "POST") {
        const { ferme, objet, date_limite_reponse, items_demandes, created_by } = req.body;
        if (!ferme || !objet) return res.status(400).json({ success: false, error: "Ferme et objet requis" });
        const numero = await getNextNumber("consultation", "CON");
        const now = Date.now();
        const ref = await db_firestore.collection("consultations").add({
          numero, status: "en_cours", ferme, objet,
          date_limite_reponse: date_limite_reponse || "",
          items_demandes: items_demandes || [],
          offres: [],
          offre_retenue_index: null,
          bdc_id: null,
          created_by: created_by || {},
          created_at: now, updated_at: now,
        });
        return res.json({ success: true, id: ref.id, numero });
      }


      if (action === "add-offre" && req.method === "POST") {
        const { consultation_id, offre, updated_by } = req.body;
        if (!consultation_id || !offre) return res.status(400).json({ success: false, error: "consultation_id et offre requis" });
        const docRef = db_firestore.collection("consultations").doc(consultation_id);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Consultation introuvable" });
        const data = snap.data();
        const offres = data.offres || [];
        // Upsert: remplacer si même fournisseur_id, sinon ajouter
        const idx = offres.findIndex(o => o.fournisseur_id === offre.fournisseur_id);
        const newOffre = {
          fournisseur_id: offre.fournisseur_id || "",
          fournisseur_nom: offre.fournisseur_nom || "",
          date_reception: offre.date_reception || "",
          delai_livraison: offre.delai_livraison || 0,
          conditions_paiement: offre.conditions_paiement || "",
          items: offre.items || [],
          total_ht: offre.total_ht || 0,
          justificatif_url: offre.justificatif_url || null,
          retenu: false,
        };
        if (idx >= 0) offres[idx] = newOffre; else offres.push(newOffre);
        await docRef.update({ offres, updated_at: Date.now(), updated_by: updated_by || {} });
        return res.json({ success: true, offre_index: idx >= 0 ? idx : offres.length - 1 });
      }


      if (action === "retenir-offre" && req.method === "POST") {
        const { consultation_id, offre_index, retained_by } = req.body;
        if (consultation_id === undefined || offre_index === undefined) {
          return res.status(400).json({ success: false, error: "consultation_id et offre_index requis" });
        }
        const docRef = db_firestore.collection("consultations").doc(consultation_id);
        const snap = await docRef.get();
        if (!snap.exists) return res.status(404).json({ success: false, error: "Consultation introuvable" });
        const data = snap.data();
        const offres = (data.offres || []).map((o, i) => ({ ...o, retenu: i === offre_index }));
        await docRef.update({
          offres,
          offre_retenue_index: offre_index,
          status: "cloturee",
          retained_by: retained_by || {},
          retained_at: Date.now(),
          updated_at: Date.now(),
        });
        return res.json({ success: true });
      }


      if (action === "link-bdc-consultation" && req.method === "POST") {
        const { consultation_id, bdc_id } = req.body;
        if (!consultation_id || !bdc_id) return res.status(400).json({ success: false, error: "consultation_id et bdc_id requis" });
        await db_firestore.collection("consultations").doc(consultation_id).update({ bdc_id, updated_at: Date.now() });
        return res.json({ success: true });
      }


      // ========== DEMANDES DE VIREMENT ==========

      if (action === "list-demandes-virement") {
        const { status } = req.query;
        let q = db_firestore.collection("demandes_virement");
        if (status) q = q.where("status", "==", status);
        const snap = await q.orderBy("created_at", "desc").get();
        return res.json({ success: true, demandes: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
      }


      if (action === "create-demande-virement" && req.method === "POST") {
        const { facture_id, bdc_id, fournisseur, montant_ttc, motif, created_by } = req.body;
        if (!facture_id || !montant_ttc) return res.status(400).json({ success: false, error: "facture_id et montant_ttc requis" });
        const numero = await getNextNumber("virement", "VIR");
        const now = Date.now();
        const ref = await db_firestore.collection("demandes_virement").add({
          numero, facture_id, bdc_id: bdc_id || null,
          fournisseur: fournisseur || { nom: "", ice: "", rib: "" },
          montant_ttc: Number(montant_ttc),
          motif: motif || "",
          status: "en_attente",
          created_by: created_by || {},
          approved_by: null, executed_by: null,
          created_at: now, updated_at: now,
        });
        return res.json({ success: true, id: ref.id, numero });
      }


      if (action === "validate-virement" && req.method === "POST") {
        const { id, decision, rib, date_execution, comment, validated_by } = req.body;
        if (!id || !decision) return res.status(400).json({ success: false, error: "id et decision requis" });
        if (!["approuve", "execute", "rejete"].includes(decision)) {
          return res.status(400).json({ success: false, error: "Decision invalide" });
        }
        const updates = { status: decision, updated_at: Date.now(), validated_by: validated_by || {} };
        if (decision === "approuve") {
          updates.approved_by = validated_by || {};
          updates.approved_at = Date.now();
          if (rib) updates["fournisseur.rib"] = rib;
        } else if (decision === "execute") {
          updates.executed_by = validated_by || {};
          updates.executed_at = date_execution ? new Date(date_execution).getTime() : Date.now();
          if (rib) updates["fournisseur.rib"] = rib;
        } else if (decision === "rejete") {
          updates.rejected_by = validated_by || {};
          updates.rejected_at = Date.now();
          updates.reject_comment = comment || "";
        }
        await db_firestore.collection("demandes_virement").doc(id).update(updates);
        return res.json({ success: true });
      }


      // ========== TRACKING COMMANDES PAR FERME ==========

      if (action === "track-orders") {
        const { ferme } = req.query;
        const now = Date.now();

        // 3 requêtes en parallèle
        const bdcQuery = ferme
          ? db_firestore.collection("purchase_orders").where("ferme", "==", ferme).orderBy("created_at", "desc").limit(100)
          : db_firestore.collection("purchase_orders").orderBy("created_at", "desc").limit(100);

        const [bdcSnap, blSnap, invSnap] = await Promise.all([
          bdcQuery.get(),
          db_firestore.collection("delivery_notes").orderBy("created_at", "desc").limit(500).get(),
          db_firestore.collection("invoices").orderBy("created_at", "desc").limit(500).get(),
        ]);

        // Index BL et factures par bdc_id
        const blsByBdc = {};
        blSnap.docs.forEach(d => {
          const bl = d.data();
          if (bl.bdc_id && !blsByBdc[bl.bdc_id]) blsByBdc[bl.bdc_id] = { id: d.id, ...bl };
        });
        const invsByBdc = {};
        invSnap.docs.forEach(d => {
          const inv = d.data();
          if (inv.bdc_id && !invsByBdc[inv.bdc_id]) invsByBdc[inv.bdc_id] = { id: d.id, ...inv };
        });

        const STEPS = [
          { key: "cree",    label: "BDC Créé",   icon: "📋" },
          { key: "chef",    label: "Chef Ferme",  icon: "✅" },
          { key: "dg",      label: "DG Approuvé", icon: "🔏" },
          { key: "envoye",  label: "Envoyé",      icon: "📤" },
          { key: "livre",   label: "BL Reçu",     icon: "📦" },
          { key: "facture", label: "Facturé",     icon: "🧾" },
          { key: "paye",    label: "Payé",        icon: "💳" },
        ];

        // SLA par étape (en ms) pour détecter les retards
        const SLA = { cree: 2, chef: 3, dg: 3, envoye: 7, livre: 14, facture: 7, paye: 30 };

        const orders = bdcSnap.docs.map(doc => {
          const bdc = { id: doc.id, ...doc.data() };
          const history = bdc.history || [];
          const bl  = blsByBdc[bdc.id];
          const inv = invsByBdc[bdc.id];

          const getHistAt = (actionName) => {
            const e = history.find(h => h.action === actionName);
            return e ? e.at : null;
          };

          const paidAt = inv && inv.payment_status === "payee"
            ? (inv.paid_at || (inv.history || []).find(h => h.action === "paiement")?.at || null)
            : null;

          const stepTimes = {
            cree:    bdc.created_at,
            chef:    getHistAt("validation_chef"),
            dg:      getHistAt("validation_dg"),
            envoye:  getHistAt("envoi_fournisseur"),
            livre:   bl  ? bl.created_at  : null,
            facture: inv ? inv.created_at : null,
            paye:    paidAt,
          };

          // Si BDC rejeté, marquer la dernière étape atteinte comme bloquée
          const isRejected = ["rejete"].includes(bdc.status);

          let lastDoneIdx = -1;
          const steps = STEPS.map((s, i) => {
            const at = stepTimes[s.key];
            const done = at !== null;
            if (done) lastDoneIdx = i;
            return { ...s, at, done };
          });

          const isComplete = lastDoneIdx === STEPS.length - 1;
          const currentStepIdx = isComplete ? STEPS.length - 1 : Math.min(lastDoneIdx + 1, STEPS.length - 1);

          steps.forEach((s, i) => {
            s.isCurrent = !isComplete && i === currentStepIdx;
            s.isBlocked  = isRejected && i === currentStepIdx;
          });

          // Durées entre étapes
          const durations = [];
          for (let i = 1; i < STEPS.length; i++) {
            const prev = steps[i - 1];
            const curr = steps[i];
            if (prev.at && curr.at) {
              durations.push({ from: prev.key, to: curr.key, ms: curr.at - prev.at, pending: false });
            } else if (prev.at && !curr.at && curr.isCurrent) {
              durations.push({ from: prev.key, to: curr.key, ms: now - prev.at, pending: true });
            } else {
              durations.push({ from: prev.key, to: curr.key, ms: null, pending: false });
            }
          }

          // Retard : étape courante dépasse son SLA
          const slaDays = SLA[STEPS[currentStepIdx]?.key] || 7;
          const lastDoneAt = lastDoneIdx >= 0 ? steps[lastDoneIdx].at : bdc.created_at;
          const isLate = !isComplete && !isRejected && lastDoneAt && (now - lastDoneAt) > slaDays * 86400000;

          return {
            id: bdc.id, numero: bdc.numero, ferme: bdc.ferme,
            fournisseur: bdc.fournisseur, total_ttc: bdc.total_ttc,
            code_analytique: bdc.code_analytique, mode_paiement: bdc.mode_paiement,
            status: bdc.status, is_complete: isComplete, is_late: isLate, is_rejected: isRejected,
            current_step: STEPS[currentStepIdx]?.key,
            current_step_label: STEPS[currentStepIdx]?.label,
            steps, durations,
            created_at: bdc.created_at,
            bl_numero: bl?.numero_bl_fournisseur || null,
            facture_numero: inv?.numero_facture || null,
          };
        });

        // KPIs globaux
        const enCours  = orders.filter(o => !o.is_complete && !o.is_rejected);
        const termines = orders.filter(o => o.is_complete);
        const enRetard = orders.filter(o => o.is_late);

        // Délai moyen total (de créé à payé) sur commandes terminées
        let delaiMoyenMs = null;
        const withFullDuration = termines.filter(o => o.steps[0].at && o.steps[STEPS.length - 1].at);
        if (withFullDuration.length) {
          const total = withFullDuration.reduce((sum, o) => sum + (o.steps[STEPS.length - 1].at - o.steps[0].at), 0);
          delaiMoyenMs = Math.round(total / withFullDuration.length);
        }

        // Délai moyen par étape
        const stepAvg = {};
        STEPS.slice(1).forEach((s, idx) => {
          const vals = orders.map(o => o.durations[idx]).filter(d => d && d.ms !== null && !d.pending);
          if (vals.length) stepAvg[s.key] = Math.round(vals.reduce((s, d) => s + d.ms, 0) / vals.length);
        });

        return res.json({ success: true, orders, kpis: {
          en_cours: enCours.length,
          termines: termines.length,
          en_retard: enRetard.length,
          delai_moyen_ms: delaiMoyenMs,
          step_avg_ms: stepAvg,
        }});
      }


      // ========== ANALYSES FOLIAIRES ==========

      if (action === "list-analyses-foliaires") {
        const { ferme, parcelle, statut, type_analyse, variete } = req.query;
        const now = Date.now();
        const PARCELLES_MAP = {
          F1: ["P1-Myrtille A","P2-Myrtille B","P3-Framboise","P4-Myrtille C","P5-Framboise B"],
          F2: [],
          F3: [],
          F4: [],
          F5: ["P1-Myrtille","P2-Framboise A","P3-Framboise B","P4-Myrtille D"],
          F6: [],
          BAHIA: [],
          Avocatier: ["P1-Hass","P2-Hass B","P3-Fuerte"],
        };
        // Variety → canonical ferme overrides. Used to correct historical mis-assignments
        // (e.g. CASCADE is a myrtille cultivar planted only on F5).
        const VARIETE_FERME_OVERRIDE = {
          CASCADE: "F5",
        };

        // We *must* fetch without a ferme filter when an override may apply, otherwise
        // docs stored under the wrong ferme stay hidden forever. Cheap: small collection.
        let q = db_firestore.collection("analyses_foliaires");
        if (parcelle) q = q.where("parcelle", "==", parcelle);
        if (statut) q = q.where("statut", "==", statut);
        if (type_analyse) q = q.where("type_analyse", "==", type_analyse);
        if (variete) q = q.where("variete", "==", variete);
        const snap = await q.get();
        const THREE_DAYS = 3 * 86400000;
        const THIRTY_DAYS = 30 * 86400000;

        // Persist ferme corrections as we see them, so subsequent queries are fast.
        const fixPromises = [];
        let analyses = snap.docs.map(d => {
          const a = { id: d.id, ...d.data() };
          if (!a.type_analyse) a.type_analyse = "foliaire";
          if (!a.source) a.source = "manual";
          a.is_result_late = a.statut === "prelevee" && a.date_prelevement && (now - a.date_prelevement) > THREE_DAYS;
          const canonical = VARIETE_FERME_OVERRIDE[(a.variete || "").toUpperCase()];
          if (canonical && a.ferme !== canonical) {
            console.log(`ferme override: ${d.id} variete=${a.variete} ${a.ferme}→${canonical}`);
            a.ferme = canonical;
            fixPromises.push(d.ref.update({ ferme: canonical, updated_at: Date.now() }).catch(e => console.error("override persist failed", d.id, e.message)));
          }
          return a;
        });
        if (fixPromises.length) await Promise.all(fixPromises);
        if (ferme) analyses = analyses.filter(a => a.ferme === ferme);
        analyses.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));

        // parcelles_overdue was per-parcelle and couldn't credit AGQ imports
        // (which have parcelle: null, classified by ferme+variete instead).
        // The V5 AI panel now surfaces gaps contextually. Field kept for API back-compat.
        const parcelles_overdue = [];

        const counts = {
          demandees: analyses.filter(a => a.statut === "demandee").length,
          commandees: analyses.filter(a => a.statut === "commandee").length,
          prelevees: analyses.filter(a => a.statut === "prelevee").length,
          completees: analyses.filter(a => a.statut === "completee").length,
          en_retard: analyses.filter(a => a.is_result_late).length,
        };
        return res.json({ success: true, analyses, parcelles_overdue, counts });
      }


      if (action === "get-variete-contexte") {
        const { ferme, variete } = req.query;
        if (!ferme || !variete) return res.status(400).json({ success: false, error: "ferme et variete requis" });
        const docId = `${ferme}_${(variete || "").toUpperCase().replace(/\s+/g, "_")}`;
        const doc = await db_firestore.collection("variete_contextes").doc(docId).get();
        return res.json({ success: true, contexte: doc.exists ? doc.data() : null });
      }


      if (action === "save-variete-contexte" && req.method === "POST") {
        const { ferme, variete, contexte_general, updated_by } = req.body;
        if (!ferme || !variete) return res.status(400).json({ success: false, error: "ferme et variete requis" });
        const docId = `${ferme}_${(variete || "").toUpperCase().replace(/\s+/g, "_")}`;
        await db_firestore.collection("variete_contextes").doc(docId).set({
          ferme, variete, contexte_general: contexte_general || "",
          updated_at: Date.now(), updated_by: updated_by || {},
        }, { merge: true });
        return res.json({ success: true });
      }


      if (action === "create-analyse-foliaire" && req.method === "POST") {
        const { ferme, parcelle, culture, type_analyse, variete, phenologie, note_demande, photo_base64, photo_filename, created_by } = req.body;
        if (!ferme) return res.status(400).json({ success: false, error: "ferme requis" });
        const numero = await getNextNumber("analyse_foliaire", "AF");
        const now = Date.now();
        const cultureInferred = culture || (parcelle && (parcelle.toLowerCase().includes("hass") || parcelle.toLowerCase().includes("fuerte")) ? "Avocatier" : parcelle && parcelle.toLowerCase().includes("framboise") ? "Framboise" : parcelle ? "Myrtille" : null);
        const data = {
          numero, ferme,
          parcelle: parcelle || null,
          culture: cultureInferred,
          type_analyse: type_analyse || "foliaire",
          variete: variete || null,
          phenologie: phenologie || null,
          source: "manual",
          statut: "demandee",
          date_demande: now,
          date_prelevement: null,
          date_resultat: null,
          bdc_id: null,
          photo_parcelle_url: null,
          scan_resultat_url: null,
          note_demande: note_demande || "",
          recommandations_ia: [],
          history: [{ action: "creation", by: created_by || {}, at: now, comment: "" }],
          created_by: created_by || {},
          created_at: now, updated_at: now,
        };
        const ref = await db_firestore.collection("analyses_foliaires").add(data);

        // Upload photo si fournie
        if (photo_base64) {
          try {
            const buffer = Buffer.from(photo_base64.replace(/^data:image\/\w+;base64,/, ""), "base64");
            const ext = (photo_filename || "photo.jpg").split(".").pop() || "jpg";
            const storagePath = `analyses_foliaires/${ref.id}/photo_parcelle.${ext}`;
            const file = bucket.file(storagePath);
            await file.save(buffer, { metadata: { contentType: `image/${ext}` } });
            const url = `https://storage.googleapis.com/${bucket.name}/${storagePath}`;
            await ref.update({ photo_parcelle_url: url });
            data.photo_parcelle_url = url;
          } catch (e) { console.error("Upload photo AF:", e.message); }
        }

        return res.json({ success: true, id: ref.id, numero });
      }

  return NOT_HANDLED;
};
