/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: technique | Déclaration(s): MapRenderer */
import { useEffect } from '../shared/reactHooks.jsx';

// ===================== CHEF: AGRONOMIE TAB =====================
        // ===================== SURVEILLANCE AGRO — Photos terrain =====================

        // Map renderer — isolated to prevent Leaflet re-init issues with React re-renders.
        function MapRenderer({ mapRef, mapInstanceRef, observations, currentLocation, haversine }) {
            useEffect(() => {
                if (!mapRef.current || typeof L === 'undefined') return;
                if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; }

                const defaultCenter = [30.42, -9.6]; // Souss-Massa
                const map = L.map(mapRef.current, { scrollWheelZoom: true }).setView(defaultCenter, 13);
                mapInstanceRef.current = map;
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '&copy; OpenStreetMap',
                    maxZoom: 19,
                }).addTo(map);

                const bounds = [];
                const varietyGroups = {};

                observations.forEach(obs => {
                    if (!obs.location || !obs.location.lat) return;
                    const { lat, lng } = obs.location;
                    bounds.push([lat, lng]);
                    const v = obs.variete || '—';
                    if (!varietyGroups[v]) varietyGroups[v] = [];
                    varietyGroups[v].push(obs);

                    const firstPhoto = (obs.photo_urls || [])[0];
                    const popupHtml = `<div style="max-width:200px;text-align:center">` +
                        (firstPhoto ? `<img src="${firstPhoto.url}" style="width:100%;max-height:120px;object-fit:cover;border-radius:6px;margin-bottom:6px"/>` : '') +
                        `<div style="font-weight:700;font-size:12px">${v}</div>` +
                        `<div style="font-size:10px;color:#6b7280">${obs.ferme} · ${new Date(obs.date_analyse || obs.created_at).toLocaleDateString('fr-FR')}</div>` +
                        (obs.note_demande ? `<div style="font-size:10px;color:#374151;margin-top:4px;font-style:italic">"${obs.note_demande.slice(0,80)}"</div>` : '') +
                        `</div>`;

                    const marker = L.circleMarker([lat, lng], {
                        radius: 8, fillColor: '#8B5CF6', color: '#fff', weight: 2, fillOpacity: 0.9,
                    }).addTo(map).bindPopup(popupHtml);
                });

                // Témoin circles per variety
                Object.entries(varietyGroups).forEach(([v, obsList]) => {
                    if (obsList.length < 2) return;
                    const avgLat = obsList.reduce((s, o) => s + o.location.lat, 0) / obsList.length;
                    const avgLng = obsList.reduce((s, o) => s + o.location.lng, 0) / obsList.length;
                    L.circle([avgLat, avgLng], { radius: 15, color: '#8B5CF6', fillOpacity: 0.08, weight: 1.5, dashArray: '5,5' })
                        .addTo(map).bindTooltip(`Témoin ${v} (15m)`, { permanent: false, direction: 'top' });

                    // Polyline connecting observations chronologically
                    const sorted = obsList.sort((a, b) => (a.date_analyse || a.created_at || 0) - (b.date_analyse || b.created_at || 0));
                    const pts = sorted.map(o => [o.location.lat, o.location.lng]);
                    if (pts.length > 1) L.polyline(pts, { color: '#c4b5fd', weight: 1.5, dashArray: '4,4', opacity: 0.6 }).addTo(map);

                    // Color markers outside témoin radius as orange
                    obsList.forEach(obs => {
                        const d = haversine(obs.location.lat, obs.location.lng, avgLat, avgLng);
                        if (d > 15) {
                            L.circleMarker([obs.location.lat, obs.location.lng], {
                                radius: 10, fillColor: '#f59e0b', color: '#fff', weight: 2, fillOpacity: 0.9,
                            }).addTo(map).bindTooltip(`${Math.round(d)}m du témoin`, { permanent: false });
                        }
                    });
                });

                // Current location marker
                if (currentLocation) {
                    bounds.push([currentLocation.lat, currentLocation.lng]);
                    L.marker([currentLocation.lat, currentLocation.lng], {
                        icon: L.divIcon({
                            className: '',
                            html: '<div style="width:16px;height:16px;border-radius:50%;background:#3b82f6;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.3)"></div>',
                            iconSize: [16, 16], iconAnchor: [8, 8],
                        }),
                    }).addTo(map).bindPopup('Ma position');
                }

                if (bounds.length > 0) {
                    map.fitBounds(bounds, { padding: [30, 30], maxZoom: 17 });
                }

                return () => { if (mapInstanceRef.current) { mapInstanceRef.current.remove(); mapInstanceRef.current = null; } };
            }, [observations, currentLocation]);

            return null;
        }

export { MapRenderer };
