# Spec — Module Achats EXISTANT (cartographie de référence)

> **Statut : RÉFÉRENCE (exploration read-only 2026-06-16).** Mémoire durable de **ce qui existe déjà**
> dans le module Achats (frontend + backend + Firestore), pour **ne pas re-explorer** ni reconstruire
> ce qui est déjà là. Découverte : le module est **bien plus complet que prévu** — l'essentiel du
> pipeline factures/BDC/réception existe, mais **peu utilisé** (1 facture, 2 scans, 41 BDC) et **non
> connecté** à notre valorisation PMP. Aucune conception ici. GATED.

## 0. Topologie
- **Frontend** : `public/app.jsx` (monolithe). Conteneur Achats = routeur d'onglets (~ligne 62416,
  arbre Desktop/chef-bahia ; numéros décalés sur `main`). **15 sous-onglets** (§1).
- **Backend** : `functions/index.js` (~14 k lignes) + `functions/bdcValidationService.js`,
  `functions/bdcVirementService.js`, `functions/lib/bdc/workflow.js`. Toutes les actions sous
  `/api/stock?action=…` (+ `/api/email-analysis?action=…` pour l'onglet Rapprochement).
- **Écritures Firestore = serveur uniquement.** Le front lit/écrit via les actions API.
- ⚠️ **Divergence d'arbres** : exploré sur Desktop (working copy ≈ prod live, branche `feat/chef-bahia`).
  Structure identique sur `main` (worktree), lignes décalées. **Vérifier la présence/version sur `main`
  avant tout travail** (risque de divergence connu, cf. mémoire `chef_bahia_was_live_prod`).

## 1. Les 15 sous-onglets (ordre UI, composant @ ligne Desktop)
| # | Onglet (id) | Libellé | Composant | Ligne |
|---|---|---|---|---|
| 1 | `achats_dashboard` | Dashboard Achats | `AchatsDashboardTab` | 42465 |
| 2 | `achats_da` | Demandes Achat | `AchatsDATab` | 39448 |
| 3 | `achats_bdc` | Bons de Commande | `AchatsBDCTab` | 44511 |
| 4 | `achats_receptions_valoriser` | Réceptions à valoriser | `AchatsReceptionsValoriserTab` | 52110 |
| 5 | `achats_fournisseurs` | Fournisseurs | `AchatsFournisseursTab` | 43900 |
| 6 | `achats_catalogue` | Catalogue | `AchatsCatalogueTab` | 42901 |
| 7 | `achats_analyses_foliaires` | Analyses Foliaires | `AchatsAnalysesFoliairesTab` | 43541 |
| 8 | `achats_consultation` | Consultation | `AchatsConsultationTab` | 43252 |
| 9 | `achats_factures` | Factures Achats | `AchatsFacturesTab` | 47144 |
| 10 | `achats_paiements` | Paiements Achats | `AchatsPaiementsTab` | 47304 |
| 11 | `achats_scan_factures` | Scan Factures | `AchatsScanFacturesTab` | 47454 |
| 12 | `achats_scan_bl` | Scan BL | `AchatsScanBLTab` | 47764 |
| 13 | `achats_bon_apport` | Bon Apport Achats | `AchatsBonApportTab` | 48055 |
| 14 | `achats_rapprochement` | Rapprochement | `AchatsRapprochementTab` | 50056 |
| 15 | `achats_vente_plastique` | Vente Plastique | `AchatsVentePlastiqueTab` | 49805 |

## 2. Collections Firestore (comptes réels au 2026-06-16)
| Collection | Rôle | Compte | Détail |
|---|---|---|---|
| `purchase_orders` | **BDC natifs Smart Berry** | **41** | 26 valide_dg · 5 en_attente_dg · 4 virement_signe · 3 virement_lance · 2 rejete · 1 envoye |
| `invoices` | **Factures fournisseurs** | **1** | FAC-2026-0001 (n° four. 146075, BDC-2026-0015, 31 534,80 TTC, 0 écart, non_payee) |
| `invoice_scans` | Métadonnées scans facture (OCR) | 2 | — |
| `bl_scans` | Métadonnées scans BL (OCR) | 2 | — |
| `delivery_notes` | Bons de livraison (BL) | 8 | — |
| `purchase_requests` | Demandes d'achat (DA) | 31 | — |
| `stock_movements` (type `reception`) | Réceptions stock | — | **1** en `en_attente_achats` (à valoriser) |
| `consultations` | Appels d'offres fournisseurs | 0 | structure présente, non utilisée |
| `demandes_virement` | Demandes de virement | 0 | idem |
| `stock_config/counters` | **Compteur unifié** | — | voir §3 |

> ⚠️ Les **41 BDC `purchase_orders`** = le « purchase_orders à 15 % » vu côté couverture prix PMP.
> **Distincts des 219 `Bon_Commande` BEE ONE** (SQL) — **deux systèmes de BDC parallèles**
> (cf. `spec-workflow-achats.md`).

## 3. Compteur unifié de références
`getNextNumber(type, prefix)` (`index.js` ~ligne 4704) — transaction Firestore atomique sur
`stock_config/counters`, clé = `type`. Format `${prefix}-${année}-${NNNN}` (padStart 4).
| Type | Préfixe | Exemple |
|---|---|---|
| `purchase_order` | BDC | BDC-2026-0015 |
| `invoice` | FAC | FAC-2026-0001 |
| (BL) | BL | BL-2026-… |
| (réception) | BR | BR-2026-… |
| (DA) | DA | DA-2026-… |

## 4. Écran FACTURES (`AchatsFacturesTab` → `invoices`)
**Actions** : `list-factures` (filtre `payment_status`), `create-facture` (calcule les écarts vs BDC),
`validate-facture` (step `submit|achats|finance|dg|pay`).

**Workflow `payment_status`** (visa 3 niveaux) :
```
non_payee → en_validation → validee_achats → validee_finance → validee_dg → payee
            [submit]        [achats]         [finance]         [dg]          [pay]
```
Rejet à toute étape → retour `non_payee`. Rôles : Achats → Finance → DG, puis paiement.

**Colonne ÉCARTS (✓ vert)** : compare **FACTURE vs BDC** (PAS la réception), par article, sur
**quantité** et **prix_unitaire**. Calculé à `create-facture` (`index.js` ~5990-6010) :
`discrepancies[] = {article, type:'quantite'|'prix', bdc_value, facture_value, ecart}`,
flag `has_discrepancies`. ✓ vert ⇔ `has_discrepancies:false`.

**Lien facture↔BDC** : champs `bdc_id` (UUID) + `bdc_numero`. **Saisi manuellement** (dropdown BDC
`valide_dg`/`envoye`) → les lignes du BDC pré-remplissent la facture. Ou auto via le scan (§6, `matched_bdc`).

**Schéma doc `invoices`** (extrait) : `numero, numero_facture, bdc_id, bdc_numero, fournisseur{}, date_facture,
items[{article, quantite, unite, prix_unitaire, taux_tva, montant_ht/tva/ttc}], total_ht/tva/ttc,
discrepancies[], has_discrepancies, payment_status, ferme, scan_url, scan_id, history[], validated_by_*, paid_at`.

## 5. Écran BONS DE COMMANDE (`AchatsBDCTab` → `purchase_orders`)
**Actions** : `list-bdc, get-bdc, create-bdc, update-bdc, submit-bdc, validate-bdc, send-bdc,
update-bdc-virement, remind-bdc, delete-bdc, request-bdc-change, create-bl, upload-virement-avis`.

**Workflow `status`** (`functions/lib/bdc/workflow.js`, `bdcValidationService.js`, `bdcVirementService.js`) :
```
brouillon → en_attente_chef → valide_chef → en_attente_dg → valide_dg → envoye
         (bypass chef si ferme ∈ DIRECT_DG_FARMS → en_attente_dg direct)
   branche virement : valide_dg → virement_lance (Finance) → virement_signe (DG) → envoye
   rejete / annule possibles
```
`DIRECT_DG_FARMS = ['Avocatier','F2','F3','F4','F6','BAHIA','Toutes']` (pas de chef → DG direct,
`bypass_reason`). Réception BL possible si BDC `valide_dg`/`envoye`. Rappels WhatsApp (`remind-bdc`).

**Schéma doc `purchase_orders`** (extrait) : `numero, status, purchase_request_id, consultation_id,
supplier_id, fournisseur{}, ferme, date_livraison_prevue, code_analytique, mode_paiement,
items[{article, categorie, quantite, unite, prix_unitaire, taux_tva, montant_*}], total_*,
delivery_status, invoice_status, validated_by_chef/dg, pdf_url, avis_virement_url, history[],
virement_lance_*, virement_signe_*`.

**Lien DA → BDC** : `purchase_requests` (31 DA) ; un BDC peut être auto-créé depuis une DA approuvée.

## 6. Écran SCAN FACTURES (`AchatsScanFacturesTab` → `invoice_scans`)
**Upload manuel + OCR IA — PAS de captation email.** Action `scan-facture` (`index.js` ~7688) :
1. Upload base64 (PDF/jpg/png/webp ≤10 Mo) → Storage `scans/factures/{ts}_{nom}`.
2. Extraction : `pdf-parse` si texte natif (>50 chars) sinon image base64 → **Claude Vision (Sonnet, fallback Opus)**.
3. Analyse JSON : `{accepted, rejection_reason, fournisseur{}, numero_facture, date_facture, items[],
   total_*, confidence}` + contrôles (client « BERRY GOOD »/« BGF », ICE `002106859000069`/`001536944000082`,
   année courante).
4. **Rapprochement BDC auto** : match nom fournisseur + proximité montant TTC sur BDC `valide_dg`/`envoye`
   → `matched_bdc` (ecart_pct, confidence high<5 % / medium<15 % / low).
5. Stocke `invoice_scans` ; « Créer la facture » → `create-facture` avec `scan_url`+`scan_id`
   → met à jour le scan (`invoice_id`, `invoice_numero`). Onglet « history » = liste des scans.

⚠️ Le scan utilise **Claude Vision générique**, PAS notre parser déterministe `parseTimacInvoicePdf`
(134/134, code_article stable). `AchatsScanBLTab` (`bl_scans`) = même principe pour les BL.

## 7. Écran RÉCEPTIONS À VALORISER (`AchatsReceptionsValoriserTab` → `stock_movements`)
Liste les `reception` en `en_attente_achats`. **Achats saisit `prix_unitaire` par article**
(pré-rempli depuis le BDC si dispo) → `validate-movement` (role `achats`, `index.js` ~8706) →
`applyStockImpact()` impacte `stock_balances`. **Point d'entrée du prix d'acquisition natif.**

## 8. Écran RAPPROCHEMENT (`AchatsRapprochementTab`) — ⚠️ FAUX AMI
**Ne rapproche PAS commande/réception/facture.** Rapproche les **bons de vente internes** (`pfq_interne`)
avec les **expéditions Driscoll's** (`/api/email-analysis?action=expeditions`) = traçabilité **vente/
expédition fruit (PFQ/DQR)**, rangée par erreur dans Achats. Scoring variété/poids/ferme, 2-pass J/J+1,
outils maintenance (`reprocess-pfq`, `cleanup-duplicate-dqr`, `reprocess-dqr`).

> Le **vrai rapprochement achats** est **éclaté dans les actions**, pas dans cet onglet :
> facture↔BDC à `create-facture` (écarts qté/prix) ; BL↔BDC à `create-bl`
> (`quantite_commandee` vs `quantite_recue`, `ecart`).

## 9. Autres onglets (non détaillés — pointeurs)
Dashboard (KPIs/validations en attente), Demandes Achat (DA→BDC), Fournisseurs (CRUD + import
Excel/SQL BEE ONE), Catalogue (articles), Consultation (appels d'offres, 0 doc), Analyses Foliaires,
Paiements (pipeline virements), Scan BL, Bon Apport, Vente Plastique.

## 10. ⚠️ Les 3 MANQUES RÉELS (vs reconstruire un pipeline neuf)
Le pipeline factures/BDC/réception **existe déjà**. Ne pas le dupliquer. Manques effectifs :

1. **Brancher notre parser TIMAC déterministe** (`parseTimacInvoicePdf`, code_article stable, validé
   134/134) dans le scan, à la place / à côté de Claude Vision générique. Bénéfice : extraction fiable
   + clé de mapping stable (cf. `spec-mapping-articles-bdc.md`).
2. **Captation email auto** (la SEULE brique réellement absente) : IMAP/`fetchEmails` sur les factures
   TIMAC → alimente `invoice_scans`/`invoices` sans upload manuel (cf. `spec-pipeline-factures.md` §4).
3. **Connecter les deux mondes de prix** : aujourd'hui le flux natif valorise dans `stock_movements`
   (`prix_unitaire` à la réception), tandis que **notre PMP lit le grand livre (canevas)** — sources
   **cloisonnées**. Faire que la réception valorisée native alimente le **PMP daté campagne**
   (`spec-valorisation-pmp.md` §10), au prix facturé HT, en respectant l'anti-double-comptage (§9.3).

## 11. Liens
- Pipeline factures (captation, rapprochement BL/BCde, alimentation PMP) : `spec-pipeline-factures.md`.
- Mapping code TIMAC → article stock : `spec-mapping-articles-bdc.md`.
- PMP daté campagne (hiérarchie de sources, slot `facture` priorité max) : `spec-valorisation-pmp.md` §8-10.
- BDC BEE ONE (219, `Bon_Commande` SQL — système parallèle) : `spec-workflow-achats.md`.
- Réconciliation inventaire physique : `spec-reconciliation-inventaire-physique.md`.
