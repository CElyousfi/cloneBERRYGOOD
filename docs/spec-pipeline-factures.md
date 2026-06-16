# Spec — Pipeline Factures fournisseurs (TIMAC → PMP)

> **Statut : EN COURS (2026-06-16). Étapes 1-3 livrées, 4-5 à faire.** Pipeline de captation +
> extraction + rapprochement des factures fournisseurs, pour alimenter la **valorisation du stock au
> prix facturé HT** (vérité comptable, priorité max de la hiérarchie PMP). GATED à chaque étape.

## 0. Objectif & priorité fournisseurs
Valoriser le stock au **coût d'acquisition réel** = **prix facturé HT**. Tous les fournisseurs ne
passent pas par le même canal :
| Fournisseur | Part | Canal de prix |
|---|---|---|
| **TIMAC** | **87,6 %** | **Pipeline factures auto** (ce doc) — PDF natif texte + code_article stable |
| HAROUACH (~5 %) + NALSYA (~3,7 %) | ~8,7 % | Saisie manuelle (pas de pipeline pour l'instant) |
| ~21 autres fournisseurs | ~3,7 % | Prix grand livre (FILL-ONLY déjà en prod) |

→ Le pipeline auto vise **TIMAC** (le gros volume). Le reste reste sur saisie/grand livre.

## 1. ✅ Étape 1 — Parser `parseTimacInvoicePdf` (LIVRÉ, dormant sur main)
- `functions/emailService.js` : `parseTimacInvoiceText(text)` (pur) + `parseTimacInvoicePdf(buffer)`
  (wrappe `pdf-parse`, PDF natif texte — **pas d'OCR**). Exportés. Ajout-only (exports CF intacts).
- Extrait : en-tête (code_client, num_facture, date, **num_bcde, num_bl**, dates, ice, net_a_payer,
  total_ht/tva) + lignes (**code_article**, designation, quantite, **unite** KG/LITRE/TONNE/U,
  remise, prix_unitaire, montant). Gère désignation multi-lignes, qté+unité collées, multi-BL.
- **Validation** : `scripts/validate-timac-parser.js` sur **134 factures réelles** → **134/134
  réconciliées Σlignes=ΣHT au centime**, en-têtes 100 %, 0 ligne perdue, 48 codes. +8 tests `node:test`.
- **Dormant** : aucun flux ne l'appelle encore (partira en prod avec l'étape 4).

## 2. ✅ Étape 2 — HUMOCAL élucidé (validation métier du parser)
Le « 🔴 HUMOCAL 30 000 sans BDC » était une **fausse anomalie** : facture **143048** (13/10/2025,
BL 128118-1) → **B.Cde 122746**, code **0119**, **30 Tonne @ 1 000 DH/t = 30 000 kg @ 1 DH/kg**.
Cohérent avec le canevas (30 000 kg, prix 1 = 1 DH/kg). **Achat réel commandé + facturé.** → prouve que
**les factures résolvent les « sans BDC »** (elles portent le code, l'unité, le prix, le lien B.Cde/BL).

## 3. ✅ Étape 3 — Mapping articles hybride (LIVRÉ en spec)
`docs/spec-mapping-articles-bdc.md` : **code_article TIMAC stable** (48 codes, mappé 1× → définitif)
pour TIMAC ; **nom canonicalisé/fuzzy** pour les autres fournisseurs. Dictionnaire 48 codes pré-rempli
(~20 mappe / 16 a_valider / 10 a_mapper). À valider avec le magasinier (collection `mapping_articles`).

## 4. ⏳ Étape 4 — Captation email auto (À FAIRE)
Réutiliser **l'archi Driscoll's** de `functions/emailService.js` (déjà : ImapFlow + mailparser +
pdf-parse, dispatch par expéditeur/objet, stockage Firestore + Storage) :
1. **`isTimacInvoice(from, subject)`** = `from ⊃ timacmaroc.com` ET `subject ⊃ /facture/i`.
2. Dans **`exports.fetchEmails`** (`emailService.js:963`) : ajouter le cas TIMAC → extraire la pièce
   jointe **PDF**, upload Storage (`scans/factures/`), stocker un doc `emails` flaggé `isTimacInvoice`
   + métadonnées. (Compte IMAP : `qualiteberrygoodfarms@gmail.com`, identifiants env `IMAP_*`.)
3. Dans **`exports.analyzeEmail` / `emailAnalysis`** : si `isTimacInvoice` → `parseTimacInvoicePdf`
   → écrire la facture structurée dans **`invoices`** (ou `timac_invoices`).
4. **Idempotence** : clé = `num_facture` (dédupliquer). Marquer l'email lu (déjà géré).
- Modèle doc facture Firestore : `{ num_facture, date_facture, fournisseur:'TIMAC', code_client,
  num_bcde, date_bcde, bls:[...], num_bl, date_bl, total_ht, total_tva, net_a_payer, scan_url,
  lignes:[{code_article, designation, quantite, unite, prix_unitaire, montant}], created_at, source:'email_timac' }`.
- GATED : preview/test sur les 134 (rejouer) avant prod ; deploy `functions:fetchEmails,analyzeEmail`.

## 5. ⏳ Étape 5 — Rapprochement + alimentation PMP (À FAIRE)
Une fois les factures en base :
1. **Rapprochement par `num_bl`** → réception (canevas / `stock_movements` type reception) : confirme
   la réception, récupère le **prix facturé**. Clé : `num_bl` (ex. 128118-1) présent sur facture ET
   sur le bon d'entrée.
2. **Rapprochement par `num_bcde`** → commande (BEE ONE `Bon_Commande.Num_BC` / Smart Berry
   `purchase_orders`) : relie facture ↔ BDC, **résout les « 🔴 sans BDC »**.
3. **Alimentation PMP** : pour chaque ligne facture, via le **mapping** (code_article → article stock),
   poser le **prix facturé HT** comme source `facture` (**priorité max** de la hiérarchie, cf.
   `spec-valorisation-pmp.md` §8). L'**unité de la facture** (Tonne/KG/L) résout définitivement le bug
   DH/tonne — plus d'heuristique.
4. **Anti-double-comptage** (CRITIQUE, cf. `spec-valorisation-pmp.md` §9.3) : la facture fournit
   **UNIQUEMENT le prix** sur une acquisition déjà connue (réception du grand livre, matchée par BL +
   code/mapping) — **JAMAIS une quantité ajoutée**.
- Aperçu before/after de la valorisation (catalogue/FILL-ONLY → prix facturé) avant écriture. GATED.

## 6. Schéma global
```
Email TIMAC (gmail) ──fetchEmails──> emails + PDF Storage
        │ isTimacInvoice
        └──analyzeEmail──> parseTimacInvoicePdf ──> invoices {num_facture, bls, bcde, lignes[code_article,...]}
                                                          │
                         mapping_articles (code→stock) ───┤
                                                          ├─ rapprochement BL  → réception (grand livre)
                                                          ├─ rapprochement BCde→ commande (Bon_Commande / purchase_orders)
                                                          └─ PMP prix facturé HT (priorité max) → valorisation stock
```

## 7. Liens
- Parser + validation : `functions/emailService.js`, `scripts/validate-timac-parser.js`,
  `tests/unit/timacInvoiceParser.test.js`.
- Mapping : `docs/spec-mapping-articles-bdc.md`.
- Valorisation / hiérarchie / anti-double-comptage : `docs/spec-valorisation-pmp.md` §8-9.
- Paysage BDC BEE ONE (Bon_Commande, purchase_orders) : `docs/spec-workflow-achats.md`.
- Archi captation email (référence) : `functions/emailService.js` `exports.fetchEmails` / `analyzeEmail`.
