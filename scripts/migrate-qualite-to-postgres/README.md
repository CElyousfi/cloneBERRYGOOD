# Migration Qualité vers PostgreSQL

## Étapes de migration

1. **Initialiser le schéma :**
   Exécuter le script `001_schema.sql` dans la base de données PostgreSQL pour créer le schéma `qualite`, les tables, les triggers et les politiques RLS.

2. **Extraire les données Firestore :**
   Utiliser les scripts d'extraction pour télécharger les collections (`inspections`, `expeditions`, `ecarts`, etc.) au format JSON.

3. **Importer les données :**
   Utiliser un script Node.js ou un outil ETL pour insérer les données JSON dans les tables PostgreSQL en respectant les contraintes d'unicité sur `firestore_id`.

4. **Vérifier les données :**
   Contrôler que les index et les politiques RLS fonctionnent correctement.

## Notes sur RLS
- `qualite`, `dg`, et `admin` ont un accès total.
- `chef` peut lire uniquement les enregistrements liés à sa ferme.
- `achats` peut lire les bons d'apport.
