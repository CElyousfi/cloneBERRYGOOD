/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: technique | Déclaration(s): parseWindDir */


function parseWindDir(deg) {
            const dirs = ['N','NE','E','SE','S','SO','O','NO'];
            return dirs[Math.round(deg / 45) % 8];
        }

export { parseWindDir };
