/* Module: caisse | Déclaration(s): isModeVirement */


function isModeVirement(mode) { return mode === 'comptant_virement' || mode === 'virement_bancaire'; }

export { isModeVirement };
