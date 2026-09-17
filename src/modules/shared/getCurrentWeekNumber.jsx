/* Module: shared | Déclaration(s): getCurrentWeekNumber */


// Get current week number (standard calendar week: Sun-Sat, matching backend & budget)
        // Get current week number (Sat-Fri, calendrier Driscoll's)
        function getCurrentWeekNumber() {
            const now = new Date();
            now.setHours(12, 0, 0, 0);
            const jan1 = new Date(now.getFullYear(), 0, 1, 12, 0, 0);
            const days = Math.floor((now - jan1) / 86400000);
            const jan1Dow = (jan1.getDay() + 1) % 7;
            return Math.ceil((days + jan1Dow + 1) / 7);
        }

export { getCurrentWeekNumber };
