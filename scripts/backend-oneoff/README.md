# Scripts backend one-off

Scripts d'exploitation ponctuels (backfill, nettoyage, diagnostic, import,
seed, templates WhatsApp), anciennement à la racine de `functions/`. Ils ne
font PAS partie du déploiement (Firebase ne publie que `functions/`) et ne sont
pas des Cloud Functions.

Ils dépendent des paquets de `functions/` (firebase-admin, imapflow, …) et de
`functions/.env` :

```
NODE_PATH=functions/node_modules node scripts/backend-oneoff/<script>.js
```

Chaque script est à lire avant de le lancer : la plupart écrivent dans
Firestore de production (règle CLAUDE.md : migration / suppression de données =
action gated, GO explicite d'Omar).
