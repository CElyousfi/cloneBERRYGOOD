# Smart BERRY — Architecture v2 (Modular Monolith)
Migration in progress: Firestore monolith → Modular monolith + Supabase Postgres

## Directory Structure (Target State)

```
BERRYGOOD/
├── src/                          # NEW: Vite-compiled modular frontend
│   ├── main.jsx                  # Vite entry point
│   ├── features/                 # Domain feature modules
│   │   ├── rh/                   # Ressources Humaines
│   │   ├── finance/              # Finance & Trésorerie
│   │   ├── qualite/              # Qualité & Expéditions
│   │   ├── recolte/              # Récolte & Pointage
│   │   ├── achats/               # Achats & Stock
│   │   ├── campagne/             # Campagne & Budget
│   │   ├── agronomie/            # Agronomie & Irrigation
│   │   └── dg/                   # Direction Générale
│   └── shared/                   # Shared utilities
│       ├── supabase.js           # Browser Supabase client
│       ├── featureFlags.js       # Feature flag system
│       ├── config.js             # (planned) FARM_LIST, PROFILES, etc.
│       ├── charts.jsx            # (planned) Chart components
│       └── apiCache.js           # (planned) API cache
├── public/                       # LEGACY: Firebase Hosting static files
│   ├── app.jsx                   # Legacy monolith (68k lines, kept for rollback)
│   ├── app.js                    # Babel-compiled output
│   └── components/               # Legacy extracted components
├── functions/                    # Cloud Functions (Node.js)
│   ├── index.js                  # Router (being slimmed — 17k → target <1.5k lines)
│   ├── config/
│   │   └── supabase.js           # Server-side Supabase admin client
│   └── lib/                      # Pure business logic modules
│       ├── finance/              # Invoice workflow, caisse, liquidations
│       ├── qualite/              # Inspections, expeditions, ecarts, brix (in progress)
│       ├── achats/               # BDC workflow, fournisseurs (in progress)
│       ├── rh/                   # Pointage, quinzaine, transport (in progress)
│       ├── irrigation/           # ✅ Already modularized (template)
│       └── [35 other domains]/   # ✅ Already modularized
└── scripts/
    └── migrate-finance-to-postgres/   # Finance → Postgres migration scripts
        ├── 001_schema.sql             # ✅ Schema (apply via Supabase SQL editor)
        ├── 002_seed.js               # ✅ Firestore → Postgres migration
        ├── 003_validate.js           # ✅ Diff validator
        └── README.md                 # ✅ Operator runbook
```

## Feature Flags

| Flag | Default | Purpose |
|------|---------|---------|
| MODULAR_FRONTEND | false | Use Vite build (src/) instead of legacy app.js |
| FINANCE_DUAL_WRITE | false | Write Finance to Firestore + Postgres |
| FINANCE_READ_POSTGRES | false | Read Finance from Postgres |
| QUALITE_DUAL_WRITE | false | Write Qualité to Firestore + Postgres |
| QUALITE_READ_POSTGRES | false | Read Qualité from Postgres |

## Database Strategy

- **Firestore**: Source of truth during migration; all writes still go here
- **Supabase (Postgres)**: Target for Finance + Qualité domains
- **Strangler Pattern**: Dual-write → validate → cut-over, domain by domain
- **Rollback**: Flip feature flag — instant, no code deployment needed

## Rollback Procedure (3 levels)

1. **Instant** (<1min): Flip MODULAR_FRONTEND / FINANCE_READ_POSTGRES flag off
2. **Deploy rollback** (<5min): `git revert + firebase deploy`
3. **DB rollback** (<30min): Restore from Firestore (never deleted until 30-day confirmation)
