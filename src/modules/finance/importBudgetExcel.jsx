/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: finance | Déclaration(s): importBudgetExcel */
import { BUDGET_BGF } from './BUDGET_BGF.jsx';
import { BUDGET_BGF_DEFAULT } from './BUDGET_BGF_DEFAULT.jsx';

// Import budget Excel — parse all sheets into BUDGET_BGF format
        function importBudgetExcel(file) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    try {
                        const wb = XLSX.read(e.target.result, { type: 'array' });
                        const sheetNameMap = {
                            'MARAVILLA GREEN CANE': 'Maravilla Green Cane',
                            'MARAVILLA LONG CANE': 'Maravilla Long Cane',
                            'CORINA': 'Corina',
                            'BREEZE': 'Breeze',
                            'CASCADE': 'Cascade',
                            'YASMIN CUT BACK': 'Yazmin Bi Cycle',
                        };
                        const result = {};
                        wb.SheetNames.forEach(sheetName => {
                            const varName = sheetNameMap[sheetName.toUpperCase().trim()] || sheetName;
                            const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
                            // Find total: look for row with 'BGF' and a number
                            let total = 0;
                            for (let i = 0; i < Math.min(rows.length, 5); i++) {
                                const row = rows[i];
                                for (let j = 0; j < row.length; j++) {
                                    if (String(row[j]).toUpperCase().trim() === 'BGF' && typeof row[j+1] === 'number') {
                                        total = row[j+1];
                                        break;
                                    }
                                }
                                if (total > 0) break;
                            }
                            // Find distribution rows: look for rows after header with [week, percentage, ...]
                            const distribution = {};
                            let headerFound = false;
                            for (const row of rows) {
                                if (String(row[0] || row[1] || '').toUpperCase().includes('WEEK')) { headerFound = true; continue; }
                                if (!headerFound) continue;
                                // Handle both col A or col B for week number
                                let week, pct;
                                if (typeof row[0] === 'number' && typeof row[1] === 'number') {
                                    week = row[0]; pct = row[1];
                                } else if (typeof row[1] === 'number' && typeof row[2] === 'number') {
                                    week = row[1]; pct = row[2];
                                } else continue;
                                if (week > 0 && pct > 0) distribution[week] = pct;
                            }
                            if (total > 0 && Object.keys(distribution).length > 0) {
                                result[varName] = { total, distribution };
                            }
                        });
                        // Save to localStorage
                        localStorage.setItem('budgetBGFConfig', JSON.stringify(result));
                        // Update live BUDGET_BGF
                        Object.keys(BUDGET_BGF).forEach(k => delete BUDGET_BGF[k]);
                        Object.assign(BUDGET_BGF, BUDGET_BGF_DEFAULT, result);
                        resolve(result);
                    } catch(err) { reject(err); }
                };
                reader.onerror = reject;
                reader.readAsArrayBuffer(file);
            });
        }

export { importBudgetExcel };
