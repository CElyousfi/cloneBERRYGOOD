/* Module: technique | Déclaration(s): parsePictocode */


function parsePictocode(code) {
            const map = {
                1: { condition: 'Ensoleillé', icon: 'fa-sun', color: '#F39C12' },
                2: { condition: 'Partiellement ensoleillé', icon: 'fa-cloud-sun', color: '#3498DB' },
                3: { condition: 'Partiellement nuageux', icon: 'fa-cloud-sun', color: '#3498DB' },
                4: { condition: 'Nuageux', icon: 'fa-cloud', color: '#95A5A6' },
                5: { condition: 'Brouillard', icon: 'fa-smog', color: '#BDC3C7' },
                6: { condition: 'Couvert + Bruine', icon: 'fa-cloud-rain', color: '#5DADE2' },
                7: { condition: 'Pluie', icon: 'fa-cloud-showers-heavy', color: '#2980B9' },
                8: { condition: 'Averses', icon: 'fa-cloud-showers-heavy', color: '#2980B9' },
                9: { condition: 'Neige', icon: 'fa-snowflake', color: '#85C1E9' },
                10: { condition: 'Neige fondue', icon: 'fa-cloud-meatball', color: '#85C1E9' },
                11: { condition: 'Orage', icon: 'fa-cloud-bolt', color: '#8E44AD' },
                12: { condition: 'Pluie verglaçante', icon: 'fa-icicles', color: '#5499C7' },
                13: { condition: 'Averses de neige', icon: 'fa-snowflake', color: '#85C1E9' },
                14: { condition: 'Orage avec pluie', icon: 'fa-cloud-bolt', color: '#8E44AD' },
                15: { condition: 'Brouillard bas', icon: 'fa-smog', color: '#BDC3C7' },
                16: { condition: 'Pluie légère', icon: 'fa-cloud-rain', color: '#5DADE2' },
                17: { condition: 'Neige légère', icon: 'fa-snowflake', color: '#AED6F1' },
            };
            return map[code] || { condition: 'Inconnu', icon: 'fa-question', color: '#999' };
        }

export { parsePictocode };
