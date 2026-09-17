/* Module: admin | Déclaration(s): TemplateSimulator */


// ===================== ADMIN CONSOLE =====================
        function TemplateSimulator({ authFetch, testPhone, setMsg }) {
            const TEMPLATES = [
                { name: 'welcome_smartberry', label: 'Bienvenue', sample: ['Mohamed'], placeholders: ['Prénom'], type: 'welcome', profiles: ['chef'] },
                { name: 'bdc_validation_needed', label: 'BDC à valider (Chef)', sample: ['BDC-2026-0042', 'Engrais NPK', '45000 MAD'], placeholders: ['Numéro BDC', 'Description', 'Montant'], type: 'bdc_submit', profiles: ['chef'] },
                { name: 'bdc_chef_approved', label: 'BDC validé Chef → DG', sample: ['BDC-2026-0042'], placeholders: ['Numéro BDC'], type: 'bdc_chef_approved', profiles: ['dg'] },
                { name: 'bdc_dg_approved', label: 'BDC validé DG → Achats/Finance', sample: ['BDC-2026-0042', 'Engrais NPK', '45000 MAD'], placeholders: ['Numéro', 'Description', 'Montant'], type: 'bdc_dg_approved', profiles: ['achats', 'finance'] },
                { name: 'bdc_rejected', label: 'BDC rejeté → Achats', sample: ['BDC-2026-0042', 'Prix trop élevé'], placeholders: ['Numéro', 'Motif'], type: 'bdc_rejected', profiles: ['achats'] },
                { name: 'bdc_sent_to_supplier', label: 'BDC envoyé fournisseur → Finance', sample: ['BDC-2026-0042', 'Maroc Engrais SARL'], placeholders: ['Numéro', 'Fournisseur'], type: 'bdc_sent_to_supplier', profiles: ['finance'] },
                { name: 'bdc_virement_update', label: 'Virement (lancé/signé)', sample: ['BDC-2026-0042', 'Virement signé'], placeholders: ['Numéro', 'Statut'], type: 'bdc_virement_signed', profiles: ['achats', 'finance'] },
                { name: 'pointage_validation_needed', label: 'Pointage à valider', sample: ['2026-05-01', 'BSAA'], placeholders: ['Date', 'Ferme'], type: 'pointage_validation', profiles: ['chef'] },
                { name: 'quality_alert', label: 'Alerte qualité', sample: ['Expédition manquante détectée le 2026-05-01'], placeholders: ['Message'], type: 'quality_alert', profiles: ['qualite', 'dg'] },
                { name: 'general_alert', label: 'Alerte générale', sample: ['Nouvelle alerte sur le tableau de bord'], placeholders: ['Message'], type: 'general_alert', profiles: ['dg'] },
                { name: 'expedition_rejected', label: 'Rejet d\'expédition', sample: ['RPT-TEST-001', '01/05/2026 14:30', 'Sweet Sensation', 'BSAA', '1250', 'Soft fruit 18%'], placeholders: ['Receipt', 'Date/heure', 'Variété', 'Ferme', 'Volume kg', 'Motif'], type: 'expedition_rejected', profiles: ['chef', 'qualite', 'dg'] },
            ];

            const [selectedTemplate, setSelectedTemplate] = React.useState(TEMPLATES[0].name);
            const [params, setParams] = React.useState(TEMPLATES[0].sample);
            const [mode, setMode] = React.useState('phone'); // 'phone' or 'profiles'
            const [phone, setPhone] = React.useState('');
            const [profiles, setProfiles] = React.useState([]);
            const [ferme, setFerme] = React.useState('BSAA');
            const [sending, setSending] = React.useState(false);

            const tpl = TEMPLATES.find(t => t.name === selectedTemplate);

            const handleTemplateChange = (name) => {
                setSelectedTemplate(name);
                const t = TEMPLATES.find(x => x.name === name);
                if (t) {
                    setParams(t.sample);
                    setProfiles(t.profiles);
                }
            };

            const handleSend = async () => {
                if (!sending) setSending(true);
                try {
                    const body = { template_name: selectedTemplate, params };
                    if (mode === 'phone') {
                        if (!phone) { setMsg('Numéro requis'); setSending(false); return; }
                        body.phone = phone;
                    } else {
                        if (profiles.length === 0) { setMsg('Au moins un profil requis'); setSending(false); return; }
                        body.profiles = profiles;
                        body.type = tpl.type;
                        body.ferme = ferme;
                        // Build data for dispatcher mapping
                        body.data = {};
                        if (tpl.type === 'bdc_submit' || tpl.type === 'bdc_dg_approved') {
                            body.data = { numero: params[0], description: params[1] || '', montant: params[2] || '' };
                        } else if (tpl.type === 'bdc_chef_approved') body.data = { numero: params[0] };
                        else if (tpl.type === 'bdc_rejected') body.data = { numero: params[0], motif: params[1] || '' };
                        else if (tpl.type === 'bdc_sent_to_supplier') body.data = { numero: params[0], supplier: params[1] || '' };
                        else if (tpl.type === 'bdc_virement_signed') body.data = { numero: params[0] };
                        else if (tpl.type === 'pointage_validation') body.data = { date: params[0], ferme: params[1] };
                        else if (tpl.type === 'quality_alert' || tpl.type === 'general_alert') body.data = { message: params[0] };
                        else if (tpl.type === 'welcome') body.data = { displayName: params[0] };
                        else if (tpl.type === 'expedition_rejected') body.data = { receiptId: params[0], dateTime: params[1], variety: params[2], ranch: params[3], weightKg: params[4], reason: params[5] };
                    }
                    const r = await authFetch('/api/whatsapp-admin?action=simulate-template', { method: 'POST', body: JSON.stringify(body) });
                    const json = await r.json();
                    setMsg(json.success ? '✓ Simulation envoyée' : 'Erreur: ' + (json.error || 'Inconnue'));
                } catch (e) { setMsg(e.message); }
                setSending(false);
            };

            const PROFILE_OPTIONS = ['chef', 'caporal', 'rh', 'dg', 'achats', 'finance', 'qualite'];

            return (
                <div>
                    <div style={{fontSize:12,fontWeight:600,marginBottom:8}}>🧪 Simulateur de templates</div>
                    <div style={{fontSize:11,color:'var(--gray-500)',marginBottom:10}}>Tester n'importe quel template avec des données personnalisées.</div>

                    <div style={{marginBottom:10}}>
                        <label style={{display:'block',fontSize:11,fontWeight:600,marginBottom:4}}>Template</label>
                        <select value={selectedTemplate} onChange={e => handleTemplateChange(e.target.value)}
                            style={{width:'100%',padding:'6px 10px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:12,boxSizing:'border-box'}}>
                            {TEMPLATES.map(t => <option key={t.name} value={t.name}>{t.label} ({t.name})</option>)}
                        </select>
                    </div>

                    <div style={{marginBottom:10}}>
                        <label style={{display:'block',fontSize:11,fontWeight:600,marginBottom:4}}>Paramètres</label>
                        {tpl.placeholders.map((ph, i) => (
                            <div key={i} style={{marginBottom:4}}>
                                <input value={params[i] || ''} onChange={e => { const p = [...params]; p[i] = e.target.value; setParams(p); }}
                                    placeholder={ph}
                                    style={{width:'100%',padding:'6px 10px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:11,boxSizing:'border-box'}} />
                            </div>
                        ))}
                    </div>

                    <div style={{marginBottom:10,display:'flex',gap:8}}>
                        <label style={{fontSize:11,fontWeight:600,display:'flex',alignItems:'center',gap:4}}>
                            <input type="radio" checked={mode === 'phone'} onChange={() => setMode('phone')} /> Envoi à un numéro
                        </label>
                        <label style={{fontSize:11,fontWeight:600,display:'flex',alignItems:'center',gap:4}}>
                            <input type="radio" checked={mode === 'profiles'} onChange={() => setMode('profiles')} /> Envoi à des profils
                        </label>
                    </div>

                    {mode === 'phone' ? (
                        <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+212 6XX XXX XXX"
                            style={{width:'100%',padding:'6px 10px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:12,boxSizing:'border-box',marginBottom:10}} />
                    ) : (
                        <div style={{marginBottom:10}}>
                            <div style={{display:'flex',flexWrap:'wrap',gap:6,marginBottom:6}}>
                                {PROFILE_OPTIONS.map(p => (
                                    <label key={p} style={{fontSize:11,padding:'4px 8px',background: profiles.includes(p) ? 'var(--berry)' : 'var(--gray-100)',color: profiles.includes(p) ? '#fff' : 'var(--gray-600)',borderRadius:6,cursor:'pointer'}}>
                                        <input type="checkbox" checked={profiles.includes(p)} onChange={e => {
                                            if (e.target.checked) setProfiles([...profiles, p]);
                                            else setProfiles(profiles.filter(x => x !== p));
                                        }} style={{display:'none'}} />
                                        {p}
                                    </label>
                                ))}
                            </div>
                            {profiles.includes('chef') && (
                                <input value={ferme} onChange={e => setFerme(e.target.value)} placeholder="Ferme (filtre pour Chef)"
                                    style={{width:'100%',padding:'6px 10px',borderRadius:6,border:'1px solid var(--gray-200)',fontSize:11,boxSizing:'border-box'}} />
                            )}
                        </div>
                    )}

                    <button onClick={handleSend} disabled={sending}
                        style={{padding:'6px 16px',background: sending ? 'var(--gray-300)' : '#6f42c1',color:'#fff',border:'none',borderRadius:8,fontSize:12,fontWeight:600,cursor: sending ? 'wait' : 'pointer'}}>
                        <i className={`fa-solid ${sending ? 'fa-spinner fa-spin' : 'fa-flask'}`} style={{marginRight:4}}></i>
                        Lancer la simulation
                    </button>
                </div>
            );
        }

export { TemplateSimulator };
