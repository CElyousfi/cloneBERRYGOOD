# Spec — Mapping articles (stock ↔ fournisseurs) pour rapprochement BDC / factures

> **Statut : QUALIFICATION (2026-06-16, MAJ avec dictionnaire codes TIMAC).** Table de correspondance
> article stock ↔ articles fournisseurs, pour rapprocher réceptions / BDC / **factures**. Même pattern
> `a_mapper` que le **mapping parcelles de consommation** (déjà livré). La table se valide une fois avec
> le magasinier. NE PAS construire la collection maintenant — c'est la spec. GATED.

## 1. Le problème (rappel) et la solution
Le rapprochement Réceptions ↔ BDC ↔ Factures bute sur le **nom d'article** : chaque système nomme
différemment (typos `NITRETE`≠Nitrate, suffixes `MAP (GK)`≠MAP, romain `KSC 3`≠`KSC III`, court vs
commercial `EXTREME`≠`Fertiactyl Green Extreme`…). Le fuzzy de noms laisse trop d'ambiguïté.

**🎯 La facture TIMAC porte un `code_article` STABLE (0119, 0116…)** — clé bien plus fiable que le nom.
**On mappe le code UNE fois → vaut pour toutes les factures futures** (le code ne change jamais).

## 2. ⚠️ PÉRIMÈTRE — mapping HYBRIDE (distinction à retenir)
| Fournisseur | Clé de mapping | Fiabilité |
|---|---|---|
| **TIMAC** (le gros volume) | **`code_article` TIMAC** (0119…) — 48 codes extraits des 134 factures | **stable, validé 1 fois** |
| **HAROUACH, NALSYA, CAS, + ~21 autres** | **nom canonicalisé / fuzzy** (pas de code stable disponible) | à re-vérifier (moins fiable) |

→ Le code TIMAC couvre **uniquement** les articles TIMAC. Les autres fournisseurs restent sur le
matching de nom (normalisation étendue + fuzzy, cf. §5). Le mapping final est donc **hybride**.

## 3. Modèle de données (Firestore `mapping_articles`)
Un doc par **article fournisseur** (clé = code si dispo, sinon nom normalisé) :
```
{
  fournisseur: "TIMAC",
  code_fournisseur: "0119" | null,       // code stable (TIMAC) ; null pour les autres
  designation_fournisseur: "HUMOCAL",     // libellé sur la facture / le BDC
  article_stock: "HUMOCAL",               // article stock canonicalisé (cible)
  statut: "mappe" | "a_valider" | "a_mapper",
  source: "code_timac" | "nom_fuzzy" | "manuel",
  updated_at, updated_by
}
```
- **`code_timac`** : matching exact par `code_fournisseur` → 0 ambiguïté une fois validé.
- **`a_mapper`** : non résolu (article facturé absent du stock, ou cible inconnue) → écran magasinier.

## 4. Dictionnaire `code TIMAC → désignation → article stock` (48 codes, pré-rempli)
`désignation` = **fiable** (extraite des 134 factures). `article stock suggéré` = **proposition à
valider magasinier** (mon auto-match collapse les familles KSC*/RHIZO*/NITRATE* → `a_valider`).

| code | désignation TIMAC | article stock (suggéré) | statut |
|---|---|---|---|
| 0025 | SOLUPOTASSE x 25Kg | SOLUPOTASSE | mappe |
| 0035 | ECOVIGOR AA 10L | ECOVIGOR | mappe |
| 0039 | EUROFIT MAX 5L | EUROFIT MAX | mappe |
| 0057 | SEACTIV KALEO 469 | KALEO L | mappe |
| 0061 | SEACTIV VITAL 954 | VITAL | mappe |
| 0063 | SEACTIV ALPHA | ALPHA | mappe |
| 0081 | SEACTIV MAGICAL | MAGICAL | mappe |
| 0084 | SEACTIV OPAL Mn Zn | OPAL | mappe |
| 0103 | SEACTIV GOLD BMo | GOLD BMO | mappe |
| 0116 | BIOACTYL SUPERBE 8.10.22 50KG | BIOACTYL SUPERBE | mappe |
| 0119 | HUMOCAL | HUMOCAL | mappe |
| 0133 | RHIZO AMINE 20 KG | RHIZO AMINE | mappe |
| 0139 / 0140 | RHIZO HUMUS 20/25 KG | RHIZO HUMUS | mappe |
| 0167 | DEPTIL PA5 10 L | DEPTIL PA5 | mappe |
| 0239 | SEACTIV ORIS PZn | ORIS | mappe |
| 0340 | SULFATE DE MAGNESIE 16% X 25 KG | SULFATE DE MAGNESIE | mappe |
| 0344 | ACIDE PHOSPHORIQUE 32Kg | ACIDE PHOSPHORIQUE | mappe |
| 0352 | RHIZO Mn Zn Seau 10 KG | RHIZO MN ZN | mappe |
| 0454 | AMMONITRATE 33% x 50 Kg | AMMONITRATE | mappe |
| 0465 | Acide Nitrique 60% x 33 Kg | ACIDE NITRIQUE | mappe |
| 0020 | NITRATE DE CHAUX 25KG | NITRATE DE CALCIUM ? | a_valider |
| 0021 / 0427 | NITRATE DE POTASSE 25KG | NITRETE DE POTASSE ? | a_valider |
| 0044 | FERTIACTYL GREEN EXTREME 5 KG | EXTREME ? | a_valider |
| 0046 | FERTIACTYL GZ 10L | GZ ? | a_valider |
| 0085 | KSC MIX 10 KG | KSC MIX ? | a_valider |
| 0088 | KSC PHYTACTYL I 25KG | KSC 1 ? | a_valider |
| 0091 | KSC PHYTACTYL II 25KG | KSC 2 ? | a_valider |
| 0094 | KSC PHYTACTYL III 25KG | KSC 3 ? | a_valider |
| 0097 | KSC PHYTACTYL V 25KG | KSC (V) ? | a_valider |
| 0100 | KSC SULFACID 20L | SULFACIDE ? | a_valider |
| 0101 | KSC VII PERLA 25 KG | KSC 7 ? | a_valider |
| 0134 | RHIZO BORE 10 KG | RHIZO BOR ? | a_valider |
| 0137 | RHIZO CAL 25KG | RHIZO CAL ? | a_valider |
| 0265 | SULFATE D'AMMONIAQUE SACS 50KG | SULFATE D'AMMONIAQUE | a_valider |
| 0340… | (voir mappe) | | |
| 0399 / 0407 | MAP TECHNIQUE 25KG | MAP (GK) ? | a_valider |
| 0535 | ACIDE SULFURIQUE 35 Kg | ACIDE SULFRIQUE ? | a_valider |
| 0033 | CO-ACTYL H 10KG | ? (absent stock) | a_mapper |
| 0072 | SEACTIV ELITE 10L | ? | a_mapper |
| 0218 | EUROFERTIL 0-12-24 X50 KG | ? | a_mapper |
| 0260 | UREE 46 X 50KG | URÉE 46% ? | a_mapper |
| 0316 / 0422 | MAXIFRUIT 5L/10L | ? | a_mapper |
| 0327 | TIMASOL PHOSCAL 10-50-00 25KG | ? | a_mapper |
| 0353 | FERTIACTYL STARTER 10L | ? | a_mapper |
| 0482 | EXCELIS N 25 Kg | ? | a_mapper |

