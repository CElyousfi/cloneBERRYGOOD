// @ts-check

function matchBonToReception(bon, receptions) {
  let ecart = bon.qty || 0;
  let matchedReceptions = [];
  for (const rec of receptions) {
    if ((rec.bonId && rec.bonId === bon.id) || (rec.articleId && bon.articleId && rec.articleId === bon.articleId)) {
      matchedReceptions.push(rec);
      ecart -= (rec.qty || 0);
    }
  }
  return { matched: matchedReceptions.length > 0, ecart, matchedReceptions };
}

function computeRapprochementSummary(bons, receptions) {
  let matched = 0, unmatched = 0, totalEcart = 0;
  for (const bon of bons) {
    const res = matchBonToReception(bon, receptions);
    if (res.matched) {
      matched++;
      totalEcart += res.ecart;
    } else {
      unmatched++;
      totalEcart += (bon.qty || 0);
    }
  }
  return { matched, unmatched, totalEcart };
}

module.exports = {
  matchBonToReception, computeRapprochementSummary
};
