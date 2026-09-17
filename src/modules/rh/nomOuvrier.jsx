/* Module: rh | Déclaration(s): nomOuvrier */


// ===== IDENTITÉ OUVRIER — nom affichable =====
        // BEE ONE stocke l'identité COMPLÈTE dans `Nom` (« BELAIDI ISMAIL ») et
        // répète le prénom dans `Prenom` (« ISMAIL »). Concaténer les deux donne
        // « ISMAIL BELAIDI ISMAIL ». Le défaut est resté invisible tant que le
        // registre n'avait aucun prénom ; la synchronisation BEE ONE du
        // 2026-08-21 l'a rendu visible partout d'un coup.
        //
        // Règle : si le nom porte DÉJÀ le prénom (comparaison sur les mots, sans
        // casse ni accents), on rend le nom seul. Sinon on préfixe — certains
        // ouvriers ont un prénom d'état civil absent du nom (TAITI AYOUB /
        // LARBI), et le perdre serait pire que le répéter.
        function nomOuvrier(prenom, nom, secours) {
            const _mots = (s) => String(s || '')
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
            const p = String(prenom || '').trim();
            const n = String(nom || '').trim();
            if (!p) return n || String(secours || '').trim();
            if (!n) return p;
            const motsNom = _mots(n);
            const dejaDedans = _mots(p).every(m => motsNom.indexOf(m) >= 0);
            return dejaDedans ? n : (p + ' ' + n);
        }

export { nomOuvrier };
