/* Module: finance | Déclaration(s): tresoFmtDate */


function tresoFmtDate(d) {
            if (!d) return '';
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            return `${dd}/${mm}`;
        }

export { tresoFmtDate };