**Bilan auto (à valider) : ~20 `mappe` clairs, ~16 `a_valider` (familles/typos), ~10 `a_mapper`.**
La désignation est sûre ; seule la **cible stock** demande l'œil du magasinier — **une seule fois par
code**, ensuite définitif.

## 4bis. Statut `hors_campagne` (articles de campagne antérieure)
Certains codes TIMAC ne sont facturés **que sur des campagnes passées** (dernière facture < cutoff
campagne courante 2025-07-01) → normal qu'ils soient absents du stock 2025-2026.
**Règle : `dernière facture < cutoff campagne → statut hors_campagne`.** Le mapping code→stock est
**conservé** (pas supprimé), juste marqué **inactif cette campagne** ; **réactivable** automatiquement
si l'article est refacturé en 2026-2027.

8 codes `hors_campagne` (dernière facture avant 07/2025) : `0033 CO-ACTYL H` (20/06/2025) ·
`0072 SEACTIV ELITE` (27/05/2025) · `0218 EUROFERTIL` (10/2024) · `0316 MAXIFRUIT 5L` (02/2024) ·
`0422 MAXIFRUIT 10L` (03/2025) · `0327 TIMASOL PHOSCAL` (03/2025) · `0353 FERTIACTYL STARTER`
(02/2025) · `0482 EXCELIS N` (06/2024).

Cibles confirmées (facturées en campagne courante, présentes en stock sous nom court) :
`0046 FERTIACTYL GZ → GZ` · `0260 UREE 46 → URÉE 46%`.

## 4ter. ⚠️ RÈGLE ANTI-RENOMMAGE (CRITIQUE) — clé stock immuable, correction = ALIAS
Les noms d'articles stock sont les **CLÉS** des `stock_balances` / `stock_movements` / `articles_catalog`.
Certaines portent une **faute** (`NITRETE DE POTASSE`, `ACIDE SULFRIQUE`, `RHIZO BOR`). **NE JAMAIS les
renommer** : impact mesuré 2026-06-16 → renommer ces 3 clés toucherait **1 861 mouvements + 13 soldes +
3 docs catalogue**, cassant les liens.
**Règle : `article_stock` = la clé EXISTANTE (avec sa faute) ; le nom correct va dans un champ `alias`
(affichage uniquement).** Ex. mapping `0021 → article_stock:"NITRETE DE POTASSE", alias:"NITRATE DE
POTASSE"`. Pareil pour `ACIDE SULFRIQUE`/(SULFURIQUE) et `RHIZO BOR`/(BORE).

## 5. Pour les fournisseurs SANS code (nom/fuzzy)
Normalisation étendue (au-delà du strip d'unité) : retirer parenthèses, tailles/formulations
(`\d+ ?(KG|L|SC|WG)`), romain→arabe, typos (`NITRETE`→NITRATE, `SULFRIQUE`→SULFURIQUE, `BOR`→BORE) ;
puis fuzzy Jaccard tokens ≥ 0.5 scopé fournisseur → propose un mapping `a_mapper`.

## 6. Phases (GATED)
- **P0** : cette spec + dictionnaire codes.
- **P1** : seed `mapping_articles` (codes TIMAC `mappe` + `a_valider`/`a_mapper`) + écran validation
  magasinier (pattern mapping parcelles).
- **P2** : rapprochement fiable lisant le mapping (code TIMAC prioritaire, nom/fuzzy sinon) →
  🟢/🔴/🟠 propres + écarts qté/prix + alimentation PMP au prix facturé.

## 7. Liens
- Parser factures TIMAC (source des codes) : `functions/src/modules/finance/emailService.js` `parseTimacInvoiceText` +
  `scripts/validate-timac-parser.js` (134 factures réconciliées).
- Pipeline factures complet : `docs/spec-workflow-achats.md` (à compléter — étape 4).
- PMP au prix facturé (slot `facture` priorité max) : `docs/spec-valorisation-pmp.md` §8.
- Anti-double-comptage : `docs/spec-valorisation-pmp.md` §9.3.
