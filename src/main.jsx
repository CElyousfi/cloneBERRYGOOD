// @ts-check
/**
 * src/main.jsx — Smart BERRY Vite entry point.
 *
 * This entry is compiled by Vite (npm run dev / npm run build:vite).
 * The legacy Babel build (public/app.js) continues to serve production until
 * MODULAR_FRONTEND feature flag is flipped ON.
 *
 * Feature flag controls:
 *   MODULAR_FRONTEND=false → Firebase Hosting serves public/app.js (legacy)
 *   MODULAR_FRONTEND=true  → Vite dist serves src/main.jsx (modular)
 *
 * @module main
 */
import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { isEnabled, getAllFlags } from './shared/featureFlags.js';

// Domain feature imports — uncomment as each domain extraction is validated
// import * as QualiteFeature from './features/qualite/index.jsx';
// import * as RhFeature from './features/rh/index.jsx';
// import * as FinanceFeature from './features/finance/index.jsx';

/**
 * Migration status banner — shows which domains are live in the modular build.
 * Replace with real domain routing once extractions are validated.
 */
function MigrationStatus() {
  const [showFlags, setShowFlags] = useState(false);
  const flags = getAllFlags();
  const domains = [
    { name: 'Finance lib', status: 'extracted', detail: 'invoiceWorkflow, caisseLogic, liquidationCalc, repository' },
    { name: 'Qualité lib', status: 'in-progress', detail: 'inspectionRules, expeditionCalc, ecartAnalysis, brixCalc' },
    { name: 'Achats lib', status: 'in-progress', detail: 'bdcStateValidation, fournisseurUtils, rapprochementCalc' },
    { name: 'RH lib', status: 'in-progress', detail: 'quinzaineUtils, pointageCalc, transportConfig' },
    { name: 'Finance → Postgres', status: 'schema-ready', detail: '001_schema.sql ready — apply via Supabase SQL editor' },
    { name: 'Qualité → Postgres', status: 'schema-ready', detail: '001_schema.sql ready — apply after Finance validated' },
    { name: 'Frontend modules', status: 'in-progress', detail: 'src/features/{qualite,rh,finance} extraction running' },
  ];
  const statusColor = { extracted: '#2D8B4E', 'in-progress': '#D4A847', 'schema-ready': '#4A90D9', pending: '#aaa' };
  return React.createElement('div', { style: { maxWidth: 900, margin: '0 auto', padding: 32, fontFamily: 'Inter, sans-serif' } },
    React.createElement('div', { style: { background: 'linear-gradient(135deg, #8B2252, #A93068)', borderRadius: 16, padding: 32, color: 'white', marginBottom: 32 } },
      React.createElement('h1', { style: { margin: 0, fontSize: 28, fontWeight: 700 } }, '🫐 Smart BERRY — Migration Build'),
      React.createElement('p', { style: { margin: '8px 0 0', opacity: 0.85 } }, 'Modular monolith migration in progress. Legacy app.js continues to serve production.'),
    ),
    React.createElement('h2', { style: { color: '#8B2252', fontSize: 18, marginBottom: 16 } }, 'Domain Extraction Status'),
    React.createElement('div', { style: { display: 'grid', gap: 12 } },
      ...domains.map(d => React.createElement('div', {
        key: d.name,
        style: { background: 'white', borderRadius: 10, padding: '14px 18px', boxShadow: '0 2px 8px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 16 }
      },
        React.createElement('span', { style: { width: 10, height: 10, borderRadius: '50%', background: statusColor[d.status] || '#aaa', flexShrink: 0 } }),
        React.createElement('div', null,
          React.createElement('strong', { style: { fontSize: 15 } }, d.name),
          React.createElement('span', { style: { marginLeft: 8, fontSize: 12, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 } }, d.status),
          React.createElement('p', { style: { margin: '2px 0 0', fontSize: 13, color: '#555' } }, d.detail)
        )
      ))
    ),
    React.createElement('div', { style: { marginTop: 24, background: 'white', borderRadius: 10, padding: 18, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' } },
      React.createElement('button', {
        onClick: () => setShowFlags(f => !f),
        style: { background: '#8B2252', color: 'white', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontSize: 13 }
      }, showFlags ? 'Hide Feature Flags' : 'Show Feature Flags'),
      showFlags && React.createElement('pre', { style: { marginTop: 12, fontSize: 12, color: '#444', overflowX: 'auto' } },
        JSON.stringify(flags, null, 2)
      )
    )
  );
}

const container = document.getElementById('root');
if (container) {
  const root = ReactDOM.createRoot(container);
  root.render(React.createElement(MigrationStatus));
}
