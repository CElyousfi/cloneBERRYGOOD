/* Module: qualite | Déclaration(s): deduplicateExpeditions */


// ===================== QUALITE INSPECTIONS TAB =====================
        // Deduplicate expeditions by batchNumber, merging fields from all records
        function deduplicateExpeditions(expeditions) {
            const byBatch = {};
            expeditions.forEach(e => {
                if (!e.batchNumber) return;
                if (!byBatch[e.batchNumber]) { byBatch[e.batchNumber] = { ...e }; return; }
                // Merge: prefer non-null/non-zero values from each record
                const existing = byBatch[e.batchNumber];
                Object.entries(e).forEach(([k, v]) => {
                    if (v != null && v !== '' && v !== 0 && (existing[k] == null || existing[k] === '' || existing[k] === 0)) {
                        existing[k] = v;
                    }
                });
            });
            // Also include expeditions without batchNumber
            const noBatch = expeditions.filter(e => !e.batchNumber);
            return [...Object.values(byBatch), ...noBatch];
        }

export { deduplicateExpeditions };
