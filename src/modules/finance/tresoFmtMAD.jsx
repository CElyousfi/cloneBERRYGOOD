/* Module: finance | Déclaration(s): tresoFmtMAD */


function tresoFmtMAD(n) {
            return (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' MAD';
        }

export { tresoFmtMAD };
