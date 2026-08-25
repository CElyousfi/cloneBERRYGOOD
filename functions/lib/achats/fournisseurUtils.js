// @ts-check

function normalizeFournisseurName(name) {
  if (!name) return '';
  return name.trim().toUpperCase().replace(/\s+/g, ' ');
}

function computeFournisseurBalance(factures, paiements) {
  const totalFactures = factures.reduce((sum, f) => sum + (f.montant || 0), 0);
  const totalPaiements = paiements.reduce((sum, p) => sum + (p.montant || 0), 0);
  return totalFactures - totalPaiements;
}

function detectDuplicateFournisseur(fournisseurs, name) {
  const normalized = normalizeFournisseurName(name);
  for (const f of fournisseurs) {
    if (normalizeFournisseurName(f.name) === normalized) {
      return f.id || f.name;
    }
  }
  return null;
}

module.exports = {
  normalizeFournisseurName, computeFournisseurBalance, detectDuplicateFournisseur
};
