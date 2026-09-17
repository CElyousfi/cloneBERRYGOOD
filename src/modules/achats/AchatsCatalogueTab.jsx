/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: achats | Déclaration(s): AchatsCatalogueTab */
import { useEffect, useState } from '../shared/reactHooks.jsx';

import * as ArticleCategories from '../shared/lib/articleCategories.js';
import * as FusionMasse from '../shared/lib/fusionMasse.js';
// ===================== ACHATS: CATALOGUE PRODUITS TAB =====================
        function AchatsCatalogueTab({ currentProfile, profileData }) {
            const [articles, setArticles] = useState([]);
            const [loading, setLoading] = useState(true);
            const [importing, setImporting] = useState(false);
            const [importResult, setImportResult] = useState(null);
            const [filterCat, setFilterCat] = useState('');
            const [search, setSearch] = useState('');
            const [selectedArticle, setSelectedArticle] = useState(null);
            const [editMode, setEditMode] = useState(false);
            const [editForm, setEditForm] = useState({});
            const [saving, setSaving] = useState(false);
            const [showCreate, setShowCreate] = useState(false);
            const [createForm, setCreateForm] = useState({ reference:'', nom:'', unite:'U', prix_ht:0, taux_tva:20, prix_ttc:0, categorie:'', sous_categorie:'', type:'', reference_technique:'', multi_ferme:false });
            // --- Fusion de doublons ---
            const peutFusionner = currentProfile === 'achats' || currentProfile === 'dg';
            const [showMerge, setShowMerge] = useState(false);
            const [mergeGroups, setMergeGroups] = useState(null); // null = pas chargé
            const [mergeLoading, setMergeLoading] = useState(false);
            const [mergeMasters, setMergeMasters] = useState({}); // normalized -> master_ref
            const [mergePreview, setMergePreview] = useState(null); // { normalized, data }
            const [mergeBusy, setMergeBusy] = useState(false);
            // --- Fusion EN MASSE (sélection multiple) ---
            // Omar a traité 20 groupes à l'unité ; il en reste 85. C'est le VOLUME
            // qui pose problème, pas la mécanique : on réutilise `merge-articles`
            // groupe par groupe, sans rien réécrire côté fusion.
            const [mergeSelection, setMergeSelection] = useState({}); // normalized -> coché
            const [mergeApercu, setMergeApercu] = useState(null); // { signature, total }
            const [mergeProgress, setMergeProgress] = useState(null); // { phase, fait, total }
            const [mergeRapport, setMergeRapport] = useState(null);

            const actor = () => ({ uid: currentProfile, profileId: currentProfile, name: profileData?.name||currentProfile, email: profileData?.email||'' });

            // Logique PURE d'orchestration (public/lib/fusionMasse.js) : sélection
            // fail-closed, adressage par docId, signature du lot chiffré, comptes
            // rendus. Rien de tout ça ne vit dans le monolithe.
            const FM = FusionMasse || {};
            const mergeLotComplet = FM.construireLot
                ? FM.construireLot(mergeGroups||[], mergeMasters, mergeSelection)
                : { lot: [], ignores: [] };
            const mergeLot = mergeLotComplet.lot;
            const mergeIgnores = mergeLotComplet.ignores;
            // L'aperçu ne vaut QUE pour le lot qu'il a chiffré : dès que la sélection
            // ou un master change, la signature diverge et la fusion se réinterdit.
            const mergeApercuAJour = !!(mergeApercu && FM.signatureLot && mergeApercu.signature === FM.signatureLot(mergeLot));

            const loadDuplicates = () => {
                setShowMerge(true); setMergeLoading(true); setMergeGroups(null); setMergeMasters({}); setMergePreview(null);
                setMergeSelection({}); setMergeApercu(null); setMergeProgress(null); setMergeRapport(null);
                fetch('/api/stock?action=suggest-article-duplicates&profileId='+encodeURIComponent(currentProfile))
                .then(r=>r.json()).then(j=>{
                    // Présélection = le maître SUGGÉRÉ par le serveur (règle pure
                    // lib/stockMerge/masterSuggestion.js), jamais g.articles[0] :
                    // la première fiche du tableau est un ordre Firestore, et
                    // merge-articles ne transfère ni prix ni nb_achats au maître.
                    // Groupe non décidable -> AUCUNE présélection (fail-closed).
                    if(j.success){ setMergeGroups(j.groups||[]); const m={}; (j.groups||[]).forEach(g=>{ if(g.decidable && g.master_suggere) m[g.normalized]=g.master_suggere; }); setMergeMasters(m); }
                    else alert('Erreur: '+j.error);
                }).catch(()=>alert('Erreur réseau')).finally(()=>setMergeLoading(false));
            };

            // ⚠️ On adresse par a.id (le docId), JAMAIS par a.reference : le
            // serveur résout par .doc(<clé>), et 92 fiches ont un `reference`
            // espacé que le docId n'a pas (« ENG 0149 » vs « ENG0149 »). Pire,
            // des documents fantômes sans nom existent à ces références-là :
            // la fusion s'y exécuterait et viderait les libellés de BDC.
            const previewMerge = (group) => {
                const masterRef = mergeMasters[group.normalized];
                const doublonRefs = group.articles.map(a=>a.id).filter(r=>r!==masterRef);
                if(!masterRef || doublonRefs.length===0){ alert('Sélectionnez un master et au moins un doublon'); return; }
                setMergeBusy(true); setMergePreview(null);
                fetch('/api/stock?action=merge-articles', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ master_ref: masterRef, doublon_refs: doublonRefs, mode:'preview', by: actor() }) })
                .then(r=>r.json()).then(j=>{ if(j.success) setMergePreview({ normalized: group.normalized, data: j.preview }); else alert('Erreur: '+j.error); }).catch(()=>alert('Erreur réseau')).finally(()=>setMergeBusy(false));
            };

            const executeMerge = (group) => {
                const masterRef = mergeMasters[group.normalized];
                const doublonRefs = group.articles.map(a=>a.id).filter(r=>r!==masterRef);
                // Même garde que previewMerge : depuis le fail-closed, un groupe
                // indécidable laisse légitimement masterRef à undefined — sans
                // ce contrôle le confirm() annoncerait « fusion dans undefined ».
                if(!masterRef || doublonRefs.length===0){ alert('Sélectionnez un master et au moins un doublon'); return; }
                if(!confirm('Confirmer la fusion de '+doublonRefs.length+' doublon(s) dans « '+masterRef+' » ?\nLes doublons seront désactivés (réversible).')) return;
                setMergeBusy(true);
                fetch('/api/stock?action=merge-articles', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ master_ref: masterRef, doublon_refs: doublonRefs, mode:'execute', by: actor() }) })
                .then(r=>r.json()).then(j=>{ if(j.success){ alert('Fusion effectuée : '+(j.counts?.movements||0)+' mouvement(s), '+(j.counts?.balances||0)+' solde(s), '+(j.counts?.bdc||0)+' BDC réassignés.'); setMergePreview(null); load(); loadDuplicates(); } else alert('Erreur: '+j.error); }).catch(()=>alert('Erreur réseau')).finally(()=>setMergeBusy(false));
            };

            // Coche / décoche un groupe. Un groupe non sélectionnable (aucun article
            // à conserver déterminé) ne peut pas entrer dans le lot : fail-closed,
            // une fusion en masse ne devine jamais un master.
            const basculerSelection = (group) => {
                if(!FM.estSelectionnable || !FM.estSelectionnable(group, mergeMasters)) return;
                setMergeApercu(null);
                setMergeSelection(s => { const n = {...s}; if(n[group.normalized]) delete n[group.normalized]; else n[group.normalized] = true; return n; });
            };

            const toutSelectionner = (tout) => {
                setMergeApercu(null);
                if(!tout){ setMergeSelection({}); return; }
                const cles = FM.clesSelectionnables ? FM.clesSelectionnables(mergeGroups||[], mergeMasters) : [];
                const n = {}; cles.forEach(c => { n[c] = true; }); setMergeSelection(n);
            };

            // APERÇU GLOBAL — obligatoire avant toute écriture. Un `merge-articles`
            // en mode `preview` par groupe (la MÊME action que la fusion unitaire),
            // puis addition des chiffres SERVEUR : l'écran n'invente aucun nombre.
            // Chaque preview scanne cinq collections : la progression est affichée,
            // sinon 85 aperçus font conclure au plantage.
            const apercuLot = async () => {
                if(mergeLot.length===0){ alert('Sélectionnez au moins un groupe fusionnable.'); return; }
                setMergeBusy(true); setMergeApercu(null); setMergeRapport(null);
                setMergeProgress({ phase:'apercu', fait:0, total:mergeLot.length, courant:'' });
                const entrees = [];
                for(let i=0;i<mergeLot.length;i++){
                    const e = mergeLot[i];
                    setMergeProgress({ phase:'apercu', fait:i, total:mergeLot.length, courant:e.normalized });
                    let j;
                    try {
                        j = await fetch('/api/stock?action=merge-articles', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ master_ref: e.master_ref, doublon_refs: e.doublon_refs, mode:'preview', by: actor() }) }).then(r=>r.json());
                    } catch(err) { j = { success:false, error:'erreur réseau' }; }
                    if(!j || !j.success){
                        alert('Aperçu interrompu sur « '+e.normalized+' » : '+((j&&j.error)||'erreur inconnue')+'\nAucune écriture n\'a eu lieu.');
                        setMergeProgress(null); setMergeBusy(false); return;
                    }
                    entrees.push({ normalized:e.normalized, doublon_refs:e.doublon_refs, preview:j.preview });
                }
                setMergeApercu({ signature: FM.signatureLot(mergeLot), total: FM.agregerApercu(entrees) });
                setMergeProgress(null); setMergeBusy(false);
            };

            // EXÉCUTION SÉQUENTIELLE, un groupe après l'autre, via `merge-articles`
            // en mode `execute` — mécanique inchangée. ARRÊT à la première anomalie :
            // les fusions déjà passées sont acquises (chacune a son audit
            // `article_merges` avec snapshot de rollback) et le compte rendu dit
            // lesquelles, sinon un échec à mi-parcours laisse le lot dans le flou.
            const executerLot = async () => {
                if(!mergeApercuAJour){ alert('Prévisualisez le lot avant de fusionner (la sélection a changé depuis le dernier aperçu).'); return; }
                const t = mergeApercu.total;
                if(!confirm('Fusionner '+t.groupes+' groupe(s) de doublons ?\n'
                    +'• '+t.fiches_desactivees+' fiche(s) désactivée(s)\n'
                    +'• '+t.soldes_agreges+' solde(s) agrégé(s) vers le master\n'
                    +'• '+t.mouvements+' mouvement(s) et '+t.bdc+' BDC ouvert(s) réassignés\n'
                    +'Les doublons sont désactivés (réversible).')) return;
                setMergeBusy(true); setMergeRapport(null); setMergePreview(null);
                const resultats = [];
                for(let i=0;i<mergeLot.length;i++){
                    const e = mergeLot[i];
                    setMergeProgress({ phase:'execution', fait:i, total:mergeLot.length, courant:e.normalized });
                    let j;
                    try {
                        j = await fetch('/api/stock?action=merge-articles', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ master_ref: e.master_ref, doublon_refs: e.doublon_refs, mode:'execute', by: actor() }) }).then(r=>r.json());
                    } catch(err) { j = { success:false, error:'erreur réseau' }; }
                    if(!j || !j.success){
                        resultats.push({ normalized:e.normalized, ok:false, error:(j&&j.error)||'erreur inconnue' });
                        break;
                    }
                    resultats.push({ normalized:e.normalized, ok:true, doublon_refs:e.doublon_refs, counts:j.counts||{} });
                    setMergeProgress({ phase:'execution', fait:i+1, total:mergeLot.length, courant:'' });
                }
                const rapport = FM.resumerExecution(mergeLot, resultats, mergeIgnores);
                setMergeProgress(null); setMergeBusy(false);
                // `loadDuplicates` remet le compte rendu à zéro : on le repose APRÈS,
                // sinon Omar perdrait le bilan du lot qu'il vient de lancer.
                load(); loadDuplicates(); setMergeRapport(rapport);
            };

            const load = () => { setLoading(true); fetch('/api/stock?action=list-articles'+(filterCat?'&categorie='+encodeURIComponent(filterCat):'')).then(r=>r.json()).then(j=>{ if(j.success) setArticles(j.articles||[]); }).finally(()=>setLoading(false)); };
            useEffect(()=>{ load(); }, [filterCat]);

            const handleImportSQL = () => {
                if (!confirm('Importer le catalogue depuis BEE ONE (SQL) ?')) return;
                setImporting(true); setImportResult(null);
                fetch('/api/stock?action=import-articles-sql', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ imported_by: { uid: currentProfile, name: profileData?.name||currentProfile } }) })
                .then(r=>r.json()).then(j=>{ setImportResult(j.success ? { type:'success', stats: j.stats, source:'SQL' } : { type:'error', message: j.error }); if(j.success) load(); })
                .catch(e=>setImportResult({ type:'error', message: e.message })).finally(()=>setImporting(false));
            };

            const handleImportExcel = () => {
                if (!confirm('Importer 937 articles depuis le fichier Excel BEE ONE ?\nLes articles existants seront mis à jour (prix, catégories, références).')) return;
                setImporting(true); setImportResult(null);
                fetch('/catalogue_articles.json').then(r => r.json()).then(arts => {
                    return fetch('/api/stock?action=import-articles-excel', { method: 'POST', headers: {'Content-Type':'application/json'},
                        body: JSON.stringify({ articles: arts, imported_by: { uid: currentProfile, name: profileData?.name||currentProfile } })
                    });
                }).then(r => r.json()).then(j => {
                    setImportResult(j.success ? { type:'success', stats: j.stats, source:'Excel' } : { type:'error', message: j.error });
                    if(j.success) load();
                }).catch(e => setImportResult({ type:'error', message: e.message })).finally(() => setImporting(false));
            };

            // unite_consommation / stock_par_unite_consommation : conversion
            // « unité de consommation → unité de stock » (public/lib/uniteConsoUtils.js).
            // Optionnelles : absentes, on consomme dans l'unité de stock et rien ne change.
            const openDetail = (a) => { setSelectedArticle(a); setEditMode(false); setEditForm({ nom:a.nom, reference:a.reference||'', reference_technique:a.reference_technique||'', unite:a.unite||'U', prix_ht:a.prix_ht||0, taux_tva:a.taux_tva||20, prix_ttc:a.prix_ttc||0, categorie:a.categorie||'', sous_categorie:a.sous_categorie||'', type:a.type||'', multi_ferme:a.multi_ferme||false, unite_consommation:a.unite_consommation||'', stock_par_unite_consommation:(a.stock_par_unite_consommation===null||a.stock_par_unite_consommation===undefined)?'':String(a.stock_par_unite_consommation) }); };
            const closeDetail = () => { setSelectedArticle(null); setEditMode(false); };

            const handleUpdate = () => {
                setSaving(true);
                const cleaned = { ...editForm, prix_ht: parseFloat(editForm.prix_ht)||0, taux_tva: parseFloat(editForm.taux_tva)||0, prix_ttc: parseFloat(editForm.prix_ttc)||0 };
                fetch('/api/stock?action=update-article', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id: selectedArticle.id, updates: cleaned, updated_by: { uid: currentProfile, name: profileData?.name||currentProfile } }) })
                .then(r=>r.json()).then(j=>{ if(j.success) { closeDetail(); load(); } else alert('Erreur: '+j.error); }).catch(()=>alert('Erreur réseau')).finally(()=>setSaving(false));
            };

            const handleCreate = () => {
                if (!createForm.reference || !createForm.nom) { alert('Référence et nom requis'); return; }
                setSaving(true);
                const cleaned = { ...createForm, prix_ht: parseFloat(createForm.prix_ht)||0, taux_tva: parseFloat(createForm.taux_tva)||0, prix_ttc: parseFloat(createForm.prix_ttc)||0 };
                fetch('/api/stock?action=create-article', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ...cleaned, created_by: { uid: currentProfile, name: profileData?.name||currentProfile } }) })
                .then(r=>r.json()).then(j=>{ if(j.success) { setShowCreate(false); setCreateForm({ reference:'', nom:'', unite:'U', prix_ht:0, taux_tva:20, prix_ttc:0, categorie:'', sous_categorie:'', type:'', reference_technique:'', multi_ferme:false }); load(); } else alert('Erreur: '+j.error); }).catch(()=>alert('Erreur réseau')).finally(()=>setSaving(false));
            };

            const handleRequestDelete = () => {
                if (!confirm('Demander la suppression de cet article ?\nLa suppression doit être validée par les Finances.')) return;
                setSaving(true);
                fetch('/api/stock?action=request-delete-article', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ article_id: selectedArticle.id, article_nom: selectedArticle.nom, requested_by: { uid: currentProfile, name: profileData?.name||currentProfile } }) })
                .then(r=>r.json()).then(j=>{ if(j.success) { alert('Demande de suppression envoyée aux Finances pour validation.'); closeDetail(); } else alert('Erreur: '+j.error); }).catch(()=>alert('Erreur réseau')).finally(()=>setSaving(false));
            };

            const calcTTC = (ht, tva) => { const h = parseFloat(ht)||0; const t = parseFloat(tva)||0; return (h * (1 + t/100)).toFixed(2); };

            // Compute unique categories from loaded articles
            const allCats = [...new Set(articles.map(a => a.categorie).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'fr'));

            const filtered = articles.filter(a => {
                if (search && !a.nom.toLowerCase().includes(search.toLowerCase()) && !(a.reference||'').toLowerCase().includes(search.toLowerCase())) return false;
                return true;
            });

            const fieldStyle = {width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13,boxSizing:'border-box'};
            const labelStyle = {fontSize:12,fontWeight:600,display:'block',marginBottom:4,color:'#555'};

            const renderFormFields = (form, setForm, isEdit) => (
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                    <div><label style={labelStyle}>Référence *</label><input value={form.reference} onChange={e=>setForm(f=>({...f,reference:e.target.value}))} style={{...fieldStyle,fontFamily:'monospace'}} disabled={isEdit} /></div>
                    <div><label style={labelStyle}>Réf. Technique</label><input value={form.reference_technique} onChange={e=>setForm(f=>({...f,reference_technique:e.target.value}))} style={{...fieldStyle,fontFamily:'monospace'}} /></div>
                    <div style={{gridColumn:'1/-1'}}><label style={labelStyle}>Nom article *</label><input value={form.nom} onChange={e=>setForm(f=>({...f,nom:e.target.value}))} style={fieldStyle} /></div>
                    <div><label style={labelStyle}>Prix HT (MAD)</label><input type="text" inputMode="decimal" value={form.prix_ht} onChange={e=>{ const v=e.target.value; setForm(f=>({...f, prix_ht:v, prix_ttc:calcTTC(v,f.taux_tva)})); }} style={{...fieldStyle,fontFamily:'monospace',fontWeight:700,fontSize:16,color:'var(--berry)'}} /></div>
                    <div><label style={labelStyle}>Taux TVA (%)</label><select value={String(parseFloat(form.taux_tva)||0)} onChange={e=>{ const v=e.target.value; setForm(f=>({...f, taux_tva:v, prix_ttc:calcTTC(f.prix_ht,v)})); }} style={fieldStyle}><option value="0">0%</option><option value="10">10%</option><option value="20">20%</option></select></div>
                    <div><label style={labelStyle}>Prix TTC (MAD)</label><input value={form.prix_ttc} disabled style={{...fieldStyle,fontFamily:'monospace',background:'#f8f8f8',color:'#888'}} /></div>
                    <div><label style={labelStyle}>Unité</label><select value={form.unite} onChange={e=>setForm(f=>({...f,unite:e.target.value}))} style={fieldStyle}><option value="U">Unité</option><option value="KG">KG</option><option value="L">Litre</option><option value="M">Mètre</option><option value="ML">ML</option><option value="T">Tonne</option><option value="Sac">Sac</option><option value="Bidon">Bidon</option><option value="Pièce">Pièce</option></select></div>
                    {/* Liste FERMÉE (ArticleCategories) : le texte libre a produit Engrais/engrais, phyto, PHYTO-SANITAIRE… Une valeur hors liste reste proposée TELLE QUELLE, jamais réécrite en douce. */}
                    <div><label style={labelStyle}>Catégorie</label><select value={form.categorie||''} onChange={e=>setForm(f=>({...f,categorie:e.target.value}))} style={fieldStyle}>{(ArticleCategories ? ArticleCategories.optionsCategorie(form.categorie) : []).map(o=><option key={o.label} value={o.value}>{o.label}</option>)}</select></div>
                    <div><label style={labelStyle}>Sous-catégorie</label><input value={form.sous_categorie} onChange={e=>setForm(f=>({...f,sous_categorie:e.target.value}))} style={fieldStyle} /></div>
                    <div><label style={labelStyle}>Type</label><select value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))} style={fieldStyle}><option value="">—</option><option value="Stockable">Stockable</option><option value="Consommable">Consommable</option><option value="Service">Service</option></select></div>
                    <div style={{display:'flex',alignItems:'center',gap:8,gridColumn:'1/-1'}}><input type="checkbox" checked={form.multi_ferme} onChange={e=>setForm(f=>({...f,multi_ferme:e.target.checked}))} /><label style={{fontSize:12}}>Multi-ferme</label></div>
                    {/* Conversion « unité de consommation → unité de stock ».
                        Composant PARTAGÉ avec l'écran de saisie d'un bon
                        (public/components/ArticleConversionFields.jsx) : c'est lui
                        qui porte la phrase « 1 L = 1,32 KG », seule formulation
                        non ambiguë du facteur. À l'ÉDITION seulement — la
                        création d'article (`create-article`) n'écrit pas encore
                        ces champs, les afficher là ferait croire à une saisie
                        enregistrée. */}
                    {isEdit && window.ArticleConversionFields && (
                        <div style={{gridColumn:'1/-1'}}>
                            <window.ArticleConversionFields
                                uniteStock={form.unite}
                                uniteConsommation={form.unite_consommation}
                                facteur={form.stock_par_unite_consommation}
                                onChange={patch=>setForm(f=>({...f, ...patch}))}
                            />
                        </div>
                    )}
                </div>
            );

            if (loading) return React.createElement('div', {style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));
            return (
                <div className="fade-in">
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
                        <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher article ou réf..." style={{padding:'6px 12px',borderRadius:20,border:'1px solid #ddd',fontSize:12,width:220}} />
                            <select value={filterCat} onChange={e=>setFilterCat(e.target.value)} style={{padding:'5px 12px',borderRadius:20,border: filterCat ? '2px solid var(--berry)' : '1px solid #ddd',background: filterCat ? 'var(--berry-pale)' : '#fff',color: filterCat ? 'var(--berry)' : '#666',fontSize:11,fontWeight:600,cursor:'pointer'}}>
                                <option value="">Toutes catégories ({articles.length})</option>
                                {allCats.map(c => <option key={c} value={c}>{c} ({articles.filter(a=>a.categorie===c).length})</option>)}
                            </select>
                        </div>
                        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                            <button onClick={()=>setShowCreate(true)} style={{background:'#2980b9',color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',cursor:'pointer',fontWeight:600,fontSize:12,display:'flex',alignItems:'center',gap:6}}>
                                <i className="fa-solid fa-plus"></i>Ajouter un produit
                            </button>
                            {peutFusionner && (
                            <button onClick={loadDuplicates} style={{background:'#e67e22',color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',cursor:'pointer',fontWeight:600,fontSize:12,display:'flex',alignItems:'center',gap:6}}>
                                <i className="fa-solid fa-code-merge"></i>Fusionner doublons
                            </button>
                            )}
                            <button onClick={handleImportExcel} disabled={importing} style={{background: importing?'#95a5a6':'var(--berry)',color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',cursor: importing?'not-allowed':'pointer',fontWeight:600,fontSize:12,display:'flex',alignItems:'center',gap:6}}>
                                <i className={importing?'fa-solid fa-spinner fa-spin':'fa-solid fa-file-excel'}></i>{importing?'Import...':'Importer Excel BEE ONE'}
                            </button>
                            <button onClick={handleImportSQL} disabled={importing} style={{background: importing?'#95a5a6':'#27ae60',color:'#fff',border:'none',borderRadius:8,padding:'8px 14px',cursor: importing?'not-allowed':'pointer',fontWeight:600,fontSize:12,display:'flex',alignItems:'center',gap:6}}>
                                <i className={importing?'fa-solid fa-spinner fa-spin':'fa-solid fa-database'}></i>SQL
                            </button>
                        </div>
                    </div>
                    {importResult && (
                        <div style={{background: importResult.type==='success'?'rgba(39,174,96,0.1)':'rgba(231,76,60,0.1)',border:`1px solid ${importResult.type==='success'?'rgba(39,174,96,0.3)':'rgba(231,76,60,0.3)'}`,borderRadius:8,padding:'10px 14px',marginBottom:12,fontSize:12}}>
                            {importResult.type==='success' ? <span><i className="fa-solid fa-circle-check" style={{marginRight:6,color:'#27ae60'}}></i><strong>Import {importResult.source} OK :</strong> {importResult.stats.imported} nouveaux, {importResult.stats.updated} mis à jour{importResult.stats.skipped ? ', '+importResult.stats.skipped+' ignorés' : ''}, total {importResult.stats.total}</span>
                            : <span><i className="fa-solid fa-circle-xmark" style={{marginRight:6,color:'#e74c3c'}}></i>{importResult.message}</span>}
                            <button onClick={()=>setImportResult(null)} style={{float:'right',background:'none',border:'none',cursor:'pointer',color:'#999'}}>×</button>
                        </div>
                    )}
                    <div style={{background:'rgba(52,152,219,0.08)',border:'1px solid rgba(52,152,219,0.2)',borderRadius:8,padding:'8px 14px',marginBottom:12,fontSize:12,color:'#2c3e50'}}>
                        <i className="fa-solid fa-circle-info" style={{marginRight:6,color:'var(--blue)'}}></i>
                        {filtered.length} article(s) sur {articles.length} — Catalogue BEE ONE. Cliquez sur un article pour le modifier.
                    </div>
                    <div className="table-responsive"><table className="data-table">
                        <thead><tr><th>Réf.</th><th>Article</th><th>Catégorie</th><th>Sous-catégorie</th><th>Unité</th><th>Type</th><th>PU HT</th><th>TVA</th></tr></thead>
                        <tbody>
                            {filtered.map(a => {
                                const catColors = {
                                    'Engrais':'#2D8B4E','Pesticides':'#c0392b','Emballage':'#e67e22','Carburants et lubrifiants':'#7f8c8d',
                                    'Energies':'#f39c12','Frais généraux':'#8e44ad','IMMOBILISATION':'#2c3e50','IMMOBILISATIONS':'#2c3e50',
                                    'Fournitures entr. et rép.':'#16a085','Pièces de rechange':'#2980b9','Semences':'#27ae60',
                                };
                                const catColor = catColors[a.categorie] || '#666';
                                return (
                                <tr key={a.id} onClick={()=>openDetail(a)} style={{cursor:'pointer',transition:'background 0.15s'}} onMouseEnter={e=>e.currentTarget.style.background='rgba(155,89,182,0.06)'} onMouseLeave={e=>e.currentTarget.style.background=''}>
                                    <td style={{fontFamily:'monospace',fontSize:11,color:'var(--berry)',fontWeight:600}}>{a.reference||'—'}</td>
                                    <td style={{fontWeight:600}}>{a.nom}</td>
                                    <td><span style={{background: catColor+'1a',color: catColor,padding:'2px 8px',borderRadius:12,fontSize:10,fontWeight:600,whiteSpace:'nowrap'}}>{a.categorie||'—'}</span></td>
                                    <td style={{fontSize:11,color:'#666'}}>{a.sous_categorie||'—'}</td>
                                    <td style={{fontFamily:'monospace',fontSize:12,textAlign:'center'}}>{a.unite}</td>
                                    <td><span style={{fontSize:10,padding:'2px 6px',borderRadius:8,background: a.type_article==='Stockable'?'rgba(39,174,96,0.1)':'rgba(231,76,60,0.1)',color: a.type_article==='Stockable'?'#27ae60':'#e74c3c',fontWeight:600}}>{a.type_article||'—'}</span></td>
                                    <td style={{fontFamily:'monospace',fontSize:12,textAlign:'right',fontWeight:a.prix_ht>0?700:400,color:a.prix_ht>0?'#1a1a2e':'#ccc'}}>{a.prix_ht > 0 ? a.prix_ht.toFixed(2) : '—'}</td>
                                    <td style={{fontFamily:'monospace',fontSize:11,textAlign:'center',color:'#888'}}>{a.taux_tva > 0 ? a.taux_tva+'%' : '—'}</td>
                                </tr>);
                            })}
                            {filtered.length===0 && <tr><td colSpan={8} style={{textAlign:'center',padding:30,color:'#aaa'}}>Aucun article — cliquez sur "Importer Excel BEE ONE"</td></tr>}
                        </tbody>
                    </table></div>

                    {/* Article Detail / Edit Popup */}
                    {selectedArticle && (
                        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={e=>{ if(e.target===e.currentTarget) closeDetail(); }}>
                            <div style={{background:'#fff',borderRadius:14,padding:0,width:'100%',maxWidth:600,maxHeight:'90vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
                                <div style={{background:'linear-gradient(135deg,var(--berry),#8e44ad)',padding:'20px 24px',borderRadius:'14px 14px 0 0',color:'#fff',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                    <div>
                                        <div style={{fontSize:11,opacity:0.8,marginBottom:2}}>{selectedArticle.reference}</div>
                                        <div style={{fontSize:16,fontWeight:700}}>{selectedArticle.nom}</div>
                                    </div>
                                    <button onClick={closeDetail} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'#fff',width:32,height:32,borderRadius:'50%',cursor:'pointer',fontSize:16}}>×</button>
                                </div>
                                <div style={{padding:24}}>
                                    {!editMode ? (
                                        <div>
                                            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:20}}>
                                                <div style={{background:'#f8f9fa',borderRadius:10,padding:14,textAlign:'center'}}>
                                                    <div style={{fontSize:11,color:'#999',marginBottom:4}}>Prix HT</div>
                                                    <div style={{fontSize:22,fontWeight:800,color:'var(--berry)'}}>{(selectedArticle.prix_ht||0).toFixed(2)}</div>
                                                    <div style={{fontSize:11,color:'#999'}}>MAD</div>
                                                </div>
                                                <div style={{background:'#f8f9fa',borderRadius:10,padding:14,textAlign:'center'}}>
                                                    <div style={{fontSize:11,color:'#999',marginBottom:4}}>Prix TTC</div>
                                                    <div style={{fontSize:22,fontWeight:800,color:'#2c3e50'}}>{(selectedArticle.prix_ttc||0).toFixed(2)}</div>
                                                    <div style={{fontSize:11,color:'#999'}}>MAD (TVA {selectedArticle.taux_tva||0}%)</div>
                                                </div>
                                            </div>
                                            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,fontSize:13}}>
                                                <div><span style={{color:'#999',fontSize:11}}>Référence</span><br/><strong style={{fontFamily:'monospace'}}>{selectedArticle.reference||'—'}</strong></div>
                                                <div><span style={{color:'#999',fontSize:11}}>Réf. Technique</span><br/><strong style={{fontFamily:'monospace'}}>{selectedArticle.reference_technique||'—'}</strong></div>
                                                <div><span style={{color:'#999',fontSize:11}}>Catégorie</span><br/><strong>{selectedArticle.categorie||'—'}</strong></div>
                                                <div><span style={{color:'#999',fontSize:11}}>Sous-catégorie</span><br/><strong>{selectedArticle.sous_categorie||'—'}</strong></div>
                                                <div><span style={{color:'#999',fontSize:11}}>Unité</span><br/><strong>{selectedArticle.unite||'—'}</strong></div>
                                                <div><span style={{color:'#999',fontSize:11}}>Type</span><br/><strong>{selectedArticle.type_article||selectedArticle.type||'—'}</strong></div>
                                                <div><span style={{color:'#999',fontSize:11}}>Multi-ferme</span><br/><strong>{selectedArticle.multi_ferme?'Oui':'Non'}</strong></div>
                                            </div>
                                            <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:24,borderTop:'1px solid #f0f0f0',paddingTop:16}}>
                                                <button onClick={handleRequestDelete} disabled={saving} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #e74c3c',background:'rgba(231,76,60,0.05)',color:'#e74c3c',cursor:'pointer',fontSize:12,fontWeight:600,display:'flex',alignItems:'center',gap:6}}>
                                                    <i className="fa-solid fa-trash"></i>Supprimer
                                                </button>
                                                <button onClick={()=>setEditMode(true)} style={{padding:'8px 20px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13,display:'flex',alignItems:'center',gap:6}}>
                                                    <i className="fa-solid fa-pen"></i>Modifier
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <div>
                                            {renderFormFields(editForm, setEditForm, true)}
                                            <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:20}}>
                                                <button onClick={()=>setEditMode(false)} style={{padding:'8px 20px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                                <button onClick={handleUpdate} disabled={saving} style={{padding:'8px 20px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}>
                                                    {saving?'Enregistrement...':'Enregistrer'}
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Create Article Popup */}
                    {showCreate && (
                        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={e=>{ if(e.target===e.currentTarget) setShowCreate(false); }}>
                            <div style={{background:'#fff',borderRadius:14,padding:0,width:'100%',maxWidth:600,maxHeight:'90vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
                                <div style={{background:'linear-gradient(135deg,#2980b9,#3498db)',padding:'20px 24px',borderRadius:'14px 14px 0 0',color:'#fff',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                    <div style={{fontSize:16,fontWeight:700}}><i className="fa-solid fa-plus" style={{marginRight:8}}></i>Nouvel article</div>
                                    <button onClick={()=>setShowCreate(false)} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'#fff',width:32,height:32,borderRadius:'50%',cursor:'pointer',fontSize:16}}>×</button>
                                </div>
                                <div style={{padding:24}}>
                                    {renderFormFields(createForm, setCreateForm, false)}
                                    <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:20}}>
                                        <button onClick={()=>setShowCreate(false)} style={{padding:'8px 20px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                        <button onClick={handleCreate} disabled={saving} style={{padding:'8px 20px',borderRadius:8,border:'none',background:'#2980b9',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}>
                                            {saving?'Création...':'Créer l\'article'}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Fusion de doublons Popup */}
                    {showMerge && (
                        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.5)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:16}} onClick={e=>{ if(e.target===e.currentTarget){ setShowMerge(false); setMergePreview(null); } }}>
                            <div style={{background:'#fff',borderRadius:14,padding:0,width:'100%',maxWidth:760,maxHeight:'90vh',overflowY:'auto',boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
                                <div style={{background:'linear-gradient(135deg,#e67e22,#d35400)',padding:'20px 24px',borderRadius:'14px 14px 0 0',color:'#fff',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                    <div style={{fontSize:16,fontWeight:700}}><i className="fa-solid fa-code-merge" style={{marginRight:8}}></i>Fusionner des articles en doublon</div>
                                    <button onClick={()=>{ setShowMerge(false); setMergePreview(null); }} style={{background:'rgba(255,255,255,0.2)',border:'none',color:'#fff',width:32,height:32,borderRadius:'50%',cursor:'pointer',fontSize:16}}>×</button>
                                </div>
                                <div style={{padding:24}}>
                                    {mergeLoading && <div style={{textAlign:'center',padding:40}}><i className="fa-solid fa-spinner fa-spin" style={{fontSize:28,color:'#e67e22'}}></i></div>}
                                    {!mergeLoading && mergeGroups && mergeGroups.length===0 && (
                                        <div style={{textAlign:'center',padding:30,color:'#27ae60'}}><i className="fa-solid fa-circle-check" style={{fontSize:28,marginBottom:8}}></i><div>Aucun doublon détecté (par nom normalisé).</div></div>
                                    )}
                                    {!mergeLoading && mergeGroups && mergeGroups.length>0 && (
                                        <div style={{display:'flex',flexDirection:'column',gap:16}}>
                                            <div style={{background:'rgba(230,126,34,0.08)',border:'1px solid rgba(230,126,34,0.2)',borderRadius:8,padding:'8px 14px',fontSize:12,color:'#2c3e50'}}>
                                                <i className="fa-solid fa-circle-info" style={{marginRight:6,color:'#e67e22'}}></i>
                                                {mergeGroups.length} groupe(s) de doublons. Choisissez l'article MASTER (à conserver) ; les autres seront fusionnés et désactivés.
                                            </div>
                                            {/* ── FUSION EN MASSE ────────────────────────────────────────
                                                Sélection multiple + aperçu global obligatoire + exécution
                                                séquentielle. La mécanique de fusion elle-même reste celle de
                                                `merge-articles`, appelée groupe par groupe. */}
                                            <div style={{border:'1px solid #d5dbe0',borderRadius:10,padding:'12px 14px',background:'#fbfcfd'}}>
                                                <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                                                    <label style={{display:'flex',alignItems:'center',gap:6,fontSize:12,fontWeight:600,color:'#2c3e50',cursor:'pointer'}}>
                                                        <input type="checkbox" disabled={mergeBusy}
                                                            checked={mergeLot.length>0 && FM.clesSelectionnables && mergeLot.length===FM.clesSelectionnables(mergeGroups, mergeMasters).length}
                                                            onChange={e=>toutSelectionner(e.target.checked)} />
                                                        Tout sélectionner
                                                    </label>
                                                    <span style={{fontSize:12,color:'#555'}}>
                                                        <strong>{mergeLot.length}</strong> groupe(s) sélectionné(s)
                                                        {FM.clesSelectionnables && (mergeGroups.length - FM.clesSelectionnables(mergeGroups, mergeMasters).length) > 0 && (
                                                            <span style={{color:'#c0392b'}}> · {mergeGroups.length - FM.clesSelectionnables(mergeGroups, mergeMasters).length} non sélectionnable(s) (master à choisir)</span>
                                                        )}
                                                    </span>
                                                    <button onClick={apercuLot} disabled={mergeBusy || mergeLot.length===0} style={{marginLeft:'auto',padding:'7px 14px',borderRadius:8,border:'1px solid #e67e22',background:'#fff',color:'#e67e22',cursor:(mergeBusy||mergeLot.length===0)?'not-allowed':'pointer',fontSize:12,fontWeight:600}}>
                                                        Aperçu global du lot
                                                    </button>
                                                    <button onClick={executerLot} disabled={mergeBusy || !mergeApercuAJour} title={!mergeApercuAJour?'Faites l\'aperçu global du lot d\'abord':''} style={{padding:'7px 16px',borderRadius:8,border:'none',background:(mergeBusy||!mergeApercuAJour)?'#bbb':'#27ae60',color:'#fff',cursor:(mergeBusy||!mergeApercuAJour)?'not-allowed':'pointer',fontSize:12,fontWeight:700}}>
                                                        <i className="fa-solid fa-layer-group" style={{marginRight:6}}></i>Fusionner le lot
                                                    </button>
                                                </div>
                                                {mergeProgress && (
                                                    <div style={{marginTop:10,fontSize:12,color:'#2c3e50'}}>
                                                        <i className="fa-solid fa-spinner fa-spin" style={{marginRight:8,color:'#e67e22'}}></i>
                                                        {mergeProgress.phase==='execution' ? 'Fusion en cours' : 'Aperçu en cours'} : <strong>{mergeProgress.fait} / {mergeProgress.total}</strong>
                                                        {mergeProgress.courant ? ' — « '+mergeProgress.courant+' »' : ''}
                                                        <div style={{marginTop:6,height:6,background:'#e8ecef',borderRadius:4,overflow:'hidden'}}>
                                                            <div style={{height:'100%',width:(mergeProgress.total?Math.round(100*mergeProgress.fait/mergeProgress.total):0)+'%',background:mergeProgress.phase==='execution'?'#27ae60':'#e67e22'}}></div>
                                                        </div>
                                                    </div>
                                                )}
                                                {mergeApercuAJour && !mergeProgress && (
                                                    <div style={{marginTop:10,background:'#fff',border:'1px solid #e3e8ec',borderRadius:8,padding:'10px 12px',fontSize:12,color:'#2c3e50'}}>
                                                        <div style={{fontWeight:700,marginBottom:4}}>Aperçu global — ce que la fusion du lot va faire</div>
                                                        <div>• <strong>{mergeApercu.total.groupes}</strong> groupe(s) fusionné(s)</div>
                                                        <div>• <strong>{mergeApercu.total.fiches_desactivees}</strong> fiche(s) désactivée(s)</div>
                                                        <div>• <strong>{mergeApercu.total.soldes_agreges}</strong> solde(s) agrégé(s) vers le master</div>
                                                        <div>• <strong>{mergeApercu.total.mouvements}</strong> mouvement(s) ouvert(s) et <strong>{mergeApercu.total.bdc}</strong> BDC ouvert(s) réassignés</div>
                                                        {mergeIgnores.length>0 && (
                                                            <div style={{marginTop:6,color:'#c0392b'}}>{mergeIgnores.length} groupe(s) coché(s) seront ignorés (master non déterminé).</div>
                                                        )}
                                                    </div>
                                                )}
                                                {mergeRapport && !mergeProgress && (
                                                    <div style={{marginTop:10,background:mergeRapport.arret_anomalie?'rgba(231,76,60,0.06)':'rgba(39,174,96,0.07)',border:'1px solid '+(mergeRapport.arret_anomalie?'rgba(231,76,60,0.3)':'rgba(39,174,96,0.3)'),borderRadius:8,padding:'10px 12px',fontSize:12,color:'#2c3e50'}}>
                                                        <div style={{fontWeight:700,marginBottom:4}}>
                                                            {mergeRapport.arret_anomalie ? 'Lot interrompu à la première anomalie' : 'Lot fusionné'}
                                                        </div>
                                                        <div>• <strong>{mergeRapport.groupes_fusionnes}</strong> groupe(s) fusionné(s), <strong>{mergeRapport.fiches_desactivees}</strong> fiche(s) désactivée(s)</div>
                                                        <div>• <strong>{mergeRapport.soldes_agreges}</strong> solde(s) agrégé(s), {mergeRapport.mouvements} mouvement(s) et {mergeRapport.bdc} BDC réassignés</div>
                                                        {mergeRapport.non_fusionnes.length>0 && (
                                                            <div style={{marginTop:6}}>
                                                                <div style={{fontWeight:600,color:'#c0392b'}}>Non fusionnés ({mergeRapport.non_fusionnes.length}) :</div>
                                                                <ul style={{margin:'4px 0 0 16px',padding:0}}>
                                                                    {mergeRapport.non_fusionnes.map((g,i)=>(<li key={i}>« {g.normalized} » — {g.raison}</li>))}
                                                                </ul>
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                            {mergeGroups.map(group => {
                                                const masterRef = mergeMasters[group.normalized];
                                                const isPreviewing = mergePreview && mergePreview.normalized===group.normalized;
                                                const pv = isPreviewing ? mergePreview.data : null;
                                                // Sélectionnable UNIQUEMENT si un article à conserver est
                                                // déterminé (fail-closed) : sans master, la case est
                                                // désactivée et le groupe ne peut pas entrer dans le lot.
                                                const selectionnable = FM.estSelectionnable ? FM.estSelectionnable(group, mergeMasters) : false;
                                                const coche = !!mergeSelection[group.normalized];
                                                return (
                                                <div key={group.normalized} style={{border:'1px solid '+(coche?'rgba(39,174,96,0.5)':'#eee'),borderRadius:10,padding:14,background:coche?'rgba(39,174,96,0.03)':'#fff'}}>
                                                    <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                                                        <input type="checkbox" checked={coche} disabled={!selectionnable || mergeBusy}
                                                            title={selectionnable ? 'Inclure ce groupe dans la fusion en masse' : (FM.raisonNonSelectionnable ? FM.raisonNonSelectionnable(group, mergeMasters) : 'Choisissez l\'article à conserver')}
                                                            onChange={()=>basculerSelection(group)} />
                                                        <span style={{fontSize:11,color:'#999',fontStyle:'italic'}}>« {group.normalized} »</span>
                                                        {!selectionnable && <span style={{fontSize:10,color:'#c0392b'}}>non sélectionnable en masse</span>}
                                                    </div>
                                                    {/* La suggestion vient du serveur (règle pure) et s'EXPLIQUE : Omar
                                                        confirme d'un coup d'œil au lieu de faire confiance à l'aveugle.
                                                        Groupe non décidable -> aucune présélection, arbitrage humain. */}
                                                    {group.decidable ? (
                                                        <div style={{background:'rgba(39,174,96,0.08)',border:'1px solid rgba(39,174,96,0.25)',borderRadius:6,padding:'6px 10px',fontSize:11,color:'#1e7e45',marginBottom:8}}>
                                                            <i className="fa-solid fa-lightbulb" style={{marginRight:6}}></i>
                                                            Suggestion : conserver <strong>{group.master_suggere}</strong> — {group.raison}. Vous pouvez choisir une autre fiche.
                                                        </div>
                                                    ) : (
                                                        <div style={{background:'rgba(231,76,60,0.08)',border:'1px solid rgba(231,76,60,0.25)',borderRadius:6,padding:'6px 10px',fontSize:11,color:'#c0392b',marginBottom:8}}>
                                                            <i className="fa-solid fa-triangle-exclamation" style={{marginRight:6}}></i>
                                                            Aucune suggestion — {group.raison}. Choisissez vous-même l'article à conserver avant de fusionner.
                                                        </div>
                                                    )}
                                                    <div style={{display:'flex',flexDirection:'column',gap:6}}>
                                                        {group.articles.map(a => {
                                                            const pmpNum = parseFloat(a.prix_pmp);
                                                            const htNum = parseFloat(a.prix_ht);
                                                            const prixVal = (isFinite(pmpNum) && pmpNum > 0) ? pmpNum : ((isFinite(htNum) && htNum > 0) ? htNum : null);
                                                            const prixSrc = (isFinite(pmpNum) && pmpNum > 0) ? 'PMP' : 'HT';
                                                            const achNum = parseFloat(a.nb_achats);
                                                            const nbAch = (isFinite(achNum) && achNum > 0) ? achNum : 0;
                                                            // Comparaison sur le docId, comme l'envoi. Le `!!masterRef`
                                                            // évite qu'un groupe sans présélection (masterRef undefined)
                                                            // coche TOUTES les lignes par égalité d'undefined.
                                                            const estMaster = !!masterRef && masterRef===a.id;
                                                            // Une fiche NON retenue qui porte un prix ou des achats perdrait
                                                            // cette donnée à la fusion (merge-articles ne la transfère pas).
                                                            const perteDonnees = !estMaster && (prixVal!==null || nbAch>0);
                                                            return (
                                                            <label key={a.id} style={{display:'flex',alignItems:'center',gap:8,padding:'6px 8px',borderRadius:6,background: estMaster?'rgba(39,174,96,0.08)':(perteDonnees?'rgba(231,76,60,0.06)':'#fafafa'),cursor:'pointer'}}>
                                                                <input type="radio" name={'master-'+group.normalized} checked={estMaster} onChange={()=>{ setMergeMasters(m=>({...m,[group.normalized]:a.id})); setMergePreview(null); }} />
                                                                <span style={{fontFamily:'monospace',fontSize:11,color:'var(--berry)',fontWeight:600,minWidth:90}}>{a.reference}</span>
                                                                {a.id && a.id!==a.reference && <span title="Identifiant réel du document (celui utilisé par la fusion)" style={{fontFamily:'monospace',fontSize:10,color:'#999'}}>doc {a.id}</span>}
                                                                <span style={{fontSize:13,fontWeight:600}}>{a.nom}</span>
                                                                <span style={{fontSize:10,color:'#888'}}>{a.categorie||''} {a.unite?'· '+a.unite:''}</span>
                                                                <span title="Prix unitaire de la fiche (PMP, sinon prix HT)" style={{fontSize:11,fontWeight:700,color: prixVal!==null?'#2c3e50':'#bbb'}}>{prixVal!==null ? (prixVal.toFixed(2).replace('.',',')+' DH ('+prixSrc+')') : '— DH'}</span>
                                                                <span title="Nombre d'achats historiques" style={{fontSize:10,color: nbAch>0?'#2c3e50':'#bbb'}}>{nbAch>0 ? (nbAch+' achat'+(nbAch>1?'s':'')) : '0 achat'}</span>
                                                                {estMaster ? <span style={{marginLeft:'auto',fontSize:10,color:'#27ae60',fontWeight:700}}>MASTER</span> : <span style={{marginLeft:'auto',fontSize:10,color: perteDonnees?'#c0392b':'#e67e22',fontWeight:600}}>{perteDonnees ? 'doublon ⚠ prix/achats perdus' : 'doublon'}</span>}
                                                            </label>);
                                                        })}
                                                    </div>
                                                    {pv && (
                                                        <div style={{marginTop:10,background:'#f8f9fa',borderRadius:8,padding:12,fontSize:12,color:'#2c3e50'}}>
                                                            <div style={{fontWeight:700,marginBottom:6}}>Prévisualisation</div>
                                                            <div>• {pv.open_movements} mouvement(s) ouvert(s) à réassigner</div>
                                                            <div>• {pv.open_bdc} BDC ouvert(s) à réassigner</div>
                                                            <div>• {pv.doublon_balances_count} solde(s) doublon agrégés vers le master :</div>
                                                            {pv.aggregated_balances && pv.aggregated_balances.length>0 ? (
                                                                <ul style={{margin:'4px 0 4px 16px',padding:0}}>
                                                                    {pv.aggregated_balances.map((b,i)=>(
                                                                        <li key={i} style={{fontFamily:'monospace',fontSize:11}}>{b.lieu_type} {b.lieu_id} : {b.master_current} + {b.doublon_sum} = <strong>{b.resulting}</strong> {b.unite}</li>
                                                                    ))}
                                                                </ul>
                                                            ) : <div style={{marginLeft:16,color:'#888'}}>(aucun solde à agréger)</div>}
                                                            <div style={{marginTop:6,paddingTop:6,borderTop:'1px solid #eee',color:'#888'}}>
                                                                Laissés intacts (historique) : {pv.untouched.historical_movements} mouvement(s) clôturé(s), {pv.untouched.closed_bdc} BDC clôturé(s), {pv.untouched.delivery_notes} BL, {pv.untouched.invoices} facture(s).
                                                            </div>
                                                        </div>
                                                    )}
                                                    <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:10}}>
                                                        <button onClick={()=>previewMerge(group)} disabled={mergeBusy} style={{padding:'7px 14px',borderRadius:8,border:'1px solid #e67e22',background:'#fff',color:'#e67e22',cursor: mergeBusy?'not-allowed':'pointer',fontSize:12,fontWeight:600}}>
                                                            {mergeBusy?'...':'Prévisualiser'}
                                                        </button>
                                                        <button onClick={()=>executeMerge(group)} disabled={mergeBusy || !pv} title={!pv?'Prévisualisez d\'abord':''} style={{padding:'7px 16px',borderRadius:8,border:'none',background: (mergeBusy||!pv)?'#bbb':'#27ae60',color:'#fff',cursor: (mergeBusy||!pv)?'not-allowed':'pointer',fontSize:12,fontWeight:600}}>
                                                            <i className="fa-solid fa-code-merge" style={{marginRight:6}}></i>Confirmer la fusion
                                                        </button>
                                                    </div>
                                                </div>);
                                            })}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

export { AchatsCatalogueTab };
