function parseQuinzaine(quinzaineStr) {
  const [year, month, half] = quinzaineStr.split('-');
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  const h = parseInt(half, 10);
  
  let dateFrom, dateTo;
  if (h === 1) {
    dateFrom = `${year}-${month.padStart(2, '0')}-01`;
    dateTo = `${year}-${month.padStart(2, '0')}-15`;
  } else {
    dateFrom = `${year}-${month.padStart(2, '0')}-16`;
    const lastDay = new Date(y, m, 0).getDate();
    dateTo = `${year}-${month.padStart(2, '0')}-${lastDay}`;
  }
  
  return { year: y, half: h, dateFrom, dateTo };
}

function getCurrentQuinzaine() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const half = now.getDate() <= 15 ? 1 : 2;
  return `${year}-${month}-${half}`;
}

function getQuinzaineLabel(quinzaine) {
  const parsed = parseQuinzaine(quinzaine);
  return `Q${parsed.half} ${String(parsed.dateFrom).substring(5, 7)}/${parsed.year}`;
}

function isDateInQuinzaine(date, quinzaine) {
  const parsed = parseQuinzaine(quinzaine);
  const d = date instanceof Date ? date.toISOString().split('T')[0] : date;
  return d >= parsed.dateFrom && d <= parsed.dateTo;
}

module.exports = {
  parseQuinzaine,
  getCurrentQuinzaine,
  getQuinzaineLabel,
  isDateInQuinzaine
};
