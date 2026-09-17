/* Module: rh | Déclaration(s): loadPointageDistinctDays */


// Lit sql_mirror_pointage entre minDate et maxDate (IDs YYYY-MM-DD)
        // → Map<matricule, { joursPointes:Set<dateISO>, nom }>
        async function loadPointageDistinctDays(db, minDate, maxDate) {
            const out = new Map();
            if (!minDate) return out;
            const max = maxDate || new Date().toISOString().slice(0, 10);
            const snap = await db.collection('sql_mirror_pointage')
                .where(firebase.firestore.FieldPath.documentId(), '>=', minDate)
                .where(firebase.firestore.FieldPath.documentId(), '<=', max)
                .get();
            snap.forEach(d => {
                const dateISO = d.id;
                const docData = d.data() || {};
                const rows = docData.rows || [];
                rows.forEach(r => {
                    const mat = String(r.Personnel_Matricule || '').trim();
                    if (!mat) return;
                    const nom = (r.Personnel_Nom || '').trim();
                    const entry = out.get(mat) || { joursPointes: new Set(), nom };
                    entry.joursPointes.add(dateISO);
                    if (!entry.nom && nom) entry.nom = nom;
                    out.set(mat, entry);
                });
            });
            return out;
        }

export { loadPointageDistinctDays };
