/* Module: shared | Déclaration(s): getSatFriWeek */


// ===================== TRÉSORERIE (Finance & DG) =====================
        // Sat-Fri week (calendrier Driscoll's) — début = samedi 00:00 local
        function getSatFriWeek(date) {
            const d = new Date(date);
            d.setHours(0, 0, 0, 0);
            const day = d.getDay(); // 0=Sun..6=Sat
            const diffToSat = (day - 6 + 7) % 7;
            const start = new Date(d);
            start.setDate(d.getDate() - diffToSat);
            const end = new Date(start);
            end.setDate(start.getDate() + 6);
            end.setHours(23, 59, 59, 999);
            return { start, end };
        }

export { getSatFriWeek };
