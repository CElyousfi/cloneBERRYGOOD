/* Module: finance | Déclaration(s): formatMAD */


function formatMAD(n) { return (n || 0).toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' DH'; }

export { formatMAD };
