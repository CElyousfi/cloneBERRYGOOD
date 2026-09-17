/* Module: magasin | Déclaration(s): canonArt */

// Canonicalisation d'un libellé d'article — COPIE FRONT de
// functions/lib/stock/articleKey.js `canon` (le monolithe ne peut rien
// require ; la parité est verrouillée par tests/unit/articleKey.test.js).
// MAJUSCULE + espaces réduits + suffixe d'unité final retiré : c'est la clé
// qui résout les mouvements, les soldes et le PMP côté backend. Un seul
// exemplaire côté front — toute copie locale rouvre la divergence que
// articleKey.js a fermée.
const canonArt = (a) => {
            let s = (a == null ? '' : String(a)).toUpperCase().trim();
            s = s.replace(/\s+/g, ' ');
            s = s.replace(/\s*\((L|KG|G|ML|UNITE|U)\)\s*$/, '');
            return s.trim();
        };

export { canonArt };
