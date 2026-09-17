# Statut des intégrations — vérification end-to-end

> État au 2026-09-14. Vérifié par lecture directe de Firestore (accès en
> lecture seule accordé pour ce chantier, `roles/datastore.viewer`) contre le
> projet live `berrygood-farms-dashboard` — pas de supposition, des requêtes
> réelles sur `whatsapp_logs` (1 964 documents), `config/whatsapp`, et les 124
> collections racine du projet.

## WhatsApp — 🟢 CORRIGÉ le 2026-09-14, vérifié par envoi réel

Cause confirmée par un envoi de test réel contre l'API Meta (réponse brute
complète, pas une supposition) :
```
error_data.details: "Param text cannot have new-line/tab characters or more than 4 consecutive spaces"
```
`sendTemplateMessage`, `sendTemplateMessageWithDocument` et
`sendTemplateMessageWithImage` (`functions/src/modules/admin/whatsappService.js`) ne
nettoyaient les paramètres qu'avec `.trim()` — les sauts de ligne internes
(volontaires, pour la mise en forme du digest) passaient tels quels. Corrigé
en appliquant `toSingleLine()` (déjà utilisé par `general_alert`, jamais
généralisé) aux 3 fonctions d'envoi. Testé en conditions réelles après
correctif : `meteo_alerte_7j` et `production_digest_v2` livrent maintenant
(`waMessageId` réel retourné par Meta — 2 messages de test envoyés au
numéro déjà configuré, préfixés `[TEST FIX]`). Le correctif est centralisé
dans le transport donc couvre aussi `meteo_spray_digest`/`_img` et
`meteo_alerte_7j_img` sans changement supplémentaire.

Un test existant (`functions/lib/meteo/__tests__/whatsappImage.test.js`)
codifiait par erreur l'ancien comportement (« body inchangé », assertion sur
le texte multi-ligne intact) — corrigé pour asserter le texte aplati et
l'absence de `\n`/tab dans tout param envoyé.

**Reste à vérifier de votre côté** : la mise en forme visuelle du digest
change (plus de sauts de ligne dans le corps du message WhatsApp lui-même —
seul le texte statique du template garde ses retours à la ligne). Si le
digest quotidien devient difficile à lire en une seule ligne, la solution
propre serait de resoumettre ces templates à Meta avec plusieurs variables
({{1}}..{{n}}, une par ligne) plutôt qu'une seule variable multi-ligne — un
changement de contenu qui nécessite une nouvelle approbation Meta,
volontairement hors périmètre de ce correctif.

### Avant correctif (référence)

**Ce qui marche** : `config/whatsapp` existe, `enabled: true`, `access_token`
et `phone_number_id` renseignés. Les templates suivants livrent réellement
(vérifié sur les 300 derniers envois) :

| Template | Total | Delivered/Read | Failed |
|---|---|---|---|
| `general_alert` (alerte staleness SQL mirror) | 128 | 128 | 0 |
| `bdc_chef_approved_doc` | 16 | 16 | 0 |
| `bdc_validation_needed_doc` | 12 | 12 | 0 |
| `bdc_dg_approved` | 20 | 20 | 0 |
| `bdc_rejected`, `bdc_validation_needed_v2`, `bdc_reminder` | 5 | 5 | 0 |
| `campagne_rapport_hebdo` | 8 | 8 | 0 |

**Ce qui est cassé — 100% d'échec, confirmé sur tout l'historique, pas un
incident ponctuel :**

| Template | Total tenté | Succès JAMAIS obtenu depuis | Erreur Meta |
|---|---|---|---|
| `production_digest_v2` | **310** | 2026-05-17 (**4 mois**) | `(#132018) There's an issue with the parameters in your template` |
| `meteo_spray_digest` | 81 | 2026-08-19 | idem |
| `meteo_spray_digest_img` | 78 | 2026-08-20 | idem |
| `meteo_alerte_7j` | 45 | 2026-08-28 | idem |
| `meteo_alerte_7j_img` | 45 | 2026-08-28 | idem |

Le dernier échec de chacun date d'**aujourd'hui** (2026-09-14, run du matin) —
ce n'est pas résolu. **559 envois échoués au total**, sans qu'aucune erreur ne
remonte nulle part ailleurs que dans cette collection Firestore : le digest de
production quotidien et les alertes météo/traitements n'ont donc jamais
atteint leurs destinataires WhatsApp depuis leur mise en service.

**Diagnostic fait, cause non confirmable d'ici** : le code envoie exactement 2
paramètres (`bodyParams`) pour chacun de ces 5 templates
(`functions/src/modules/recolte/dailyProductionReport.js:221`, `functions/lib/meteo/meteoAlertes.js:663`,
`functions/lib/meteo/sprayDigest.js`), et les définitions dans
`functions/create-whatsapp-templates.js` déclarent bien 2 variables (`{{1}}`,
`{{2}}`) pour chacun — **pas d'écart visible côté code**. L'erreur Meta
`#132018` signifie que le template réellement enregistré côté Meta n'a pas
la même structure que ce que le code envoie. Le fichier documente lui-même
2 refus antérieurs (2026-08-18, règles « pas de variable en début/fin de
corps » et « trop de variables pour la longueur du texte ») avec des corps
corrigés — mais rien ici ne confirme que la version corrigée a bien été
**approuvée** par Meta avec exactement cette structure.

**Action nécessaire de votre côté** — je n'ai pas accès à Meta Business
Manager : ouvrir le gestionnaire de templates WhatsApp et, pour ces 5 noms
exacts, vérifier :
1. Le statut (Approuvé / En attente / Rejeté).
2. Le nombre et l'ordre exact des variables du corps approuvé — comparer à
   `functions/create-whatsapp-templates.js` (les définitions y sont commentées
   et à jour du dernier correctif connu).
3. Si rejeté ou structure différente : relancer la soumission via
   `node functions/create-whatsapp-templates.js` (nécessite `WA_TOKEN` en
   variable d'env — voir le fichier pour l'usage exact) après correction.

## SQL mirror

Voir `docs/INTEGRATION_SQL_MIRROR.md` — sync, staleness, alerting tous
vérifiés en direct (emulateur + `firebase functions:list` + Firestore).
L'alerte staleness elle-même utilise `general_alert`, confirmé ci-dessus
comme le template qui marche le mieux (128/128).

## Autres intégrations (Phase 4 du brief) — non vérifiées, accès manquant

Ce chantier a débloqué la lecture Firestore, ce qui a permis les
vérifications ci-dessus. Les intégrations suivantes nécessitent des accès
que je n'ai toujours pas :

- **Email (IMAP)** : credentials `IMAP_*` non fournis, pas de test possible
  d'ici.
- **Agents IA** (`dgAgent.js`, `dgBot.js`, `chefBdcBot.js`) : nécessitent
  `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` — présence en Secret Manager non
  vérifiable (bloqué par le garde-fou du bac à sable de cette session, pas
  par vos permissions).
- **Agronomie/météo** (Netafim, Farmroad, Meteoblue) : mêmes limites.
- **Endpoints d'import** (FUEL/OJRA/TELECOM) : idem.
- **Cloud Scheduler** : `gcloud` est maintenant installé dans cet
  environnement (utilisé pour le diagnostic ci-dessus) — `gcloud scheduler
  jobs list --project=berrygood-farms-dashboard` est faisable si vous
  voulez que je vérifie les 17 jobs planifiés trouvés dans le code contre ce
  qui est réellement enregistré.
