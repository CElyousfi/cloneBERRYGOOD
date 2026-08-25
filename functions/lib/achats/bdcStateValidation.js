// @ts-check

function validateBdcTransition(currentStatus, nextStatus, userRole) {
  const allowed = {
    'brouillon': ['en_attente_validation'],
    'en_attente_validation': ['valide_chef', 'rejete'],
    'valide_chef': ['valide_dg', 'rejete'],
    'valide_dg': ['envoye_fournisseur', 'annule'],
    'envoye_fournisseur': ['recu_partiel', 'recu_total', 'annule'],
    'recu_partiel': ['recu_total']
  };
  if (!allowed[currentStatus] || !allowed[currentStatus].includes(nextStatus)) {
    return { ok: false, error: 'Transition non permise' };
  }
  if (nextStatus === 'valide_chef' && userRole !== 'chef') return { ok: false, error: 'Droits insuffisants' };
  if (nextStatus === 'valide_dg' && userRole !== 'dg') return { ok: false, error: 'Droits insuffisants' };
  return { ok: true };
}

function canChefValidate(bdc, userProfile) {
  return userProfile.role === 'chef' && bdc.status === 'en_attente_validation';
}

function canDgValidate(bdc, userProfile) {
  return userProfile.role === 'dg' && bdc.status === 'valide_chef';
}

function computeBdcTotal(lines) {
  let total = 0;
  for (const line of lines) {
    total += (line.qty || 0) * (line.prixUnitaire || 0);
  }
  return total;
}

function isBdcExpired(bdc, maxAgeDays) {
  if (!bdc.dateCreation) return false;
  const age = Date.now() - new Date(bdc.dateCreation).getTime();
  return age > (maxAgeDays * 24 * 60 * 60 * 1000);
}

module.exports = {
  validateBdcTransition, canChefValidate, canDgValidate, computeBdcTotal, isBdcExpired
};
