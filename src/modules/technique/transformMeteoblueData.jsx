/* Module: technique | Déclaration(s): transformMeteoblueData */
import { parsePictocode } from './parsePictocode.jsx';
import { parseWindDir } from './parseWindDir.jsx';

function transformMeteoblueData(apiData, fermeKey) {
            if (!apiData) return null;
            const dayData = apiData.data_day || {};
            const hourData = apiData.data_1h || {};
            const jourNoms = ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'];
            const jourNomsFull = ['Dimanche','Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi'];
            const moisNoms = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
            // Use local date (Africa/Casablanca) instead of UTC to avoid timezone mismatch
            const now = new Date();
            const todayStr = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');

            const previsions = (dayData.time || []).map(function(dateStr, i) {
                var d = new Date(dateStr + 'T12:00:00');
                var picto = parsePictocode(dayData.pictocode ? dayData.pictocode[i] : 1);
                return {
                    date: String(d.getDate()).padStart(2,'0') + '/' + String(d.getMonth()+1).padStart(2,'0'),
                    dateLong: jourNomsFull[d.getDay()] + ' ' + String(d.getDate()).padStart(2,'0') + ' ' + moisNoms[d.getMonth()],
                    dateISO: dateStr,
                    jourNom: jourNoms[d.getDay()],
                    condition: picto.condition,
                    icon: picto.icon,
                    iconColor: picto.color,
                    tMin: Math.round(dayData.temperature_min ? dayData.temperature_min[i] : 0),
                    tMax: Math.round(dayData.temperature_max ? dayData.temperature_max[i] : 0),
                    humidity: Math.round(dayData.relativehumidity_mean ? dayData.relativehumidity_mean[i] : 50),
                    vent: Math.round(dayData.windspeed_max ? dayData.windspeed_max[i] : 0),
                    ventDir: parseWindDir(dayData.winddirection ? dayData.winddirection[i] : 0),
                    precip: Math.round((dayData.precipitation ? dayData.precipitation[i] : 0) * 10) / 10,
                    uv: Math.round(dayData.uvindex ? dayData.uvindex[i] : 0),
                    eto: Math.round((dayData.evapotranspiration ? dayData.evapotranspiration[i] : 0) * 10) / 10,
                    sunrise: dayData.sunrise ? dayData.sunrise[i] : null,
                    sunset: dayData.sunset ? dayData.sunset[i] : null,
                    isToday: dateStr === todayStr
                };
            });

            var horaire = [];
            var horaireParJour = {};
            var horaire24ParJour = {};
            if (hourData.time) {
                hourData.time.forEach(function(t, i) {
                    var parts = t.includes('T') ? t.split('T') : t.split(' ');
                    var dateKey = parts[0];
                    var h = parseInt(parts[1]);
                    var picto = hourData.pictocode ? parsePictocode(hourData.pictocode[i]) : { icon: 'fa-sun', condition: 'Ensoleillé' };
                    var rawTemp = hourData.temperature ? hourData.temperature[i] : 0;
                    var rawRH = hourData.relativehumidity ? hourData.relativehumidity[i] : 50;
                    var rawSW = hourData.shortwave_radiation ? hourData.shortwave_radiation[i] : 0;
                    var rawEto = hourData.evapotranspiration ? hourData.evapotranspiration[i] : 0;
                    var entry = {
                        heure: String(h).padStart(2,'0') + ':00',
                        hour: h,
                        temp: Math.round(rawTemp),
                        tempRaw: rawTemp,
                        humidity: Math.round(rawRH),
                        humidityRaw: rawRH,
                        vent: Math.round(hourData.windspeed ? hourData.windspeed[i] : 0),
                        precip: Math.round((hourData.precipitation ? hourData.precipitation[i] : 0) * 10) / 10,
                        radiation: rawSW,
                        eto: rawEto,
                        icon: h < 7 || h > 19 ? 'fa-moon' : picto.icon,
                        condition: picto.condition,
                        feltTemp: Math.round(hourData.felttemperature ? hourData.felttemperature[i] : rawTemp),
                    };
                    // Horaire aujourd'hui (6h-20h) pour le graphique principal
                    if (dateKey === todayStr && h >= 6 && h <= 20) {
                        horaire.push(entry);
                    }
                    // Horaire par jour pour les popups (5h-22h)
                    if (h >= 5 && h <= 22) {
                        if (!horaireParJour[dateKey]) horaireParJour[dateKey] = [];
                        horaireParJour[dateKey].push(entry);
                    }
                    // Horaire 24h par jour pour le bloc Prévision extérieure
                    if (!horaire24ParJour[dateKey]) horaire24ParJour[dateKey] = [];
                    horaire24ParJour[dateKey].push(entry);
                });
            }

            var alertes = [];
            // Seuil chaleur 35 °C : ALIGNÉ avec functions/lib/meteo/meteoAlertes.js
            // (SEUILS.chaleur). Les deux DOIVENT rester identiques, sinon l'écran et
            // la notification WhatsApp se contredisent. Duplication volontaire : le
            // backend ne peut pas require('../src/…'), Firebase ne déploie que
            // functions/ — tout changement ici doit être répercuté là-bas, et inversement.
            if (previsions.some(function(p) { return p.tMax >= 35; })) alertes.push({ type: 'chaleur', niveau: 'danger', icon: 'fa-temperature-high', color: 'var(--red)', titre: 'Alerte Forte Chaleur', message: 'Température max prévue de ' + Math.max.apply(null, previsions.map(function(p){return p.tMax;})) + '°C. Prévoir irrigation supplémentaire et protection des ouvriers.', jours: previsions.filter(function(p){return p.tMax >= 35;}).map(function(p){return p.dateLong;}).join(', ') });
            if (previsions.some(function(p) { return p.humidity < 40; })) alertes.push({ type: 'humidite', niveau: 'warning', icon: 'fa-droplet-slash', color: 'var(--orange)', titre: 'Humidité Très Basse', message: 'Humidité prévue sous 40%. Risque de stress hydrique. Augmenter irrigation.', jours: previsions.filter(function(p){return p.humidity < 40;}).map(function(p){return p.dateLong;}).join(', ') });
            if (previsions.some(function(p) { return p.tMin <= 8; })) alertes.push({ type: 'gel', niveau: 'danger', icon: 'fa-snowflake', color: 'var(--blue)', titre: 'Risque Température Basse', message: 'Température minimale de ' + Math.min.apply(null, previsions.map(function(p){return p.tMin;})) + '°C prévue. Risque pour framboises et myrtilles.', jours: previsions.filter(function(p){return p.tMin <= 8;}).map(function(p){return p.dateLong;}).join(', ') });
            if (previsions.some(function(p) { return p.vent >= 25; })) alertes.push({ type: 'vent', niveau: 'warning', icon: 'fa-wind', color: '#8E44AD', titre: 'Vent Fort', message: 'Rafales jusqu\'à ' + Math.max.apply(null, previsions.map(function(p){return p.vent;})) + ' km/h. Vérifier fixations tunnels et bâches.', jours: previsions.filter(function(p){return p.vent >= 25;}).map(function(p){return p.dateLong;}).join(', ') });
            if (previsions.some(function(p) { return p.uv >= 9; })) alertes.push({ type: 'uv', niveau: 'warning', icon: 'fa-sun', color: 'var(--red)', titre: 'Indice UV Élevé', message: 'Indice UV très élevé (' + Math.max.apply(null, previsions.map(function(p){return p.uv;})) + '). Protection ouvriers en plein champ.', jours: previsions.filter(function(p){return p.uv >= 9;}).map(function(p){return p.dateLong;}).join(', ') });
            if (previsions.some(function(p) { return p.precip >= 10; })) alertes.push({ type: 'pluie', niveau: 'warning', icon: 'fa-cloud-showers-heavy', color: 'var(--blue)', titre: 'Pluie Importante', message: 'Précipitations de ' + Math.max.apply(null, previsions.map(function(p){return p.precip;})) + ' mm prévues. Reporter traitements phyto.', jours: previsions.filter(function(p){return p.precip >= 10;}).map(function(p){return p.dateLong;}).join(', ') });

            return { previsions: previsions, horaire: horaire, horaireParJour: horaireParJour, horaire24ParJour: horaire24ParJour, alertes: alertes };
        }

export { transformMeteoblueData };
