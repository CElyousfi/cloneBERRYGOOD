/* Migré depuis public/app.jsx — extraction verbatim (non-régression).
   Module: achats | Déclaration(s): AchatsBDCTab */
import { formatModePaiement } from '../caisse/formatModePaiement.jsx';
import { isModeComptant } from '../caisse/isModeComptant.jsx';
import { isModeEspeces } from '../caisse/isModeEspeces.jsx';
import { isModeFacilite } from '../caisse/isModeFacilite.jsx';
import { isModeVirement } from '../caisse/isModeVirement.jsx';
import { getBdcSociete } from '../finance/getBdcSociete.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { useEffect, useState } from '../shared/reactHooks.jsx';

// ===================== ACHATS: BONS DE COMMANDE TAB =====================
        function AchatsBDCTab({ currentProfile, profileData }) {
            const [bdcList, setBdcList] = useState([]);
            const [suppliers, setSuppliers] = useState([]);
            const [loading, setLoading] = useState(true);
            const [showForm, setShowForm] = useState(false);
            const [selectedBdc, setSelectedBdc] = useState(null);
            const [bdcDetail, setBdcDetail] = useState(null);
            const [filterStatus, setFilterStatus] = useState('');
            const [searchQuery, setSearchQuery] = useState('');
            const FARMS = ['Toutes', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'BAHIA', 'Avocatier'];
            const TVA_RATES = [0, 7, 10, 14, 20];
            const emptyItem = { article: '', categorie: 'engrais', quantite: '', unite: 'kg', prix_unitaire: '', taux_tva: 20 };
            const [form, setForm] = useState({ supplier_id: '', purchase_request_id: '', fournisseur: { nom: '', ice: '', adresse: '', ville: '', tel: '', email: '' }, ferme: 'F1', date_livraison_prevue: '', code_analytique: '', mode_paiement: 'comptant_virement', items: [{ ...emptyItem }] });
            const [codesAnalytiques, setCodesAnalytiques] = useState([]);
            const [catalogueArticles, setCatalogueArticles] = useState([]);
            const [daApprouvees, setDaApprouvees] = useState([]);
            const [cachetBase64, setCachetBase64] = useState(null);
            const [signatureDgBase64, setSignatureDgBase64] = useState(null);
            const [showCreateSupplier, setShowCreateSupplier] = useState(false);
            const [newSupplier, setNewSupplier] = useState({ nom: '', identifiant_fiscal: '', ice: '', adresse: '', ville: '', tel: '', email: '', contact_nom: '', categorie: 'autre' });
            const [creatingSup, setCreatingSup] = useState(false);
            const [showCreateArticle, setShowCreateArticle] = useState(false);
            const [newArticle, setNewArticle] = useState({ reference: '', nom: '', unite: 'kg', categorie: 'autre', taux_tva: 20 });
            const [creatingArt, setCreatingArt] = useState(false);
            const [createArticleLineIdx, setCreateArticleLineIdx] = useState(null); // ligne BDC en cours pour auto-sélection
            const canCreateArticle = currentProfile === 'achats' || currentProfile === 'dg';

            // Slug -> référence par défaut (l'utilisateur peut l'écraser)
            const suggestRef = (nom) => 'ART-' + (nom || '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
            // Ouvre la mini-saisie article, préremplie depuis le nom tapé sur la ligne idx
            const openCreateArticle = (lineIdx, prefillNom) => {
                const nom = (prefillNom || '').trim();
                setNewArticle({ reference: nom ? suggestRef(nom) : '', nom, unite: 'kg', categorie: 'autre', taux_tva: 20 });
                setCreateArticleLineIdx(typeof lineIdx === 'number' ? lineIdx : null);
                setShowCreateArticle(true);
            };

            const handleCreateSupplier = async () => {
                if (!newSupplier.nom.trim()) return alert('Le nom du fournisseur est requis');
                setCreatingSup(true);
                try {
                    const r = await fetch('/api/stock?action=create-supplier', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newSupplier, created_by: { profileId: currentProfile, name: profileData?.fullName || currentProfile } }) });
                    const j = await r.json();
                    if (j.success) {
                        // Le fournisseur est validé immédiatement : la liste status=valide le contient déjà
                        const listR = await fetch('/api/stock?action=list-suppliers&status=valide');
                        const listJ = await listR.json();
                        if (listJ.success) {
                            const list = listJ.suppliers || [];
                            setSuppliers(list);
                            const created = list.find(s => s.id === j.id);
                            if (created) setForm(f => ({ ...f, supplier_id: created.id, fournisseur: { nom: created.nom, ice: created.ice || '', adresse: created.adresse || '', ville: created.ville || '', tel: created.tel || '', email: created.email || '' } }));
                        }
                        setShowCreateSupplier(false);
                        setNewSupplier({ nom: '', identifiant_fiscal: '', ice: '', adresse: '', ville: '', tel: '', email: '', contact_nom: '', categorie: 'autre' });
                    } else if (j.errors) {
                        alert(Object.values(j.errors).join('\n'));
                    } else { alert(j.error || 'Erreur lors de la création'); }
                } catch (e) { alert('Erreur réseau'); }
                setCreatingSup(false);
            };

            const handleCreateArticle = async () => {
                if (!newArticle.nom.trim() || !newArticle.reference.trim()) return alert('Le nom et la référence sont requis');
                setCreatingArt(true);
                try {
                    const r = await fetch('/api/stock?action=create-article', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newArticle, created_by: { profileId: currentProfile, name: profileData?.fullName || currentProfile } }) });
                    const j = await r.json();
                    if (j.success) {
                        const listR = await fetch('/api/stock?action=list-articles');
                        const listJ = await listR.json();
                        if (listJ.success) { const seen = new Set(); setCatalogueArticles((listJ.articles||[]).filter(a => { if(seen.has(a.nom)) return false; seen.add(a.nom); return true; })); }
                        // Sélectionne l'article fraîchement créé sur la ligne en cours + préremplit unité/catégorie/TVA
                        if (createArticleLineIdx != null) {
                            const li = createArticleLineIdx;
                            updateItem(li, 'article', newArticle.nom);
                            updateItem(li, 'unite', (newArticle.unite || 'kg').toLowerCase());
                            updateItem(li, 'categorie', newArticle.categorie || 'autre');
                            if (newArticle.taux_tva != null && newArticle.taux_tva !== '') updateItem(li, 'taux_tva', parseFloat(newArticle.taux_tva));
                        }
                        setShowCreateArticle(false);
                        setCreateArticleLineIdx(null);
                        setNewArticle({ reference: '', nom: '', unite: 'kg', categorie: 'autre', taux_tva: 20 });
                    } else { alert(j.error || 'Erreur lors de la création'); }
                } catch (e) { alert('Erreur réseau'); }
                setCreatingArt(false);
            };

            useEffect(() => {
                const loadImg = (src, cb) => { const img = new Image(); img.crossOrigin = 'anonymous'; img.src = src; img.onload = () => { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); cb(c.toDataURL('image/png')); }; };
                loadImg('/assets/cachet.png', setCachetBase64);
                loadImg('/assets/signature_transparent_hd.png', setSignatureDgBase64);
            }, []);
            useEffect(() => { fetch('/api/stock?action=list-codes-analytiques').then(r=>r.json()).then(j=>{ if(j.success) setCodesAnalytiques(j.codes||[]); }).catch(()=>{}); }, []);
            useEffect(() => { fetch('/api/stock?action=list-articles').then(r=>r.json()).then(j=>{ if(j.success) { const seen = new Set(); setCatalogueArticles((j.articles||[]).filter(a => { if(seen.has(a.nom)) return false; seen.add(a.nom); return true; })); } }).catch(()=>{}); }, []);
            useEffect(() => {
                fetch('/api/stock?action=list-da&status=approuvee&ferme=' + form.ferme)
                    .then(r=>r.json()).then(j=>{ if(j.success) setDaApprouvees(j.das||[]); }).catch(()=>{});
            }, [form.ferme]);

            const statusLabels = { brouillon: 'Brouillon', en_attente_chef: 'Attente Chef', valide_chef: 'Validé Chef', en_attente_dg: 'Attente DG', valide_dg: 'Validé DG', envoye: 'Envoyé', virement_lance: 'Virement Lancé', virement_signe: 'Virement Signé', rejete: 'Rejeté', annule: 'Annulé' };
            const statusClass = (s) => { if (s === 'brouillon') return 'brouillon'; if (s.startsWith('en_attente')) return 'en-attente'; if (s.startsWith('valide') || s === 'envoye' || s === 'virement_lance' || s === 'virement_signe') return 'valide'; if (s === 'rejete' || s === 'annule') return 'rejete'; return ''; };

            const loadBdc = () => {
                const url = '/api/stock?action=list-bdc' + (filterStatus ? '&status=' + filterStatus : '');
                fetch(url).then(r => r.json()).then(json => { if (json.success) setBdcList(json.bdc || []); })
                    .catch(err => console.warn('BDC error:', err)).finally(() => setLoading(false));
            };
            useEffect(() => {
                const saved = localStorage.getItem('achats_bdc_filter');
                if (saved) { setFilterStatus(saved); localStorage.removeItem('achats_bdc_filter'); }
            }, []);
            useEffect(() => { loadBdc(); }, [filterStatus]);
            useEffect(() => {
                const pendingBdcId = sessionStorage.getItem('openBdcId');
                if (pendingBdcId) { sessionStorage.removeItem('openBdcId'); setTimeout(() => { openDetail(pendingBdcId); }, 500); }
            }, []);
            useEffect(() => { cachedFetch('/api/stock?action=list-suppliers&status=valide').then(json => { if (json.success) setSuppliers(json.suppliers || []); }).catch(() => {}); }, []);

            const [editMode, setEditMode] = useState(null); // null or bdc id being edited
            const [editForm, setEditForm] = useState(null);
            const [justCreated, setJustCreated] = useState(null); // { id, numero } after creation

            const selectSupplier = (id) => { const s = suppliers.find(x => x.id === id); if (s) setForm(f => ({ ...f, supplier_id: id, fournisseur: { nom: s.nom, ice: s.ice || '', adresse: s.adresse || '', ville: s.ville || '', tel: s.tel || '', email: s.email || '' } })); };
            const selectDA = (daId) => {
                const da = daApprouvees.find(d => d.id === daId);
                if (!da) { setForm(f => ({ ...f, purchase_request_id: '' })); return; }
                const mappedItems = (da.items || []).map(it => ({ article: it.article || '', categorie: it.categorie || 'engrais', quantite: String(it.quantite || ''), unite: it.unite || 'kg', prix_unitaire: '', taux_tva: 20 }));
                setForm(f => ({ ...f, purchase_request_id: daId, items: mappedItems.length ? mappedItems : [{ ...emptyItem }] }));
            };
            const updateItem = (idx, field, value) => { setForm(f => { const items = [...f.items]; items[idx] = { ...items[idx], [field]: value }; return { ...f, items }; }); };
            const addItem = () => setForm(f => ({ ...f, items: [...f.items, { ...emptyItem }] }));
            const removeItem = (idx) => { setForm(f => f.items.length > 1 ? { ...f, items: f.items.filter((_, i) => i !== idx) } : f); };

            const calcTotal = () => { let ht = 0, tva = 0; form.items.forEach(it => { const mht = (parseFloat(it.quantite) || 0) * (parseFloat(it.prix_unitaire) || 0); ht += mht; tva += mht * (it.taux_tva != null && it.taux_tva !== '' ? parseFloat(it.taux_tva) : 20) / 100; }); return { ht: Math.round(ht*100)/100, tva: Math.round(tva*100)/100, ttc: Math.round((ht+tva)*100)/100 }; };

            const handleCreate = () => {
                if (!form.fournisseur.nom) { alert('Sélectionnez un fournisseur'); return; }
                if (!form.items.some(i => i.article && i.quantite && i.prix_unitaire)) { alert('Ajoutez au moins un article complet'); return; }
                const validItems = form.items.filter(i => i.article && i.quantite && i.prix_unitaire);
                fetch('/api/stock?action=create-bdc', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...form, items: validItems, created_by: { profileId: currentProfile, name: profileData?.name || currentProfile } }),
                }).then(r => r.json()).then(json => { if (json.success) { setJustCreated({ id: json.id, numero: json.numero }); loadBdc(); } else alert('Erreur: ' + (json.error || 'Echec')); }).catch(() => alert('Erreur réseau'));
            };

            // Génère le PDF du BDC et l'upload vers Storage pour qu'il soit joint à la notification WhatsApp.
            // Accepte soit un id (recherche dans bdcList/bdcDetail, comportement historique) soit directement
            // l'objet bdc — utile juste après création, quand bdcList/bdcDetail n'ont pas encore été rafraîchis.
            // Retourne { pdf_url, error } — pdf_url est null en cas d'échec (la soumission n'est jamais bloquée),
            // error contient un message si l'échec doit être signalé à l'utilisateur.
            const uploadBdcPdf = async (idOrBdc) => {
                const isBdcObject = idOrBdc && typeof idOrBdc === 'object';
                const id = isBdcObject ? idOrBdc.id : idOrBdc;
                const bdc = isBdcObject ? idOrBdc : (bdcList.find(b => b.id === id) || (bdcDetail && bdcDetail.bdc && bdcDetail.bdc.id === id ? bdcDetail.bdc : null));
                if (!bdc) return { pdf_url: null, error: null };
                if (typeof generatePdfBdc !== 'function') return { pdf_url: null, error: 'Génération PDF indisponible' };
                try {
                    const doc = generatePdfBdc(bdc);
                    const blob = doc.output('blob');
                    const ref = firebase.storage().ref().child(`bdc_pdfs/${id}.pdf`);
                    await ref.put(blob, { contentType: 'application/pdf' });
                    const pdf_url = await ref.getDownloadURL();
                    return { pdf_url, error: null };
                } catch (err) {
                    console.warn('PDF upload BDC échoué (non bloquant):', err && err.message);
                    return { pdf_url: null, error: (err && err.message) ? err.message : 'Echec upload PDF' };
                }
            };

            // Reconstruit un objet bdc "complet" (avec montants calculés) à partir du form de création,
            // pour permettre la génération du PDF avant que bdcList/bdcDetail ne soient rafraîchis.
            const buildBdcForPdf = (id, numero) => {
                const t = calcTotal();
                const items = form.items.filter(i => i.article && i.quantite && i.prix_unitaire).map(it => {
                    const mht = (parseFloat(it.quantite) || 0) * (parseFloat(it.prix_unitaire) || 0);
                    const tva = mht * (it.taux_tva != null && it.taux_tva !== '' ? parseFloat(it.taux_tva) : 20) / 100;
                    return { ...it, montant_ht: mht, montant_ttc: mht + tva };
                });
                return { ...form, id, numero, items, total_ht: t.ht, total_tva: t.tva, total_ttc: t.ttc, created_at: new Date().toISOString(), status: 'soumis' };
            };

            const handleSubmit = async (id) => {
                if (!confirm('Soumettre ce BDC pour validation ?')) return;
                const { pdf_url, error: pdfError } = await uploadBdcPdf(id);
                try {
                    const r = await fetch('/api/stock?action=submit-bdc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, pdf_url, submitted_by: { profileId: currentProfile, name: profileData?.name || currentProfile } }) });
                    const json = await r.json();
                    if (json.success) {
                        if (pdfError) alert('BDC soumis, mais le PDF n\'a pas pu être joint (' + pdfError + '). Le DG recevra une notification sans document — vous pourrez le renvoyer plus tard.');
                        loadBdc(); if (bdcDetail) openDetail(id);
                    }
                    else alert('Erreur: ' + (json.error || 'Echec'));
                } catch (_) { alert('Erreur réseau'); }
            };
            const handleSubmitDirect = async (id) => {
                const bdcForPdf = (justCreated && justCreated.id === id) ? buildBdcForPdf(id, justCreated.numero) : id;
                const { pdf_url, error: pdfError } = await uploadBdcPdf(bdcForPdf);
                try {
                    const r = await fetch('/api/stock?action=submit-bdc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, pdf_url, submitted_by: { profileId: currentProfile, name: profileData?.name || currentProfile } }) });
                    const json = await r.json();
                    if (json.success) {
                        if (pdfError) alert('BDC soumis, mais le PDF n\'a pas pu être joint (' + pdfError + '). Le DG recevra une notification sans document — vous pourrez le renvoyer plus tard.');
                        setShowForm(false); setJustCreated(null); loadBdc();
                    }
                    else alert('Erreur: ' + (json.error || 'Echec'));
                } catch (_) { alert('Erreur réseau'); }
            };
            const handleSend = (id) => { if (!confirm('Marquer ce BDC comme envoyé au fournisseur ?')) return; fetch('/api/stock?action=send-bdc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, sent_by: { profileId: currentProfile, name: profileData?.name || currentProfile } }) }).then(r => r.json()).then(json => { if (json.success) { loadBdc(); if (bdcDetail) openDetail(id); } else alert('Erreur: ' + (json.error || 'Echec')); }).catch(() => alert('Erreur réseau')); };

            // Upload de l'avis de virement (PDF) — pour Finance/DG/Admin sur BDC en virement_signe.
            const handleUploadAvisVirement = async (id) => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'application/pdf';
                input.onchange = async () => {
                    const file = input.files && input.files[0];
                    if (!file) return;
                    if (file.type !== 'application/pdf') { alert('Veuillez sélectionner un fichier PDF.'); return; }
                    if (file.size > 10 * 1024 * 1024) { alert('PDF trop volumineux (max 10 MB).'); return; }
                    try {
                        const ref = firebase.storage().ref().child(`bdc_avis_virement/${id}.pdf`);
                        await ref.put(file, { contentType: 'application/pdf' });
                        const avis_pdf_url = await ref.getDownloadURL();
                        const r = await fetch('/api/stock?action=upload-virement-avis', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ id, avis_pdf_url, uploaded_by: { profileId: currentProfile, name: profileData?.name || currentProfile } }),
                        });
                        const json = await r.json();
                        if (json.success) {
                            alert('Avis de virement enregistré. Achats sera notifié via WhatsApp.');
                            loadBdc(); if (bdcDetail) openDetail(id);
                        } else {
                            alert('Erreur: ' + (json.error || 'Echec'));
                        }
                    } catch (err) {
                        alert('Erreur upload: ' + (err && err.message ? err.message : 'inconnue'));
                    }
                };
                input.click();
            };
            const handleDeleteBdc = (id, status) => { const isValidated = status && status !== 'brouillon'; const msg = isValidated ? 'Ce BDC a déjà été validé. Voulez-vous vraiment le supprimer définitivement ?' : 'Supprimer définitivement ce BDC brouillon ?'; if (!confirm(msg)) return; fetch('/api/stock?action=delete-bdc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, deleted_by: { profileId: currentProfile, name: profileData?.fullName || currentProfile } }) }).then(r => r.json()).then(json => { if (json.success) { setSelectedBdc(null); setBdcDetail(null); loadBdc(); } else alert('Erreur: ' + (json.error || 'Echec')); }).catch(() => alert('Erreur réseau')); };
            const handleRemindBdc = (id, status) => {
                const profileLabel = status === 'en_attente_chef' ? 'Chef de ferme'
                    : status === 'en_attente_dg' ? 'DG'
                    : status === 'envoye' ? 'Finance (virement)'
                    : status === 'virement_lance' ? 'Finance + DG (signature virement)'
                    : 'destinataire';
                if (!confirm(`Envoyer un rappel WhatsApp à ${profileLabel} pour ce BDC ?`)) return;
                fetch('/api/stock?action=remind-bdc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, by: { profileId: currentProfile, name: profileData?.name || currentProfile } }) })
                    .then(r => r.json())
                    .then(json => {
                        if (json.success) { alert(`Rappel envoyé à ${json.profiles.join(', ')} (en attente depuis ${json.duration})`); loadBdc(); if (bdcDetail) openDetail(id); }
                        else alert('Erreur: ' + (json.error || 'Echec'));
                    })
                    .catch(() => alert('Erreur réseau'));
            };

            const openDetail = (id) => { setSelectedBdc(id); setEditMode(null); fetch('/api/stock?action=get-bdc&id=' + id).then(r => r.json()).then(json => { if (json.success) setBdcDetail(json); }).catch(() => {}); };

            const startEdit = (bdc) => {
                setEditForm({
                    supplier_id: bdc.supplier_id || '',
                    fournisseur: { ...bdc.fournisseur },
                    ferme: bdc.ferme || 'F1',
                    date_livraison_prevue: bdc.date_livraison_prevue || '',
                    code_analytique: bdc.code_analytique || '',
                    mode_paiement: bdc.mode_paiement || 'virement_bancaire',
                    items: (bdc.items || []).map(it => ({ article: it.article || '', categorie: it.categorie || 'autre', quantite: String(it.quantite || ''), unite: it.unite || 'kg', prix_unitaire: String(it.prix_unitaire || ''), taux_tva: it.taux_tva != null ? it.taux_tva : 20 })),
                });
                setEditMode(bdc.id || selectedBdc);
            };
            const startDuplicate = (bdc) => {
                setForm({
                    supplier_id: bdc.supplier_id || '',
                    purchase_request_id: '', // pas de lien DA sur une duplication
                    fournisseur: { ...bdc.fournisseur },
                    ferme: bdc.ferme || 'F1',
                    date_livraison_prevue: '', // à redéfinir, pas de sens de copier une date passée
                    code_analytique: bdc.code_analytique || '',
                    mode_paiement: bdc.mode_paiement || 'comptant_virement',
                    items: (bdc.items || []).map(it => ({
                        article: it.article || '', categorie: it.categorie || 'autre',
                        quantite: String(it.quantite || ''), unite: it.unite || 'kg',
                        prix_unitaire: String(it.prix_unitaire || ''),
                        taux_tva: it.taux_tva != null ? it.taux_tva : 20,
                    })),
                });
                setSelectedBdc(null); setBdcDetail(null); setEditMode(null); // ferme le détail si ouvert
                setJustCreated(null);
                setShowForm(true);
            };
            const editUpdateItem = (idx, field, value) => { const items = [...editForm.items]; items[idx] = { ...items[idx], [field]: value }; setEditForm({ ...editForm, items }); };
            const editSelectSupplier = (id) => { const s = suppliers.find(x => x.id === id); if (s) setEditForm(f => ({ ...f, supplier_id: id, fournisseur: { nom: s.nom, ice: s.ice || '', adresse: s.adresse || '', ville: s.ville || '', tel: s.tel || '', email: s.email || '' } })); };
            const editCalcTotal = () => { let ht = 0, tva = 0; (editForm?.items || []).forEach(it => { const mht = (parseFloat(it.quantite)||0) * (parseFloat(it.prix_unitaire)||0); ht += mht; tva += mht * (it.taux_tva != null && it.taux_tva !== '' ? parseFloat(it.taux_tva) : 20) / 100; }); return { ht: Math.round(ht*100)/100, tva: Math.round(tva*100)/100, ttc: Math.round((ht+tva)*100)/100 }; };

            const handleUpdate = () => {
                if (!editForm.fournisseur.nom || editForm.fournisseur.nom === 'À définir') { alert('Sélectionnez un fournisseur'); return; }
                if (!editForm.items.some(i => i.article && i.quantite)) { alert('Ajoutez au moins un article avec une quantité'); return; }
                const validItems = editForm.items.filter(i => i.article && i.quantite);
                fetch('/api/stock?action=update-bdc', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: editMode, ...editForm, items: validItems, updated_by: { profileId: currentProfile, name: profileData?.name || currentProfile } }),
                }).then(r => r.json()).then(json => {
                    if (json.success) { alert('BDC mis à jour'); setEditMode(null); setEditForm(null); openDetail(selectedBdc); loadBdc(); }
                    else alert('Erreur: ' + (json.error || 'Echec'));
                }).catch(() => alert('Erreur réseau'));
            };

            const printBdc = (bdc) => {
                const itemsHtml = bdc.items.map((it, i) => '<tr><td>'+(i+1)+'</td><td>'+it.article+'</td><td>'+it.quantite+' '+(it.unite||'')+'</td><td>'+(parseFloat(it.prix_unitaire)||0).toFixed(2)+'</td><td>'+it.taux_tva+'%</td><td>'+(parseFloat(it.montant_ht)||0).toFixed(2)+'</td><td>'+(parseFloat(it.montant_ttc)||0).toFixed(2)+'</td></tr>').join('');
                const dgSigImg = signatureDgBase64 ? `<img src="${signatureDgBase64}" alt="Signature DG" style="max-width:140px;max-height:55px;object-fit:contain;margin:4px auto;display:block">` : `<div style="font-family:'Dancing Script',cursive;font-size:22px;color:#8B2252;font-weight:700">${bdc.validated_by_dg?.name||'DG'}</div>`;
                const dgVisa = bdc.validated_by_dg ? `${dgSigImg}<div style="font-size:10px;color:#666;margin-top:2px">${bdc.validated_by_dg.name||'DG'} — Signé le ${new Date(bdc.validated_by_dg.at).toLocaleString('fr-FR')}</div>` : '<p style="color:#aaa">En attente</p>';
                const chefVisa = bdc.validated_by_chef ? `<div style="font-family:'Dancing Script',cursive;font-size:22px;color:#2D8B4E;font-weight:700">${bdc.validated_by_chef.name||'Chef'}</div><div style="font-size:10px;color:#666;margin-top:2px">Signé électroniquement le ${new Date(bdc.validated_by_chef.at).toLocaleString('fr-FR')}</div>` : '<p style="color:#aaa">En attente</p>';
                const analytique = bdc.code_analytique ? `<p><strong>Code analytique :</strong> <span style="font-family:monospace;background:#f0f0f0;padding:2px 6px;border-radius:4px">${bdc.code_analytique}</span></p>` : '';
                const consultation = bdc.consultation_id ? `<p><strong>Réf. Consultation :</strong> ${bdc.consultation_id}</p>` : '';
                const modePmt = isModeEspeces(bdc.mode_paiement) ? '<span style="background:#f39c12;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px">COMPTANT — ESPÈCES</span>' : isModeFacilite(bdc.mode_paiement) ? '<span style="background:#27ae60;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px">FACILITÉ</span>' : '<span style="background:#2980b9;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px">COMPTANT — VIREMENT</span>';
                const html = `<html><head><title>BDC ${bdc.numero}</title><link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&display=swap" rel="stylesheet"><style>body{font-family:Arial,sans-serif;margin:40px;color:#333;font-size:13px}h1{color:#8B2252;font-size:20px;margin:0}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{padding:7px 10px;border:1px solid #ddd;text-align:left;font-size:12px}th{background:#f5f5f5;font-weight:600}.sig-box{border:1px solid #ddd;border-radius:6px;padding:12px;text-align:center;min-height:70px;display:flex;flex-direction:column;justify-content:center}@media print{body{margin:15px}}</style></head><body>
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid #8B2252">
                  <div><h1>BON DE COMMANDE</h1><p style="margin:4px 0"><strong>${bdc.numero}</strong> &nbsp;|&nbsp; Date : ${new Date(bdc.created_at).toLocaleDateString('fr-FR')} &nbsp;|&nbsp; Ferme : ${bdc.ferme}</p>${analytique}${consultation}<p>Mode paiement : ${modePmt}</p></div>
                  <div style="text-align:right;background:#faf7f9;border:1px solid #e0c0d0;border-radius:6px;padding:10px 14px;min-width:220px"><p style="margin:0 0 4px 0;font-size:9px;color:#8B2252;font-weight:700;text-transform:uppercase;letter-spacing:0.5px">Fournisseur</p><p style="margin:2px 0;font-size:14px;font-weight:700;color:#333">${bdc.fournisseur?.nom||''}</p>${(bdc.fournisseur?.adresse||bdc.fournisseur?.ville)?'<p style="margin:2px 0;font-size:11px;color:#555">'+[bdc.fournisseur?.adresse,bdc.fournisseur?.ville].filter(Boolean).join(' — ')+'</p>':''}${bdc.fournisseur?.ice?'<p style="margin:2px 0;font-size:11px;color:#666">ICE : '+bdc.fournisseur.ice+'</p>':''}${bdc.fournisseur?.tel?'<p style="margin:2px 0;font-size:11px;color:#666">Tél : '+bdc.fournisseur.tel+'</p>':''}${bdc.fournisseur?.email?'<p style="margin:2px 0;font-size:11px;color:#666">'+bdc.fournisseur.email+'</p>':''}</div>
                </div>
                <table><thead><tr><th>#</th><th>Article</th><th>Quantité</th><th>PU (MAD)</th><th>TVA</th><th>Montant HT</th><th>Montant TTC</th></tr></thead><tbody>${itemsHtml}</tbody></table>
                <div style="text-align:right;margin-top:8px"><p style="margin:3px 0">Total HT : <strong>${(parseFloat(bdc.total_ht)||0).toFixed(2)} MAD</strong></p><p style="margin:3px 0">TVA : <strong>${(parseFloat(bdc.total_tva)||0).toFixed(2)} MAD</strong></p><p style="margin:3px 0;font-size:16px;color:#8B2252">Total TTC : <strong>${(parseFloat(bdc.total_ttc)||0).toFixed(2)} MAD</strong></p></div>
                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-top:40px">
                  <div class="sig-box"><p style="margin:0 0 8px 0;font-weight:600;font-size:11px;color:#666">RESPONSABLE ACHATS</p>${bdc.status !== 'brouillon' ? '<div style="font-family:\'Dancing Script\',cursive;font-size:22px;color:#1e3c78;font-weight:700">Achraf Inak</div><div style="font-size:10px;color:#666;margin-top:2px">Responsable Achats</div>' : '<p style="color:#aaa">En attente</p>'}</div>
                  <div class="sig-box"><p style="margin:0 0 8px 0;font-weight:600;font-size:11px;color:#666">CHEF DE FERME — ${bdc.ferme}</p>${chefVisa}</div>
                  <div class="sig-box" style="position:relative"><p style="margin:0 0 8px 0;font-weight:600;font-size:11px;color:#666">DIRECTEUR GÉNÉRAL</p>${dgVisa}${bdc.validated_by_dg && cachetBase64 ? '<img src="'+cachetBase64+'" alt="Cachet" style="position:absolute;right:5px;top:5px;width:65px;height:65px;opacity:0.5">' : ''}</div>
                </div>
                <p style="font-size:10px;color:#999;margin-top:30px;text-align:center">Document généré le ${new Date().toLocaleString('fr-FR')} — Berry Good Farms</p>
                </body></html>`;
                const w = window.open('', '_blank', 'width=900,height=700'); w.document.write(html); w.document.close(); setTimeout(() => w.print(), 600);
            };

            const [showEmailForm, setShowEmailForm] = useState(false);
            const [changeRequestModal, setChangeRequestModal] = useState(null); // { type: 'modification'|'annulation' }
            const [changeMotif, setChangeMotif] = useState('');

            const handleRequestChange = (type) => {
                if (!changeMotif.trim()) { alert('Motif obligatoire'); return; }
                fetch('/api/stock?action=request-bdc-change', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bdc_id: selectedBdc, type, motif: changeMotif.trim(), requested_by: { profileId: currentProfile, name: profileData?.name || currentProfile } }),
                }).then(r => r.json()).then(json => {
                    if (json.success) { alert('Demande envoyée au DG'); setChangeRequestModal(null); setChangeMotif(''); openDetail(selectedBdc); }
                    else alert('Erreur: ' + (json.error || 'Echec'));
                }).catch(() => alert('Erreur réseau'));
            };

            // ---- Suivi Livraison ----
            const [receptionMode, setReceptionMode] = useState(false);
            const [receptionItems, setReceptionItems] = useState([]);
            const [receptionDate, setReceptionDate] = useState('');
            const [receptionNumBL, setReceptionNumBL] = useState('');
            const [submittingReception, setSubmittingReception] = useState(false);

            // Logique extraite dans public/lib/bdcReceptionUtils.js (réutilisée par
            // MagBdcReceptionTab et MagBonsCommandeTab) — comportement identique.
            const getDeliveryData = (bdc, bls) => window.BdcReceptionUtils.computeDeliveryData(bdc.items, bls);

            const startReception = (mode) => {
                const data = getDeliveryData(bdcDetail.bdc, bdcDetail.bls);
                const itemsToReceive = data.filter(d => d.reste > 0);
                if (!itemsToReceive.length) { alert('Tous les articles sont déjà livrés'); return; }
                setReceptionItems(itemsToReceive.map(d => ({
                    article: d.article, quantite_commandee: d.qCmd, quantite_recue: mode === 'totale' ? d.reste : 0, unite: d.unite, note: ''
                })));
                setReceptionDate(new Date().toISOString().split('T')[0]);
                setReceptionNumBL('');
                setReceptionMode(true);
            };

            const submitReception = () => {
                const validItems = receptionItems.filter(it => it.quantite_recue > 0);
                if (!validItems.length) { alert('Saisissez au moins une quantité reçue'); return; }
                setSubmittingReception(true);
                fetch('/api/stock?action=create-bl', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bdc_id: selectedBdc, date_reception: receptionDate, numero_bl_fournisseur: receptionNumBL, items: validItems, created_by: { profileId: currentProfile, name: profileData?.name || currentProfile } }),
                }).then(r => r.json()).then(json => {
                    if (json.success) { alert('Réception enregistrée — BL ' + json.numero + ' créé\nStatut livraison : ' + (json.delivery_status === 'complet' ? 'Complet' : 'Partiel')); setReceptionMode(false); openDetail(selectedBdc); loadBdc(); }
                    else alert('Erreur: ' + (json.error || 'Echec'));
                }).catch(() => alert('Erreur réseau')).finally(() => setSubmittingReception(false));
            };

            const [emailForm, setEmailForm] = useState({ to: '', subject: '', message: '' });
            const [sendingEmail, setSendingEmail] = useState(false);

            const generatePdfBdc = (bdc) => {
                const { jsPDF } = window.jspdf;
                const doc = new jsPDF('p', 'mm', 'a4');
                const W = 210, M = 15;
                let y = 15;
                const societe = getBdcSociete(bdc.ferme);
                doc.setFontSize(16); doc.setFont('helvetica', 'bold'); doc.setTextColor(139, 34, 82);
                doc.text(societe.nom, M, y); y += 6;
                doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(100);
                doc.text(societe.forme, M, y); y += 3.5;
                doc.text(societe.adresse, M, y); y += 3.5;
                doc.text(societe.immat, M, y); y += 8;
                doc.setDrawColor(139, 34, 82); doc.setLineWidth(0.5); doc.line(M, y, W - M, y); y += 8;
                doc.setFontSize(14); doc.setFont('helvetica', 'bold'); doc.setTextColor(139, 34, 82);
                doc.text('BON DE COMMANDE', M, y);
                doc.setFontSize(11); doc.text(bdc.numero, W - M, y, { align: 'right' }); y += 7;
                doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(50);
                doc.text('Date : ' + new Date(bdc.created_at).toLocaleDateString('fr-FR'), M, y);
                doc.text('Ferme : ' + (bdc.ferme || ''), M + 60, y);
                const modePmt = formatModePaiement(bdc.mode_paiement);
                doc.text('Paiement : ' + modePmt, M + 110, y); y += 5;
                if (bdc.code_analytique) { doc.text('Code analytique : ' + bdc.code_analytique, M, y); y += 5; }
                if (bdc.date_livraison_prevue) { doc.text('Livraison pr\u00e9vue : ' + bdc.date_livraison_prevue, M, y); y += 5; }
                y += 3;
                doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(139, 34, 82);
                const contactReceptionMsg = "POUR LA R\u00c9CEPTION, PRI\u00c8RE DE CONTACTER M. HASSAN SAHRAOUI AVANT D'ORGANISER LA LIVRAISON AU 06-70-02-01-99";
                const contactReceptionLines = doc.splitTextToSize(contactReceptionMsg, W - 2 * M);
                doc.text(contactReceptionLines, M, y);
                y += 4 * contactReceptionLines.length + 2;
                doc.setFont('helvetica', 'normal'); doc.setTextColor(50);
                const fournisseur = bdc.fournisseur || {};
                const hasAddr = fournisseur.adresse || fournisseur.ville;
                const supplierBoxH = hasAddr ? 28 : 20;
                doc.setFillColor(250, 247, 249); doc.setDrawColor(139, 34, 82); doc.setLineWidth(0.4);
                doc.roundedRect(M, y, W - 2 * M, supplierBoxH, 2, 2, 'FD');
                doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(139, 34, 82);
                doc.text('FOURNISSEUR', M + 3, y + 5);
                doc.setFontSize(10); doc.setTextColor(50);
                doc.text(fournisseur.nom || '', M + 38, y + 5);
                doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(80);
                let fLine = hasAddr ? y + 10 : y + 10;
                if (hasAddr) { doc.text([fournisseur.adresse, fournisseur.ville].filter(Boolean).join(' \u2014 '), M + 3, fLine); fLine += 5; }
                if (fournisseur.ice) doc.text('ICE : ' + fournisseur.ice, M + 3, fLine);
                if (fournisseur.tel) doc.text('T\u00e9l : ' + fournisseur.tel, M + 90, fLine);
                if (fournisseur.email) { fLine += 5; doc.text('Email : ' + fournisseur.email, M + 3, fLine); }
                y += supplierBoxH + 6;
                const cols = [M, M+8, M+78, M+98, M+118, M+138, M+158];
                const headers = ['#', 'Article', 'Qt\u00e9', 'PU (MAD)', 'TVA%', 'HT', 'TTC'];
                doc.setFillColor(139, 34, 82); doc.rect(M, y, W - 2 * M, 7, 'F');
                doc.setTextColor(255); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
                headers.forEach((h, i) => doc.text(h, cols[i] + 1, y + 5));
                y += 7;
                doc.setTextColor(50); doc.setFont('helvetica', 'normal');
                (bdc.items || []).forEach((it, i) => {
                    if (y > 260) { doc.addPage(); y = 15; }
                    if (i % 2 === 0) { doc.setFillColor(250, 250, 250); doc.rect(M, y, W - 2 * M, 6, 'F'); }
                    doc.setFontSize(8);
                    doc.text(String(i + 1), cols[0] + 1, y + 4);
                    doc.text((it.article || '').substring(0, 40), cols[1] + 1, y + 4);
                    doc.text(String(it.quantite || 0) + ' ' + (it.unite || ''), cols[2] + 1, y + 4);
                    doc.text((parseFloat(it.prix_unitaire) || 0).toFixed(2), cols[3] + 1, y + 4);
                    doc.text((it.taux_tva || 0) + '%', cols[4] + 1, y + 4);
                    doc.text((parseFloat(it.montant_ht) || 0).toFixed(2), cols[5] + 1, y + 4);
                    doc.text((parseFloat(it.montant_ttc) || 0).toFixed(2), cols[6] + 1, y + 4);
                    y += 6;
                });
                y += 4; doc.setDrawColor(200); doc.line(M + 120, y, W - M, y); y += 6;
                doc.setFontSize(9); doc.setFont('helvetica', 'normal');
                doc.text('Total HT :', M + 120, y); doc.text((bdc.total_ht || 0).toFixed(2) + ' MAD', W - M, y, { align: 'right' }); y += 5;
                doc.text('TVA :', M + 120, y); doc.text((bdc.total_tva || 0).toFixed(2) + ' MAD', W - M, y, { align: 'right' }); y += 5;
                doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(139, 34, 82);
                doc.text('Total TTC :', M + 110, y); doc.text((bdc.total_ttc || 0).toFixed(2) + ' MAD', W - M, y, { align: 'right' }); y += 15;
                if (y > 230) { doc.addPage(); y = 20; }
                const sigY = y, sigW = 55;
                doc.setTextColor(100); doc.setFontSize(8); doc.setFont('helvetica', 'bold');
                doc.rect(M, sigY, sigW, 35); doc.text('RESPONSABLE ACHATS', M + sigW/2, sigY + 5, { align: 'center' });
                // Achats: nom + signature cursive si BDC soumis
                if (bdc.status !== 'brouillon') {
                    doc.setFont('helvetica', 'bolditalic'); doc.setFontSize(14); doc.setTextColor(30, 60, 120);
                    doc.text('Achraf Inak', M + sigW/2, sigY + 18, { align: 'center' });
                    doc.setFontSize(7); doc.setTextColor(100); doc.setFont('helvetica', 'normal');
                    doc.text('Responsable Achats', M + sigW/2, sigY + 24, { align: 'center' });
                    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(100);
                }
                doc.rect(M + 62, sigY, sigW, 35); doc.text('CHEF DE FERME \u2014 ' + (bdc.ferme || ''), M + 62 + sigW/2, sigY + 5, { align: 'center' });
                if (bdc.validated_by_chef) {
                    doc.setFont('helvetica', 'bolditalic'); doc.setFontSize(12); doc.setTextColor(45, 139, 78);
                    doc.text(bdc.validated_by_chef.name || 'Chef', M + 62 + sigW/2, sigY + 16, { align: 'center' });
                    doc.setFontSize(7); doc.setTextColor(100); doc.setFont('helvetica', 'normal');
                    doc.text('Sign\u00e9 le ' + new Date(bdc.validated_by_chef.at).toLocaleDateString('fr-FR'), M + 62 + sigW/2, sigY + 22, { align: 'center' });
                }
                doc.rect(M + 124, sigY, sigW, 35); doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(100);
                doc.text('DIRECTEUR G\u00c9N\u00c9RAL', M + 124 + sigW/2, sigY + 5, { align: 'center' });
                if (bdc.validated_by_dg) {
                    if (signatureDgBase64) {
                        try { doc.addImage(signatureDgBase64, 'PNG', M + 127, sigY + 8, 45, 16); } catch(e) {}
                    } else {
                        doc.setFont('helvetica', 'bolditalic'); doc.setFontSize(12); doc.setTextColor(139, 34, 82);
                        doc.text(bdc.validated_by_dg.name || 'DG', M + 124 + sigW/2, sigY + 18, { align: 'center' });
                    }
                    doc.setFontSize(7); doc.setTextColor(100); doc.setFont('helvetica', 'normal');
                    doc.text((bdc.validated_by_dg.name || 'DG') + ' \u2014 Sign\u00e9 le ' + new Date(bdc.validated_by_dg.at).toLocaleDateString('fr-FR'), M + 124 + sigW/2, sigY + 28, { align: 'center' });
                    // Cachet société superposé sur la signature DG avec transparence
                    if (cachetBase64) {
                        try { const gs = new doc.GState({ opacity: 0.35 }); doc.saveGraphicsState(); doc.setGState(gs); doc.addImage(cachetBase64, 'PNG', M + 138, sigY + 3, 28, 28); doc.restoreGraphicsState(); } catch(e) {}
                    }
                }
                doc.setFontSize(7); doc.setTextColor(150); doc.setFont('helvetica', 'normal');
                doc.text('Document g\u00e9n\u00e9r\u00e9 le ' + new Date().toLocaleString('fr-FR') + ' \u2014 ' + societe.footer, W / 2, 290, { align: 'center' });
                return doc;
            };

            const handleDownloadPdf = (bdc) => { const doc = generatePdfBdc(bdc); doc.save('BDC_' + bdc.numero + '.pdf'); };

            const handleShareWhatsApp = async (bdc) => {
                const doc = generatePdfBdc(bdc);
                const pdfBlob = doc.output('blob');
                const fileName = 'BDC_' + bdc.numero + '.pdf';
                if (navigator.share && navigator.canShare) {
                    const file = new File([pdfBlob], fileName, { type: 'application/pdf' });
                    if (navigator.canShare({ files: [file] })) {
                        try { await navigator.share({ title: 'BDC ' + bdc.numero, text: 'Bon de Commande ' + bdc.numero + ' — ' + (bdc.fournisseur?.nom || '') + ' — ' + (bdc.total_ttc||0).toFixed(2) + ' MAD', files: [file] }); return; } catch(e) {}
                    }
                }
                doc.save(fileName);
                const msg = encodeURIComponent('Bon de Commande ' + bdc.numero + '\nFournisseur: ' + (bdc.fournisseur?.nom||'') + '\nMontant TTC: ' + (bdc.total_ttc||0).toFixed(2) + ' MAD\n\n' + String.fromCodePoint(0x1F4CE) + ' PDF joint séparément');
                window.open('https://wa.me/?text=' + msg, '_blank');
            };

            const handleSendEmail = (bdc) => {
                setEmailForm({ to: bdc.fournisseur?.email || '', subject: 'Bon de Commande ' + bdc.numero + ' \u2014 Berry Good Farms', message: 'Bonjour,\n\nVeuillez trouver ci-joint notre bon de commande ' + bdc.numero + '.\n\nCordialement,\nBerry Good Farms' });
                setShowEmailForm(true);
            };

            const submitEmail = () => {
                if (!emailForm.to) { alert('Email destinataire requis'); return; }
                setSendingEmail(true);
                const bdc = bdcDetail.bdc;
                const doc = generatePdfBdc(bdc);
                const pdfBase64 = doc.output('datauristring').split(',')[1];
                fetch('/api/stock?action=send-bdc-email', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bdc_id: bdc.id, to: emailForm.to, subject: emailForm.subject, message: emailForm.message, pdf_base64: pdfBase64, pdf_filename: 'BDC_' + bdc.numero + '.pdf', sent_by: { uid: currentProfile, name: profileData?.name || currentProfile } })
                }).then(r => r.json()).then(j => {
                    if (j.success) { alert('Email envoy\u00e9 avec succ\u00e8s \u00e0 ' + emailForm.to); setShowEmailForm(false); openDetail(bdc.id); loadBdc(); }
                    else alert('Erreur envoi: ' + (j.error || 'Echec'));
                }).catch(() => alert('Erreur r\u00e9seau')).finally(() => setSendingEmail(false));
            };

            const totals = calcTotal();
            if (loading) return React.createElement('div', {className:'fade-in',style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));

            const searchQ = searchQuery.trim().toLowerCase();
            const filteredBdcList = !searchQ ? bdcList : bdcList.filter(b =>
                (b.fournisseur?.nom || '').toLowerCase().includes(searchQ) ||
                (b.items || []).some(it => (it.article || '').toLowerCase().includes(searchQ))
            );

            return (
                <div className="fade-in">
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
                        <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                            {['', 'brouillon', 'en_attente_chef', 'en_attente_dg', 'valide_dg', 'envoye', 'rejete'].map(s => (
                                <button key={s} className={`chip c-berry ${filterStatus === s ? 'active' : ''}`} onClick={() => setFilterStatus(s)}>
                                    {s ? statusLabels[s] || s : 'Tous'}
                                </button>
                            ))}
                            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Rechercher par fournisseur ou article…"
                                style={{padding:'8px 12px', borderRadius:8, border:'1px solid var(--gray-200)', fontSize:13, minWidth:240}} />
                        </div>
                        <button data-tour="btn-new-bdc" onClick={() => { setForm({ supplier_id: '', purchase_request_id: '', fournisseur: { nom: '', ice: '', adresse: '', ville: '', tel: '', email: '' }, ferme: 'F1', date_livraison_prevue: '', code_analytique: '', mode_paiement: 'comptant_virement', items: [{ ...emptyItem }] }); setShowForm(true); }}
                            style={{background:'var(--berry)',color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',cursor:'pointer',fontWeight:600,fontSize:13}}>
                            <i className="fa-solid fa-plus" style={{marginRight:6}}></i>Nouveau BDC
                        </button>
                    </div>

                    <div className="table-responsive"><table className="data-table">
                        <thead><tr><th>N°</th><th>Date</th><th>Fournisseur</th><th>Ferme</th><th>Articles</th><th>Total TTC</th><th>Statut</th><th>Livraison</th><th>Scan</th><th></th></tr></thead>
                        <tbody>
                            {filteredBdcList.map((b) => (
                                <tr key={b.id} onClick={() => openDetail(b.id)} style={{cursor:'pointer'}}>
                                    <td style={{fontWeight:700,color:'var(--berry)',fontSize:12}}>{b.numero}</td>
                                    <td style={{fontSize:12}}>{b.created_at ? new Date(b.created_at).toLocaleDateString('fr-FR') : '—'}</td>
                                    <td style={{fontWeight:600}}>{b.fournisseur?.nom || '—'}</td>
                                    <td><span className="status-badge" style={{background: b.ferme==='F1' ? 'rgba(139,34,82,0.1)' : b.ferme==='F5' ? 'rgba(45,139,78,0.1)' : 'rgba(212,168,71,0.1)', color: b.ferme==='F1' ? 'var(--berry)' : b.ferme==='F5' ? 'var(--green)' : 'var(--gold)', fontSize:10}}>{b.ferme}</span></td>
                                    <td style={{textAlign:'center'}}>{b.items?.length || 0}</td>
                                    <td style={{fontWeight:700}}>{(b.total_ttc || 0).toLocaleString('fr-FR', {minimumFractionDigits:2})} MAD</td>
                                    <td><span className={'status-badge ' + statusClass(b.status)}>{statusLabels[b.status] || b.status}</span></td>
                                    <td><span className={'status-badge ' + (b.delivery_status === 'complet' ? 'valide' : b.delivery_status === 'partiel' ? 'en-attente' : 'brouillon')} style={{fontSize:10}}>{b.delivery_status === 'complet' ? 'Livré' : b.delivery_status === 'partiel' ? 'Partiel' : 'Non livré'}</span></td>
                                    <td onClick={e => e.stopPropagation()}>{window.ScanAttachmentButton ? <window.ScanAttachmentButton entityType="purchase_orders" entityId={b.id} scanUrl={b.scan_url} scanPath={b.scan_path} uploadedBy={{ profileId: currentProfile, name: profileData?.name || currentProfile }} onUploaded={() => loadBdc()} compact /> : null}</td>
                                    <td onClick={e => e.stopPropagation()} style={{whiteSpace:'nowrap'}}>
                                        <div style={{display:'flex',gap:12,alignItems:'center'}}>
                                        {(b.status === 'brouillon' || b.status === 'rejete') && <button onClick={() => handleSubmit(b.id)} title={b.status === 'rejete' ? 'Resoumettre' : 'Soumettre'} style={{background:'none',border:'none',cursor:'pointer',color:'var(--blue)',fontSize:13}}><i className="fa-solid fa-paper-plane"></i></button>}
                                        {(b.status === 'brouillon' || currentProfile === 'achats' || currentProfile === 'admin') && <button onClick={() => handleDeleteBdc(b.id, b.status)} title={b.status === 'brouillon' ? 'Supprimer' : 'Supprimer (BDC validé)'} style={{background:'none',border:'none',cursor:'pointer',color:'#e74c3c',fontSize:13}}><i className="fa-solid fa-trash"></i></button>}
                                        {currentProfile === 'achats' && ((isModeVirement(b.mode_paiement) && b.status === 'virement_signe') || (!isModeVirement(b.mode_paiement) && b.status === 'valide_dg')) && <button onClick={() => handleSend(b.id)} title="Envoyer" style={{background:'none',border:'none',cursor:'pointer',color:'var(--green)',fontSize:13}}><i className="fa-solid fa-truck"></i></button>}
                                        <button onClick={() => startDuplicate(b)} title="Dupliquer" style={{background:'none',border:'none',cursor:'pointer',color:'var(--berry)',fontSize:13}}><i className="fa-solid fa-copy"></i></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {filteredBdcList.length === 0 && <tr><td colSpan="10" style={{textAlign:'center',color:'var(--gray-400)',padding:40}}>{searchQ ? 'Aucun bon de commande ne correspond à la recherche.' : `Aucun bon de commande${filterStatus ? ' avec ce statut' : ''}.`}</td></tr>}
                        </tbody>
                    </table></div>

                    {/* Create BDC Modal */}
                    {showForm && (
                        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setShowForm(false); setJustCreated(null); } }}>
                            <div className="modal-content" style={{maxWidth:1100,width:'95vw',maxHeight:'90vh',overflowY:'auto'}}>
                                <h3 style={{marginTop:0,color:'var(--berry)'}}><i className="fa-solid fa-file-contract" style={{marginRight:8}}></i>Nouveau Bon de Commande</h3>
                                {/* DA liée — bandeau si disponible */}
                                <div style={{marginBottom:12}}>
                                    <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>
                                        <i className="fa-solid fa-file-pen" style={{marginRight:6,color:'#2563eb'}}></i>
                                        Demande d'Achat liée
                                        <span style={{fontWeight:400,color:'#94a3b8',marginLeft:6}}>(optionnel — pré-remplit les articles)</span>
                                    </label>
                                    <select value={form.purchase_request_id} onChange={e => selectDA(e.target.value)} style={{width:'100%',padding:'8px 12px',borderRadius:8,border: form.purchase_request_id ? '2px solid #2563eb' : '1px solid #ddd',fontSize:13,background: form.purchase_request_id ? '#eff6ff' : '#fff'}}>
                                        <option value="">-- Aucune DA liée --</option>
                                        {daApprouvees.map(da => <option key={da.id} value={da.id}>{da.numero} — {da.items?.length || 0} article(s){da.urgence && da.urgence !== 'normale' ? ' ⚠ ' + da.urgence : ''}</option>)}
                                    </select>
                                    {form.purchase_request_id && <div style={{fontSize:11,color:'#2563eb',marginTop:4}}><i className="fa-solid fa-circle-check" style={{marginRight:4}}></i>Articles pré-remplis depuis la DA</div>}
                                </div>
                                <div data-tour="bdc-form-supplier" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16,opacity: justCreated ? 0.6 : 1}}>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Fournisseur *</label>
                                        <div style={{display:'flex',gap:6}}>
                                        <select disabled={!!justCreated} value={form.supplier_id} onChange={e => selectSupplier(e.target.value)} style={{flex:1,padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13,background: justCreated ? '#f3f4f6' : '#fff'}}>
                                            <option value="">-- Sélectionner --</option>
                                            {suppliers.map(s => <option key={s.id} value={s.id}>{s.nom}{s.ville ? ' ('+s.ville+')' : ''}</option>)}
                                        </select>
                                        <button disabled={!!justCreated} onClick={() => setShowCreateSupplier(true)} title="Créer un fournisseur" style={{padding:'8px 10px',borderRadius:8,border:'1px solid var(--berry)',background:'var(--berry-pale)',color:'var(--berry)',cursor: justCreated ? 'not-allowed' : 'pointer',fontSize:13,whiteSpace:'nowrap'}}><i className="fa-solid fa-plus" style={{marginRight:4}}></i>Nouveau</button>
                                        </div></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Ferme *</label>
                                        <select disabled={!!justCreated} value={form.ferme} onChange={e => setForm(f => ({...f, ferme: e.target.value, purchase_request_id: ''}))} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13,background: justCreated ? '#f3f4f6' : '#fff'}}>
                                            {FARMS.map(f => <option key={f} value={f}>{f}</option>)}
                                        </select>
                                        {form.ferme && window.BdcWorkflow && !window.BdcWorkflow.requiresChefValidation(form.ferme) && (
                                            <div style={{marginTop:6,padding:'6px 10px',background:'var(--gold-pale)',border:'1px solid var(--gold)',borderRadius:6,fontSize:11,color:'var(--gray-800)',display:'flex',alignItems:'center',gap:6}}>
                                                <i className="fa-solid fa-circle-info" style={{color:'var(--gold)'}}></i>
                                                <span>{form.ferme === 'Toutes' ? 'BDC mutualisé multi-fermes — envoyé directement au DG (pas de chef de ferme désigné)' : 'BDC envoyé directement au DG (pas de chef de ferme pour ' + form.ferme + ')'}</span>
                                            </div>
                                        )}
                                    </div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Date livraison prévue</label>
                                        <input disabled={!!justCreated} type="date" value={form.date_livraison_prevue} onChange={e => setForm({...form, date_livraison_prevue: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13,background: justCreated ? '#f3f4f6' : '#fff'}} /></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Code Analytique</label>
                                        <select disabled={!!justCreated} value={form.code_analytique} onChange={e => setForm({...form, code_analytique: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13,background: justCreated ? '#f3f4f6' : '#fff'}}>
                                            <option value="">-- Sélectionner --</option>
                                            {codesAnalytiques.map(c => <option key={c.id} value={c.code}>{c.code} — {c.libelle}</option>)}
                                        </select></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Type de paiement</label>
                                        <div style={{display:'flex',gap:12,marginTop:4,flexWrap:'wrap'}}>
                                            {[{v:'comptant',l:'Comptant',icon:'fa-money-bill-wave'},{v:'facilite',l:'Facilité',icon:'fa-calendar-days'}].map(opt => {
                                                const active = (opt.v === 'comptant' && isModeComptant(form.mode_paiement)) || (opt.v === 'facilite' && isModeFacilite(form.mode_paiement));
                                                return (
                                                <label key={opt.v} style={{display:'flex',alignItems:'center',gap:6,cursor: justCreated ? 'not-allowed' : 'pointer',padding:'6px 12px',borderRadius:8,border: active ? '2px solid var(--berry)' : '1px solid #ddd',background: active ? 'var(--berry-pale)' : '#fff',fontSize:12,fontWeight:600}}>
                                                    <input disabled={!!justCreated} type="radio" name="paiement_type" value={opt.v} checked={active} onChange={() => setForm({...form, mode_paiement: opt.v === 'comptant' ? 'comptant_virement' : 'facilite'})} style={{display:'none'}} />
                                                    <i className={'fa-solid '+opt.icon} style={{color: active ? 'var(--berry)' : '#888'}}></i>{opt.l}
                                                </label>
                                                );
                                            })}
                                        </div>
                                        {isModeComptant(form.mode_paiement) && (
                                            <div style={{display:'flex',gap:12,marginTop:8,flexWrap:'wrap'}}>
                                                {[{v:'comptant_virement',l:'Virement bancaire',icon:'fa-building-columns'},{v:'comptant_especes',l:'Espèces',icon:'fa-cash-register'}].map(opt => (
                                                    <label key={opt.v} style={{display:'flex',alignItems:'center',gap:6,cursor: justCreated ? 'not-allowed' : 'pointer',padding:'5px 10px',borderRadius:8,border: form.mode_paiement===opt.v ? '2px solid var(--berry)' : '1px solid #ddd',background: form.mode_paiement===opt.v ? 'var(--berry-pale)' : '#fff',fontSize:11,fontWeight:600}}>
                                                        <input disabled={!!justCreated} type="radio" name="mode_paiement_method" value={opt.v} checked={form.mode_paiement===opt.v} onChange={e => setForm({...form, mode_paiement: e.target.value})} style={{display:'none'}} />
                                                        <i className={'fa-solid '+opt.icon} style={{color: form.mode_paiement===opt.v ? 'var(--berry)' : '#888'}}></i>{opt.l}
                                                    </label>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div data-tour="bdc-form-items" style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8,opacity: justCreated ? 0.6 : 1}}>
                                    <h4 style={{margin:0}}>Articles</h4>
                                    {canCreateArticle && <button disabled={!!justCreated} onClick={() => openCreateArticle(null)} style={{padding:'4px 10px',borderRadius:6,border:'1px solid var(--berry)',background:'var(--berry-pale)',color:'var(--berry)',cursor: justCreated ? 'not-allowed' : 'pointer',fontSize:11,fontWeight:600}}><i className="fa-solid fa-plus" style={{marginRight:4}}></i>Nouvel article</button>}
                                </div>
                                <div style={{overflowX:'auto',opacity: justCreated ? 0.6 : 1}}><table className="data-table" style={{fontSize:12}}>
                                    <thead><tr><th>Article</th><th>Catégorie</th><th>Qté</th><th>Unité</th><th>PU (MAD)</th><th>TVA%</th><th>Mt HT</th><th></th></tr></thead>
                                    <tbody>
                                        {form.items.map((it, idx) => { const mht = (parseFloat(it.quantite)||0) * (parseFloat(it.prix_unitaire)||0); return (
                                            <tr key={idx}>
                                                <td>
                                                    <input disabled={!!justCreated} value={it.article} onChange={e => { const val = e.target.value; updateItem(idx,'article',val); const vl = val.toLowerCase().trim(); const found = catalogueArticles.find(a => a.nom.toLowerCase()===vl) || (() => { const matches = catalogueArticles.filter(a => a.nom.toLowerCase().includes(vl)); return matches.length === 1 ? matches[0] : null; })(); if(found){ updateItem(idx,'categorie',found.categorie||'autre'); updateItem(idx,'unite',(found.unite||'KG').toLowerCase()); if(found.prix_ref) updateItem(idx,'prix_unitaire',String(found.prix_ref)); if(found.taux_tva != null && found.taux_tva !== '') updateItem(idx,'taux_tva',parseFloat(found.taux_tva)); } }} placeholder="Nom article" list={'bdc-articles-'+idx} style={{width:'100%',minWidth:180,padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12,background: justCreated ? '#f3f4f6' : '#fff'}} />
                                                    <datalist id={'bdc-articles-'+idx}>{catalogueArticles.map(a => <option key={a.id} value={a.nom} />)}</datalist>
                                                    {canCreateArticle && (() => { const v = (it.article || '').trim(); if (!v || catalogueArticles.some(a => a.nom.toLowerCase() === v.toLowerCase())) return null; return (
                                                        <button disabled={!!justCreated} type="button" onClick={() => openCreateArticle(idx, v)} title="Créer cet article au catalogue" style={{marginTop:3,padding:'2px 6px',borderRadius:5,border:'1px dashed var(--berry)',background:'var(--berry-pale)',color:'var(--berry)',cursor: justCreated ? 'not-allowed' : 'pointer',fontSize:10,fontWeight:600,whiteSpace:'nowrap'}}>
                                                            <i className="fa-solid fa-plus" style={{marginRight:3}}></i>Créer « {v.length > 18 ? v.slice(0,18)+'…' : v} »
                                                        </button>
                                                    ); })()}
                                                </td>
                                                <td><select disabled={!!justCreated} value={it.categorie} onChange={e => updateItem(idx, 'categorie', e.target.value)} style={{padding:'4px',borderRadius:6,border:'1px solid #ddd',fontSize:11, background: justCreated ? '#f3f4f6' : (() => { const f = catalogueArticles.find(a => a.nom.toLowerCase()===it.article.toLowerCase()); return f && f.categorie && f.categorie.toLowerCase()===it.categorie ? '#f0faf4' : '#fff'; })() }}>{(() => { const base = ['engrais','phyto','emballage','materiel','autre']; const extra = catalogueArticles.map(a => (a.categorie||'').toLowerCase()).filter(Boolean); const all = [...new Set([...base, ...extra])]; return all.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</option>); })()}</select></td>
                                                <td><input disabled={!!justCreated} type="number" value={it.quantite} onChange={e => updateItem(idx, 'quantite', e.target.value)} style={{width:60,padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12,textAlign:'right',background: justCreated ? '#f3f4f6' : '#fff'}} /></td>
                                                <td><select disabled={!!justCreated} value={it.unite} onChange={e => updateItem(idx, 'unite', e.target.value)} style={{padding:'4px',borderRadius:6,border:'1px solid #ddd',fontSize:11,background: justCreated ? '#f3f4f6' : '#fff'}}><option value="kg">kg</option><option value="L">L</option><option value="unité">unité</option><option value="carton">carton</option><option value="sac">sac</option><option value="bidon">bidon</option></select></td>
                                                <td><input disabled={!!justCreated} type="number" value={it.prix_unitaire} onChange={e => updateItem(idx, 'prix_unitaire', e.target.value)} style={{width:80,padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12,textAlign:'right',background: justCreated ? '#f3f4f6' : '#fff'}} /></td>
                                                <td><select disabled={!!justCreated} value={it.taux_tva} onChange={e => updateItem(idx, 'taux_tva', parseFloat(e.target.value))} style={{padding:'4px',borderRadius:6,border:'1px solid #ddd',fontSize:11,background: justCreated ? '#f3f4f6' : '#fff'}}>{TVA_RATES.map(r => <option key={r} value={r}>{r}%</option>)}</select></td>
                                                <td style={{fontWeight:600,textAlign:'right'}}>{mht.toFixed(2)}</td>
                                                <td><button disabled={!!justCreated} onClick={() => removeItem(idx)} style={{background:'none',border:'none',cursor: justCreated ? 'not-allowed' : 'pointer',color:'var(--red)',fontSize:13}}><i className="fa-solid fa-trash"></i></button></td>
                                            </tr>); })}
                                    </tbody>
                                </table></div>
                                <button disabled={!!justCreated} onClick={addItem} style={{marginTop:8,background:'none',border:'1px dashed #ccc',borderRadius:8,padding:'6px 14px',cursor: justCreated ? 'not-allowed' : 'pointer',fontSize:12,color:'var(--blue)',opacity: justCreated ? 0.6 : 1}}><i className="fa-solid fa-plus" style={{marginRight:4}}></i>Ajouter une ligne</button>
                                <div style={{marginTop:16,textAlign:'right',fontSize:14}}>
                                    <div>Total HT: <strong>{totals.ht.toLocaleString('fr-FR', {minimumFractionDigits:2})} MAD</strong></div>
                                    <div>TVA: <strong>{totals.tva.toLocaleString('fr-FR', {minimumFractionDigits:2})} MAD</strong></div>
                                    <div style={{fontSize:18,color:'var(--berry)',fontWeight:700,marginTop:4}}>Total TTC: {totals.ttc.toLocaleString('fr-FR', {minimumFractionDigits:2})} MAD</div>
                                </div>
                                {justCreated ? (
                                    <div style={{background:'#f0faf4', border:'1px solid #a8d5b5', borderRadius:10, padding:'14px 18px', marginTop:16}}>
                                        <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:12}}>
                                            <i className="fa-solid fa-circle-check" style={{color:'#27ae60', fontSize:18}}></i>
                                            <span style={{fontWeight:700, color:'#27ae60', fontSize:14}}>{justCreated.numero} créé avec succès</span>
                                        </div>
                                        <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
                                            <button onClick={() => { setShowForm(false); setJustCreated(null); }} style={{padding:'8px 16px', borderRadius:8, border:'1px solid #ddd', background:'#fff', cursor:'pointer', fontSize:13}}>Fermer</button>
                                            <button onClick={() => handleSubmitDirect(justCreated.id)} style={{padding:'8px 20px', borderRadius:8, border:'none', background:'var(--berry)', color:'#fff', cursor:'pointer', fontWeight:700, fontSize:13}}>
                                                <i className="fa-solid fa-paper-plane" style={{marginRight:6}}></i>Soumettre pour validation
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div data-tour="bdc-form-submit" style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
                                        <button onClick={() => setShowForm(false)} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                        <button onClick={handleCreate} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}>Créer le BDC</button>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* BDC Detail Modal */}
                    {selectedBdc && bdcDetail && (
                        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setSelectedBdc(null); setBdcDetail(null); setEditMode(null); } }}>
                            <div className="modal-content" style={{maxWidth:750,maxHeight:'90vh',overflowY:'auto'}}>
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                                    <h3 style={{margin:0,color:'var(--berry)'}}>{bdcDetail.bdc.numero}</h3>
                                    <div style={{display:'flex',gap:8}}>
                                        {(bdcDetail.bdc.status === 'brouillon' || bdcDetail.bdc.status === 'rejete') && !editMode && (
                                            <button onClick={() => startEdit(bdcDetail.bdc)} style={{background:'var(--berry-pale)',border:'1.5px solid var(--berry)',borderRadius:8,padding:'6px 12px',cursor:'pointer',fontSize:12,color:'var(--berry)',fontWeight:600}}><i className="fa-solid fa-pen" style={{marginRight:4}}></i>Modifier</button>
                                        )}
                                        <button onClick={() => startDuplicate(bdcDetail.bdc)} style={{background:'none',border:'1px solid #ddd',borderRadius:8,padding:'6px 12px',cursor:'pointer',fontSize:12}}><i className="fa-solid fa-copy" style={{marginRight:4}}></i>Dupliquer</button>
                                        {['en_attente_chef','en_attente_dg','envoye','virement_lance'].includes(bdcDetail.bdc.status) && currentProfile === 'achats' && (
                                            <button onClick={() => handleRemindBdc(bdcDetail.bdc.id, bdcDetail.bdc.status)} style={{background:'#f39c12',border:'none',borderRadius:8,padding:'6px 12px',cursor:'pointer',fontSize:12,color:'#fff',fontWeight:600}} title="Envoyer un rappel WhatsApp à la personne qui bloque le BDC">
                                                <i className="fa-solid fa-bell" style={{marginRight:4}}></i>Relancer
                                            </button>
                                        )}
                                        {(['valide_dg','envoye','virement_lance','virement_signe'].includes(bdcDetail.bdc.status)) && <button onClick={() => printBdc(bdcDetail.bdc)} style={{background:'none',border:'1px solid #ddd',borderRadius:8,padding:'6px 12px',cursor:'pointer',fontSize:12}}><i className="fa-solid fa-print" style={{marginRight:4}}></i>Imprimer</button>}
                                        {(['valide_dg','envoye','virement_lance','virement_signe'].includes(bdcDetail.bdc.status)) && <button onClick={() => handleDownloadPdf(bdcDetail.bdc)} style={{background:'#e74c3c',border:'none',borderRadius:8,padding:'6px 12px',cursor:'pointer',fontSize:12,color:'#fff',fontWeight:600}}><i className="fa-solid fa-file-pdf" style={{marginRight:4}}></i>PDF</button>}
                                        {(['valide_dg','envoye','virement_lance','virement_signe'].includes(bdcDetail.bdc.status)) && <button onClick={() => handleSendEmail(bdcDetail.bdc)} style={{background:'#2980b9',border:'none',borderRadius:8,padding:'6px 12px',cursor:'pointer',fontSize:12,color:'#fff',fontWeight:600}}><i className="fa-solid fa-envelope" style={{marginRight:4}}></i>Email</button>}
                                        {(['valide_dg','envoye','virement_lance','virement_signe'].includes(bdcDetail.bdc.status)) && <button onClick={() => handleShareWhatsApp(bdcDetail.bdc)} style={{background:'#25D366',border:'none',borderRadius:8,padding:'6px 12px',cursor:'pointer',fontSize:12,color:'#fff',fontWeight:600}}><i className="fa-brands fa-whatsapp" style={{marginRight:4}}></i>WhatsApp</button>}
                                        {(['virement_signe','envoye'].includes(bdcDetail.bdc.status)) && ['finance','dg','admin'].includes(currentProfile) && !bdcDetail.bdc.avis_virement_url && (
                                            <button onClick={() => handleUploadAvisVirement(bdcDetail.bdc.id)} style={{background:'#7c3aed',border:'none',borderRadius:8,padding:'6px 12px',cursor:'pointer',fontSize:12,color:'#fff',fontWeight:600}} title="Joindre le PDF de l'avis de virement exécuté">
                                                <i className="fa-solid fa-paperclip" style={{marginRight:4}}></i>Joindre avis virement
                                            </button>
                                        )}
                                        {bdcDetail.bdc.avis_virement_url && (
                                            <a href={bdcDetail.bdc.avis_virement_url} target="_blank" rel="noopener noreferrer" style={{background:'#22c55e',border:'none',borderRadius:8,padding:'6px 12px',cursor:'pointer',fontSize:12,color:'#fff',fontWeight:600,textDecoration:'none',display:'inline-flex',alignItems:'center'}} title="Voir l'avis de virement joint">
                                                <i className="fa-solid fa-file-circle-check" style={{marginRight:4}}></i>Avis virement
                                            </a>
                                        )}
                                        <button onClick={() => { setSelectedBdc(null); setBdcDetail(null); setEditMode(null); }} style={{background:'none',border:'none',cursor:'pointer',fontSize:18,color:'#999'}}><i className="fa-solid fa-xmark"></i></button>
                                    </div>
                                </div>

                                {/* EDIT MODE */}
                                {editMode && editForm ? (() => {
                                    const et = editCalcTotal();
                                    return (
                                        <div style={{marginTop:16}}>
                                            <div style={{background:'rgba(243,156,18,0.08)',border:'1px solid rgba(243,156,18,0.3)',borderRadius:8,padding:'8px 14px',marginBottom:12,fontSize:12,color:'#7d6608'}}>
                                                <i className="fa-solid fa-pen-to-square" style={{marginRight:6}}></i>Mode édition — complétez le fournisseur, les prix et les modalités de paiement
                                            </div>
                                            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
                                                <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Fournisseur *</label>
                                                    <div style={{display:'flex',gap:6}}>
                                                    <select value={editForm.supplier_id} onChange={e => editSelectSupplier(e.target.value)} style={{flex:1,padding:'8px 12px',borderRadius:8,border: !editForm.fournisseur.nom || editForm.fournisseur.nom === 'À définir' ? '2px solid #e74c3c' : '1px solid #ddd',fontSize:13}}>
                                                        <option value="">-- Sélectionner --</option>
                                                        {suppliers.map(s => <option key={s.id} value={s.id}>{s.nom}{s.ville ? ' ('+s.ville+')' : ''}</option>)}
                                                    </select>
                                                    <button onClick={() => setShowCreateSupplier(true)} title="Créer un fournisseur" style={{padding:'8px 10px',borderRadius:8,border:'1px solid var(--berry)',background:'var(--berry-pale)',color:'var(--berry)',cursor:'pointer',fontSize:13,whiteSpace:'nowrap'}}><i className="fa-solid fa-plus" style={{marginRight:4}}></i>Nouveau</button>
                                                    </div>
                                                    {(!editForm.fournisseur.nom || editForm.fournisseur.nom === 'À définir') && <div style={{fontSize:11,color:'#e74c3c',marginTop:2}}><i className="fa-solid fa-triangle-exclamation" style={{marginRight:4}}></i>Fournisseur requis</div>}
                                                </div>
                                                <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Ferme</label>
                                                    <select value={editForm.ferme} onChange={e => setEditForm({...editForm, ferme: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                                        {FARMS.map(f => <option key={f} value={f}>{f}</option>)}
                                                    </select></div>
                                                <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Date livraison prévue</label>
                                                    <input type="date" value={editForm.date_livraison_prevue} onChange={e => setEditForm({...editForm, date_livraison_prevue: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                                <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Code Analytique</label>
                                                    <select value={editForm.code_analytique} onChange={e => setEditForm({...editForm, code_analytique: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                                        <option value="">-- Sélectionner --</option>
                                                        {codesAnalytiques.map(c => <option key={c.id} value={c.code}>{c.code} — {c.libelle}</option>)}
                                                    </select></div>
                                                <div style={{gridColumn:'1 / -1'}}><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Type de paiement</label>
                                                    <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                                                        {[{v:'comptant',l:'Comptant',icon:'fa-money-bill-wave'},{v:'facilite',l:'Facilité',icon:'fa-calendar-days'}].map(opt => {
                                                            const active = (opt.v === 'comptant' && isModeComptant(editForm.mode_paiement)) || (opt.v === 'facilite' && isModeFacilite(editForm.mode_paiement));
                                                            return (
                                                            <label key={opt.v} style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',padding:'6px 12px',borderRadius:8,border: active ? '2px solid var(--berry)' : '1px solid #ddd',background: active ? 'var(--berry-pale)' : '#fff',fontSize:12,fontWeight:600}}>
                                                                <input type="radio" name="edit_paiement_type" value={opt.v} checked={active} onChange={() => setEditForm({...editForm, mode_paiement: opt.v === 'comptant' ? 'comptant_virement' : 'facilite'})} style={{display:'none'}} />
                                                                <i className={'fa-solid '+opt.icon} style={{color: active ? 'var(--berry)' : '#888'}}></i>{opt.l}
                                                            </label>
                                                            );
                                                        })}
                                                    </div>
                                                    {isModeComptant(editForm.mode_paiement) && (
                                                        <div style={{display:'flex',gap:10,flexWrap:'wrap',marginTop:8}}>
                                                            {[{v:'comptant_virement',l:'Virement bancaire',icon:'fa-building-columns'},{v:'comptant_especes',l:'Espèces',icon:'fa-cash-register'}].map(opt => (
                                                                <label key={opt.v} style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',padding:'5px 10px',borderRadius:8,border: editForm.mode_paiement===opt.v ? '2px solid var(--berry)' : '1px solid #ddd',background: editForm.mode_paiement===opt.v ? 'var(--berry-pale)' : '#fff',fontSize:11,fontWeight:600}}>
                                                                    <input type="radio" name="edit_mode_paiement_method" value={opt.v} checked={editForm.mode_paiement===opt.v} onChange={e => setEditForm({...editForm, mode_paiement: e.target.value})} style={{display:'none'}} />
                                                                    <i className={'fa-solid '+opt.icon} style={{color: editForm.mode_paiement===opt.v ? 'var(--berry)' : '#888'}}></i>{opt.l}
                                                                </label>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                                                <h4 style={{margin:0}}>Articles</h4>
                                                {canCreateArticle && <button onClick={() => openCreateArticle(null)} style={{padding:'4px 10px',borderRadius:6,border:'1px solid var(--berry)',background:'var(--berry-pale)',color:'var(--berry)',cursor:'pointer',fontSize:11,fontWeight:600}}><i className="fa-solid fa-plus" style={{marginRight:4}}></i>Nouvel article</button>}
                                            </div>
                                            <div style={{overflowX:'auto'}}><table className="data-table" style={{fontSize:12}}>
                                                <thead><tr><th>Article</th><th>Catégorie</th><th>Qté</th><th>Unité</th><th>PU (MAD)</th><th>TVA%</th><th>Mt HT</th><th></th></tr></thead>
                                                <tbody>
                                                    {editForm.items.map((it, idx) => { const mht = (parseFloat(it.quantite)||0) * (parseFloat(it.prix_unitaire)||0); return (
                                                        <tr key={idx}>
                                                            <td><input value={it.article} onChange={e => { const val = e.target.value; editUpdateItem(idx,'article',val); const found = catalogueArticles.find(a => a.nom.toLowerCase()===val.toLowerCase()); if(found){ editUpdateItem(idx,'categorie',found.categorie||'autre'); editUpdateItem(idx,'unite',(found.unite||'KG').toLowerCase()); if(found.prix_ref) editUpdateItem(idx,'prix_unitaire',String(found.prix_ref)); } }} placeholder="Nom article" list={'edit-articles-'+idx} style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} />
                                                                <datalist id={'edit-articles-'+idx}>{catalogueArticles.map(a => <option key={a.id} value={a.nom} />)}</datalist></td>
                                                            <td><select value={it.categorie} onChange={e => editUpdateItem(idx, 'categorie', e.target.value)} style={{padding:'4px',borderRadius:6,border:'1px solid #ddd',fontSize:11, background: (() => { const f = catalogueArticles.find(a => a.nom.toLowerCase()===it.article.toLowerCase()); return f && f.categorie && f.categorie.toLowerCase()===it.categorie ? '#f0faf4' : '#fff'; })() }}>{(() => { const base = ['engrais','phyto','emballage','materiel','autre']; const extra = catalogueArticles.map(a => (a.categorie||'').toLowerCase()).filter(Boolean); const all = [...new Set([...base, ...extra])]; return all.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</option>); })()}</select></td>
                                                            <td><input type="number" value={it.quantite} onChange={e => editUpdateItem(idx, 'quantite', e.target.value)} style={{width:60,padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12,textAlign:'right'}} /></td>
                                                            <td><select value={it.unite} onChange={e => editUpdateItem(idx, 'unite', e.target.value)} style={{padding:'4px',borderRadius:6,border:'1px solid #ddd',fontSize:11}}><option value="kg">kg</option><option value="L">L</option><option value="unité">unité</option><option value="carton">carton</option><option value="sac">sac</option><option value="bidon">bidon</option></select></td>
                                                            <td><input type="number" value={it.prix_unitaire} onChange={e => editUpdateItem(idx, 'prix_unitaire', e.target.value)} style={{width:80,padding:'4px 8px',borderRadius:6,border: !it.prix_unitaire ? '2px solid #f39c12' : '1px solid #ddd',fontSize:12,textAlign:'right'}} /></td>
                                                            <td><select value={it.taux_tva} onChange={e => editUpdateItem(idx, 'taux_tva', parseFloat(e.target.value))} style={{padding:'4px',borderRadius:6,border:'1px solid #ddd',fontSize:11}}>{TVA_RATES.map(r => <option key={r} value={r}>{r}%</option>)}</select></td>
                                                            <td style={{fontWeight:600,textAlign:'right'}}>{mht.toFixed(2)}</td>
                                                            <td><button onClick={() => { if (editForm.items.length > 1) setEditForm({...editForm, items: editForm.items.filter((_,i) => i !== idx)}); }} style={{background:'none',border:'none',cursor:'pointer',color:'var(--red)',fontSize:13}}><i className="fa-solid fa-trash"></i></button></td>
                                                        </tr>); })}
                                                </tbody>
                                            </table></div>
                                            <button onClick={() => setEditForm({...editForm, items: [...editForm.items, { ...emptyItem }]})} style={{marginTop:8,background:'none',border:'1px dashed #ccc',borderRadius:8,padding:'6px 14px',cursor:'pointer',fontSize:12,color:'var(--blue)'}}><i className="fa-solid fa-plus" style={{marginRight:4}}></i>Ajouter une ligne</button>
                                            <div style={{marginTop:16,textAlign:'right',fontSize:14}}>
                                                <div>Total HT: <strong>{et.ht.toLocaleString('fr-FR', {minimumFractionDigits:2})} MAD</strong></div>
                                                <div>TVA: <strong>{et.tva.toLocaleString('fr-FR', {minimumFractionDigits:2})} MAD</strong></div>
                                                <div style={{fontSize:18,color:'var(--berry)',fontWeight:700,marginTop:4}}>Total TTC: {et.ttc.toLocaleString('fr-FR', {minimumFractionDigits:2})} MAD</div>
                                            </div>
                                            <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
                                                <button onClick={() => { setEditMode(null); setEditForm(null); }} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                                <button onClick={handleUpdate} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}><i className="fa-solid fa-floppy-disk" style={{marginRight:6}}></i>Enregistrer</button>
                                            </div>
                                        </div>
                                    );
                                })() : (
                                    /* VIEW MODE */
                                    <React.Fragment>
                                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginTop:16}}>
                                    <div><div style={{fontSize:12,color:'var(--gray-400)'}}>Fournisseur</div><div style={{fontWeight:600}}>{bdcDetail.bdc.fournisseur?.nom}</div>{bdcDetail.bdc.fournisseur?.ice && <div style={{fontSize:11,color:'#999'}}>ICE: {bdcDetail.bdc.fournisseur.ice}</div>}</div>
                                    <div><div style={{fontSize:12,color:'var(--gray-400)'}}>Ferme</div><div style={{fontWeight:600}}>{bdcDetail.bdc.ferme}</div></div>
                                    <div><div style={{fontSize:12,color:'var(--gray-400)'}}>Statut</div><span className={'status-badge ' + statusClass(bdcDetail.bdc.status)}>{statusLabels[bdcDetail.bdc.status] || bdcDetail.bdc.status}</span></div>
                                    <div><div style={{fontSize:12,color:'var(--gray-400)'}}>Date livraison prévue</div><div style={{fontWeight:600}}>{bdcDetail.bdc.date_livraison_prevue || '—'}</div></div>
                                    <div><div style={{fontSize:12,color:'var(--gray-400)'}}>Modalités de paiement</div><div style={{fontWeight:600}}>{formatModePaiement(bdcDetail.bdc.mode_paiement)}</div></div>
                                    {bdcDetail.bdc.code_analytique && <div><div style={{fontSize:12,color:'var(--gray-400)'}}>Code Analytique</div><div style={{fontWeight:600,fontFamily:'monospace'}}>{bdcDetail.bdc.code_analytique}</div></div>}
                                </div>
                                {bdcDetail.bdc.fournisseur?.nom === 'À définir' && (
                                    <div style={{background:'rgba(243,156,18,0.08)',border:'1px solid rgba(243,156,18,0.3)',borderRadius:8,padding:'8px 14px',marginTop:12,fontSize:12,color:'#7d6608'}}>
                                        <i className="fa-solid fa-triangle-exclamation" style={{marginRight:6}}></i>
                                        Ce BDC a été généré depuis une DA — cliquez <strong>Modifier</strong> pour compléter le fournisseur et les prix avant de soumettre.
                                    </div>
                                )}
                                <h4 style={{marginTop:20,marginBottom:8}}>Articles</h4>
                                <table className="data-table" style={{fontSize:12}}>
                                    <thead><tr><th>Article</th><th>Qté</th><th>PU</th><th>TVA</th><th>HT</th><th>TTC</th></tr></thead>
                                    <tbody>{(bdcDetail.bdc.items || []).map((it, i) => (<tr key={i}><td style={{fontWeight:600}}>{it.article}</td><td>{it.quantite} {it.unite}</td><td style={{textAlign:'right'}}>{(parseFloat(it.prix_unitaire)||0).toFixed(2)}</td><td>{it.taux_tva}%</td><td style={{textAlign:'right',fontWeight:600}}>{(parseFloat(it.montant_ht)||0).toFixed(2)}</td><td style={{textAlign:'right',fontWeight:600}}>{(parseFloat(it.montant_ttc)||0).toFixed(2)}</td></tr>))}</tbody>
                                </table>
                                <div style={{textAlign:'right',marginTop:8}}>
                                    <div style={{fontSize:13}}>Total HT: <strong>{(bdcDetail.bdc.total_ht||0).toFixed(2)} MAD</strong></div>
                                    <div style={{fontSize:13}}>TVA: <strong>{(bdcDetail.bdc.total_tva||0).toFixed(2)} MAD</strong></div>
                                    <div style={{fontSize:16,color:'var(--berry)',fontWeight:700}}>Total TTC: {(bdcDetail.bdc.total_ttc||0).toFixed(2)} MAD</div>
                                </div>
                                <div style={{display:'flex',gap:8,marginTop:16,flexWrap:'wrap'}}>
                                    {(bdcDetail.bdc.status === 'brouillon' || bdcDetail.bdc.status === 'rejete') && <button onClick={() => startEdit(bdcDetail.bdc)} style={{padding:'8px 16px',borderRadius:8,border:'1.5px solid var(--berry)',background:'var(--berry-pale)',color:'var(--berry)',cursor:'pointer',fontWeight:600,fontSize:13}}><i className="fa-solid fa-pen" style={{marginRight:6}}></i>Modifier</button>}
                                    {(bdcDetail.bdc.status === 'brouillon' || bdcDetail.bdc.status === 'rejete') && <button onClick={() => handleSubmit(selectedBdc)} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--blue)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}><i className="fa-solid fa-paper-plane" style={{marginRight:6}}></i>{bdcDetail.bdc.status === 'rejete' ? 'Resoumettre pour validation' : 'Soumettre pour validation'}</button>}
                                    {(bdcDetail.bdc.status === 'brouillon' || currentProfile === 'achats' || currentProfile === 'admin') && <button onClick={() => handleDeleteBdc(selectedBdc, bdcDetail.bdc.status)} style={{padding:'8px 16px',borderRadius:8,border:'1.5px solid #e74c3c',background:'rgba(231,76,60,0.08)',color:'#e74c3c',cursor:'pointer',fontWeight:600,fontSize:13}}><i className="fa-solid fa-trash" style={{marginRight:6}}></i>Supprimer</button>}
                                    {currentProfile === 'achats' && ((isModeVirement(bdcDetail.bdc.mode_paiement) && bdcDetail.bdc.status === 'virement_signe') || (!isModeVirement(bdcDetail.bdc.mode_paiement) && bdcDetail.bdc.status === 'valide_dg')) && <button onClick={() => handleSend(selectedBdc)} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--green)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}><i className="fa-solid fa-truck" style={{marginRight:6}}></i>Marquer envoyé</button>}
                                    {['valide_dg','envoye','virement_lance','virement_signe'].includes(bdcDetail.bdc.status) && !bdcDetail.bdc.pending_change_request && (
                                        <React.Fragment>
                                            <button onClick={() => { setChangeRequestModal({ type: 'modification' }); setChangeMotif(''); }} style={{padding:'8px 16px',borderRadius:8,border:'1.5px solid #e67e22',background:'rgba(230,126,34,0.08)',color:'#e67e22',cursor:'pointer',fontWeight:600,fontSize:13}}><i className="fa-solid fa-pen-to-square" style={{marginRight:6}}></i>Demander modification</button>
                                            <button onClick={() => { setChangeRequestModal({ type: 'annulation' }); setChangeMotif(''); }} style={{padding:'8px 16px',borderRadius:8,border:'1.5px solid #e74c3c',background:'rgba(231,76,60,0.08)',color:'#e74c3c',cursor:'pointer',fontWeight:600,fontSize:13}}><i className="fa-solid fa-ban" style={{marginRight:6}}></i>Demander annulation</button>
                                        </React.Fragment>
                                    )}
                                    {bdcDetail.bdc.pending_change_request && (
                                        <span style={{padding:'8px 16px',borderRadius:8,background:'#fef3cd',color:'#856404',fontSize:12,fontWeight:600}}><i className="fa-solid fa-hourglass-half" style={{marginRight:6}}></i>Demande en cours auprès du DG</span>
                                    )}
                                </div>
                                {/* Visas et Signatures */}
                                {(bdcDetail.bdc.status !== 'brouillon') && (
                                    <div style={{marginTop:20, padding:16, background:'#faf9f7', border:'1px solid #e8e4df', borderRadius:10}}>
                                        <div style={{fontSize:11, fontWeight:700, color:'#999', textTransform:'uppercase', letterSpacing:1, marginBottom:12}}>Visas et Signatures</div>
                                        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12}}>
                                            <div style={{border:'1px solid #ddd', borderRadius:8, padding:12, textAlign:'center', minHeight:80, display:'flex', flexDirection:'column', justifyContent:'center', background:'#fff'}}>
                                                <div style={{fontSize:10, fontWeight:700, color:'#666', marginBottom:8}}>RESPONSABLE ACHATS</div>
                                                {React.createElement('div', {style:{fontFamily:"'Dancing Script',cursive", fontSize:22, color:'#1e3c78', fontWeight:700}}, 'Achraf Inak')}
                                                {React.createElement('div', {style:{fontSize:9, color:'#888', marginTop:2}}, 'Responsable Achats')}
                                            </div>
                                            <div style={{border:'1px solid #ddd', borderRadius:8, padding:12, textAlign:'center', minHeight:80, display:'flex', flexDirection:'column', justifyContent:'center', background:'#fff'}}>
                                                <div style={{fontSize:10, fontWeight:700, color:'#666', marginBottom:8}}>CHEF DE FERME — {bdcDetail.bdc.ferme}</div>
                                                {bdcDetail.bdc.validated_by_chef ? React.createElement(React.Fragment, null,
                                                    React.createElement('div', {style:{fontFamily:"'Dancing Script',cursive", fontSize:22, color:'#2D8B4E', fontWeight:700}}, bdcDetail.bdc.validated_by_chef.name),
                                                    React.createElement('div', {style:{fontSize:9, color:'#888', marginTop:2}}, 'Signé le ' + new Date(bdcDetail.bdc.validated_by_chef.at).toLocaleString('fr-FR'))
                                                ) : React.createElement('div', {style:{color:'#bbb', fontSize:12}}, 'En attente')}
                                            </div>
                                            <div style={{border:'1px solid #ddd', borderRadius:8, padding:12, textAlign:'center', minHeight:80, display:'flex', flexDirection:'column', justifyContent:'center', background:'#fff', position:'relative'}}>
                                                <div style={{fontSize:10, fontWeight:700, color:'#666', marginBottom:8}}>DIRECTEUR GÉNÉRAL</div>
                                                {bdcDetail.bdc.validated_by_dg ? React.createElement(React.Fragment, null,
                                                    signatureDgBase64
                                                        ? React.createElement('img', {src: signatureDgBase64, alt: 'Signature DG', style:{maxWidth:120, maxHeight:50, objectFit:'contain', margin:'4px auto'}})
                                                        : React.createElement('div', {style:{fontFamily:"'Dancing Script',cursive", fontSize:22, color:'#8B2252', fontWeight:700}}, bdcDetail.bdc.validated_by_dg.name),
                                                    React.createElement('div', {style:{fontSize:9, color:'#888', marginTop:2}}, bdcDetail.bdc.validated_by_dg.name + ' — Signé le ' + new Date(bdcDetail.bdc.validated_by_dg.at).toLocaleString('fr-FR')),
                                                    cachetBase64 && React.createElement('img', {src: cachetBase64, alt: 'Cachet', style:{position:'absolute', right:4, top:4, width:60, height:60, opacity:0.5, pointerEvents:'none'}})
                                                ) : React.createElement('div', {style:{color:'#bbb', fontSize:12}}, 'En attente')}
                                            </div>
                                        </div>
                                    </div>
                                )}
                                    </React.Fragment>
                                )}
                                {bdcDetail.bdc.history && bdcDetail.bdc.history.length > 0 && (
                                    <div style={{marginTop:20}}>
                                        <h4 style={{marginBottom:8}}>Historique</h4>
                                        <div style={{borderLeft:'2px solid #eee',paddingLeft:16}}>
                                            {bdcDetail.bdc.history.map((h, i) => (
                                                <div key={i} style={{marginBottom:12,position:'relative'}}>
                                                    <div style={{position:'absolute',left:-22,top:2,width:12,height:12,borderRadius:'50%',background: h.action.includes('rejet') ? 'var(--red)' : h.action.includes('valid') ? 'var(--green)' : 'var(--blue)'}}></div>
                                                    <div style={{fontSize:12,fontWeight:600,textTransform:'capitalize'}}>{h.action.replace(/_/g, ' ')}</div>
                                                    <div style={{fontSize:11,color:'var(--gray-400)'}}>{h.by?.name || h.by?.profileId || '—'} — {h.at ? new Date(h.at).toLocaleString('fr-FR') : ''}</div>
                                                    {h.comment && <div style={{fontSize:11,fontStyle:'italic',color:'#666'}}>{h.comment}</div>}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {/* Suivi Livraison */}
                                {(['envoye','virement_lance','virement_signe'].includes(bdcDetail.bdc.status) || (bdcDetail.bls && bdcDetail.bls.length > 0)) && (() => {
                                    const delData = getDeliveryData(bdcDetail.bdc, bdcDetail.bls);
                                    const ds = bdcDetail.bdc.delivery_status;
                                    const hasReste = delData.some(d => d.reste > 0);
                                    const dsLabel = ds === 'complet' ? 'Livraison complète' : ds === 'partiel' ? 'Livraison partielle' : 'Non livré';
                                    const dsColor = ds === 'complet' ? '#16a34a' : ds === 'partiel' ? '#d97706' : '#94a3b8';
                                    return (
                                    <div style={{marginTop:20, padding:16, background:'#f8fafc', border:'1px solid #e2e8f0', borderRadius:10}}>
                                        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12}}>
                                            <div style={{fontSize:11, fontWeight:700, color:'#64748b', textTransform:'uppercase', letterSpacing:1}}>
                                                <i className="fa-solid fa-truck-ramp-box" style={{marginRight:6}}></i>Suivi Livraison
                                            </div>
                                            <span style={{padding:'3px 10px', borderRadius:8, fontSize:11, fontWeight:700, background: ds === 'complet' ? '#f0fdf4' : ds === 'partiel' ? '#fffbeb' : '#f1f5f9', color: dsColor, border:'1px solid ' + dsColor + '33'}}>{dsLabel}</span>
                                        </div>
                                        <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
                                            <thead><tr style={{background:'#f1f5f9'}}>
                                                <th style={{padding:'6px 8px', textAlign:'left', fontWeight:600, color:'#475569'}}>Article</th>
                                                <th style={{padding:'6px 8px', textAlign:'right', fontWeight:600, color:'#475569'}}>Commandé</th>
                                                <th style={{padding:'6px 8px', textAlign:'right', fontWeight:600, color:'#475569'}}>Livré</th>
                                                <th style={{padding:'6px 8px', textAlign:'right', fontWeight:600, color:'#475569'}}>Reste</th>
                                                <th style={{padding:'6px 8px', textAlign:'center', fontWeight:600, color:'#475569', minWidth:100}}>Progression</th>
                                                <th style={{padding:'6px 8px', textAlign:'center', fontWeight:600, color:'#475569'}}>Statut</th>
                                            </tr></thead>
                                            <tbody>{delData.map((d, i) => (
                                                <tr key={i} style={{borderBottom:'1px solid #f1f5f9'}}>
                                                    <td style={{padding:'6px 8px', fontWeight:600}}>{d.article}</td>
                                                    <td style={{padding:'6px 8px', textAlign:'right'}}>{d.qCmd} {d.unite}</td>
                                                    <td style={{padding:'6px 8px', textAlign:'right', fontWeight:600, color: d.qLiv > 0 ? '#16a34a' : '#94a3b8'}}>{d.qLiv}</td>
                                                    <td style={{padding:'6px 8px', textAlign:'right', color: d.reste > 0 ? '#dc2626' : '#16a34a', fontWeight:600}}>{d.reste}</td>
                                                    <td style={{padding:'6px 8px'}}>
                                                        <div style={{background:'#e2e8f0', borderRadius:4, height:8, overflow:'hidden'}}>
                                                            <div style={{width: d.pct + '%', height:'100%', borderRadius:4, background: d.pct >= 100 ? '#16a34a' : d.pct > 0 ? '#d97706' : '#e2e8f0', transition:'width 0.3s'}}></div>
                                                        </div>
                                                        <div style={{fontSize:10, textAlign:'center', color:'#64748b', marginTop:2}}>{d.pct}%</div>
                                                    </td>
                                                    <td style={{padding:'6px 8px', textAlign:'center'}}>
                                                        <span style={{padding:'2px 8px', borderRadius:6, fontSize:10, fontWeight:700,
                                                            background: d.statut === 'livre' ? '#f0fdf4' : d.statut === 'partiel' ? '#fffbeb' : '#f1f5f9',
                                                            color: d.statut === 'livre' ? '#16a34a' : d.statut === 'partiel' ? '#d97706' : '#94a3b8'
                                                        }}>{d.statut === 'livre' ? 'Livré' : d.statut === 'partiel' ? 'Partiel' : 'En attente'}</span>
                                                    </td>
                                                </tr>
                                            ))}</tbody>
                                        </table>
                                        {/* Boutons réception */}
                                        {hasReste && !receptionMode && (
                                            <div style={{display:'flex', gap:8, marginTop:12}}>
                                                <button onClick={() => startReception('totale')} style={{padding:'8px 16px', borderRadius:8, border:'none', background:'#16a34a', color:'#fff', cursor:'pointer', fontWeight:700, fontSize:12}}>
                                                    <i className="fa-solid fa-check-double" style={{marginRight:6}}></i>Réception totale
                                                </button>
                                                <button onClick={() => startReception('partielle')} style={{padding:'8px 16px', borderRadius:8, border:'none', background:'#2563eb', color:'#fff', cursor:'pointer', fontWeight:700, fontSize:12}}>
                                                    <i className="fa-solid fa-list-check" style={{marginRight:6}}></i>Réception partielle
                                                </button>
                                            </div>
                                        )}
                                        {/* Formulaire réception inline */}
                                        {receptionMode && (
                                            <div style={{marginTop:12, padding:14, background:'#fff', border:'1px solid #93c5fd', borderRadius:8}}>
                                                <div style={{fontSize:12, fontWeight:700, color:'#2563eb', marginBottom:10}}><i className="fa-solid fa-clipboard-check" style={{marginRight:6}}></i>Saisie réception</div>
                                                <div style={{display:'flex', gap:10, marginBottom:12, flexWrap:'wrap'}}>
                                                    <div><label style={{fontSize:11, fontWeight:600, display:'block', marginBottom:3}}>Date réception</label>
                                                        <input type="date" value={receptionDate} onChange={e => setReceptionDate(e.target.value)} style={{padding:'6px 10px', borderRadius:6, border:'1px solid #ddd', fontSize:12}} /></div>
                                                    <div><label style={{fontSize:11, fontWeight:600, display:'block', marginBottom:3}}>N° BL fournisseur</label>
                                                        <input value={receptionNumBL} onChange={e => setReceptionNumBL(e.target.value)} placeholder="Optionnel" style={{padding:'6px 10px', borderRadius:6, border:'1px solid #ddd', fontSize:12}} /></div>
                                                </div>
                                                <table style={{width:'100%', borderCollapse:'collapse', fontSize:12}}>
                                                    <thead><tr style={{background:'#eff6ff'}}>
                                                        <th style={{padding:'6px 8px', textAlign:'left'}}>Article</th>
                                                        <th style={{padding:'6px 8px', textAlign:'right'}}>Commandé</th>
                                                        <th style={{padding:'6px 8px', textAlign:'right'}}>Déjà livré</th>
                                                        <th style={{padding:'6px 8px', textAlign:'right'}}>Reste</th>
                                                        <th style={{padding:'6px 8px', textAlign:'center'}}>Qté à recevoir</th>
                                                    </tr></thead>
                                                    <tbody>{receptionItems.map((it, idx) => {
                                                        const dd = delData.find(d => d.article === it.article) || {};
                                                        return (
                                                        <tr key={idx} style={{borderBottom:'1px solid #f0f0f0'}}>
                                                            <td style={{padding:'6px 8px', fontWeight:600}}>{it.article}</td>
                                                            <td style={{padding:'6px 8px', textAlign:'right'}}>{it.quantite_commandee} {it.unite}</td>
                                                            <td style={{padding:'6px 8px', textAlign:'right', color:'#16a34a'}}>{dd.qLiv || 0}</td>
                                                            <td style={{padding:'6px 8px', textAlign:'right', color:'#dc2626'}}>{dd.reste || 0}</td>
                                                            <td style={{padding:'6px 8px', textAlign:'center'}}>
                                                                <input type="number" min="0" max={dd.reste || 999} step="any" value={it.quantite_recue} onChange={e => { const v = parseFloat(e.target.value) || 0; setReceptionItems(items => items.map((x, i) => i === idx ? { ...x, quantite_recue: v } : x)); }}
                                                                    style={{width:80, padding:'5px 8px', borderRadius:6, border:'1.5px solid #93c5fd', fontSize:13, textAlign:'center', fontWeight:700}} />
                                                            </td>
                                                        </tr>);
                                                    })}</tbody>
                                                </table>
                                                <div style={{display:'flex', gap:8, justifyContent:'flex-end', marginTop:12}}>
                                                    <button onClick={() => setReceptionMode(false)} style={{padding:'8px 16px', borderRadius:8, border:'1px solid #ddd', background:'#fff', cursor:'pointer', fontSize:12}}>Annuler</button>
                                                    <button onClick={submitReception} disabled={submittingReception} style={{padding:'8px 20px', borderRadius:8, border:'none', background:'#16a34a', color:'#fff', cursor:'pointer', fontWeight:700, fontSize:12}}>
                                                        <i className={submittingReception ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-check'} style={{marginRight:6}}></i>{submittingReception ? 'Enregistrement...' : 'Valider la réception'}
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                        {/* BL existants */}
                                        {bdcDetail.bls && bdcDetail.bls.length > 0 && (
                                            <div style={{marginTop:12, paddingTop:10, borderTop:'1px solid #e2e8f0'}}>
                                                <div style={{fontSize:11, fontWeight:600, color:'#64748b', marginBottom:6}}>Bons de Livraison ({bdcDetail.bls.length})</div>
                                                {bdcDetail.bls.map(bl => (
                                                    <div key={bl.id} style={{display:'flex', gap:10, alignItems:'center', padding:'4px 0', fontSize:12}}>
                                                        <span style={{fontWeight:700, color:'var(--berry)'}}>{bl.numero}</span>
                                                        <span style={{color:'#64748b'}}>{bl.date_reception || '—'}</span>
                                                        {bl.numero_bl_fournisseur && <span style={{color:'#94a3b8'}}>BL fournisseur: {bl.numero_bl_fournisseur}</span>}
                                                        <span style={{color:'#475569'}}>{(bl.items || []).map(it => it.article + ': ' + it.quantite_recue + ' ' + (it.unite||'')).join(', ')}</span>
                                                        {window.ScanAttachmentButton && <window.ScanAttachmentButton entityType="delivery_notes" entityId={bl.id} scanUrl={bl.scan_url} scanPath={bl.scan_path} uploadedBy={{ profileId: currentProfile }} onUploaded={() => openDetail(selectedBdc)} compact />}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>);
                                })()}
                            </div>
                        </div>
                    )}

                    {/* Email Send Modal */}
                    {showEmailForm && bdcDetail && (
                        <div className="modal-overlay" style={{zIndex:1100}} onClick={e => { if(e.target===e.currentTarget) setShowEmailForm(false); }}>
                            <div className="modal-content" style={{maxWidth:550}}>
                                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
                                    <h3 style={{margin:0,color:'#2980b9'}}><i className="fa-solid fa-envelope" style={{marginRight:8}}></i>Envoyer BDC par email</h3>
                                    <button onClick={() => setShowEmailForm(false)} style={{background:'none',border:'none',cursor:'pointer',fontSize:18,color:'#999'}}>×</button>
                                </div>
                                <div style={{background:'rgba(41,128,185,0.08)',borderRadius:8,padding:'8px 12px',marginBottom:16,fontSize:12,color:'#2c3e50'}}>
                                    <i className="fa-solid fa-file-pdf" style={{marginRight:6,color:'#e74c3c'}}></i>
                                    Le PDF du <strong>{bdcDetail.bdc.numero}</strong> sera joint automatiquement à l'email.
                                </div>
                                <div style={{display:'grid',gap:12}}>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Destinataire *</label>
                                        <input type="email" value={emailForm.to} onChange={e => setEmailForm(f=>({...f, to:e.target.value}))} placeholder="email@fournisseur.com" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13,boxSizing:'border-box'}} /></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Objet</label>
                                        <input value={emailForm.subject} onChange={e => setEmailForm(f=>({...f, subject:e.target.value}))} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13,boxSizing:'border-box'}} /></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Message</label>
                                        <textarea value={emailForm.message} onChange={e => setEmailForm(f=>({...f, message:e.target.value}))} rows={5} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13,resize:'vertical',boxSizing:'border-box'}} /></div>
                                </div>
                                <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
                                    <button onClick={() => setShowEmailForm(false)} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                    <button onClick={submitEmail} disabled={sendingEmail} style={{padding:'8px 20px',borderRadius:8,border:'none',background:'#2980b9',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}>
                                        <i className={sendingEmail?'fa-solid fa-spinner fa-spin':'fa-solid fa-paper-plane'} style={{marginRight:6}}></i>{sendingEmail?'Envoi...':'Envoyer'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                    {/* Change Request Modal */}
                    {changeRequestModal && (
                        <div className="modal-overlay" style={{zIndex:1100}} onClick={e => { if(e.target===e.currentTarget) setChangeRequestModal(null); }}>
                            <div className="modal-content" style={{maxWidth:450}}>
                                <h3 style={{margin:'0 0 16px', color: changeRequestModal.type === 'annulation' ? 'var(--red)' : '#e67e22'}}>
                                    <i className={changeRequestModal.type === 'annulation' ? 'fa-solid fa-ban' : 'fa-solid fa-pen-to-square'} style={{marginRight:8}}></i>
                                    Demander {changeRequestModal.type === 'annulation' ? "l'annulation" : 'la modification'} du BDC
                                </h3>
                                <div style={{background: changeRequestModal.type === 'annulation' ? '#fef2f2' : '#fffbeb', border:'1px solid ' + (changeRequestModal.type === 'annulation' ? '#fca5a5' : '#fcd34d'), borderRadius:8, padding:'8px 12px', marginBottom:16, fontSize:12}}>
                                    <i className="fa-solid fa-triangle-exclamation" style={{marginRight:6}}></i>
                                    {changeRequestModal.type === 'annulation' ? 'Le BDC sera définitivement annulé après approbation du DG.' : 'Le BDC repassera en brouillon après approbation du DG. Les validations seront réinitialisées.'}
                                </div>
                                <div style={{marginBottom:16}}>
                                    <label style={{fontSize:12, fontWeight:700, display:'block', marginBottom:6}}>Motif <span style={{color:'var(--red)'}}>*</span></label>
                                    <textarea value={changeMotif} onChange={e => setChangeMotif(e.target.value)} rows={3} placeholder="Expliquez la raison de cette demande..." style={{width:'100%', padding:'8px 12px', borderRadius:8, border:'1px solid #ddd', fontSize:13, resize:'vertical', boxSizing:'border-box'}} />
                                </div>
                                <div style={{display:'flex', gap:8, justifyContent:'flex-end'}}>
                                    <button onClick={() => setChangeRequestModal(null)} style={{padding:'8px 16px', borderRadius:8, border:'1px solid #ddd', background:'#fff', cursor:'pointer', fontSize:13}}>Annuler</button>
                                    <button onClick={() => handleRequestChange(changeRequestModal.type)} style={{padding:'8px 20px', borderRadius:8, border:'none', background: changeRequestModal.type === 'annulation' ? 'var(--red)' : '#e67e22', color:'#fff', cursor:'pointer', fontWeight:700, fontSize:13}}>
                                        <i className="fa-solid fa-paper-plane" style={{marginRight:6}}></i>Envoyer au DG
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Modal Créer Fournisseur */}
                    {showCreateSupplier && (
                        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) setShowCreateSupplier(false); }} style={{zIndex:10001}}>
                            <div className="modal-content" style={{maxWidth:500,width:'90vw'}}>
                                <h3 style={{marginTop:0,color:'var(--berry)'}}><i className="fa-solid fa-truck-field" style={{marginRight:8}}></i>Nouveau Fournisseur</h3>
                                <div style={{background:'#eff6ff',border:'1px solid #bfdbfe',borderRadius:8,padding:'8px 12px',marginBottom:14,fontSize:11,color:'#1e40af'}}>
                                    <i className="fa-solid fa-circle-info" style={{marginRight:6}}></i>Le fournisseur est validé automatiquement si les 6 champs obligatoires sont valides (Nom, Adresse, IF, ICE, Contact, Téléphone).
                                </div>
                                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
                                    <div style={{gridColumn:'1 / -1'}}><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Nom *</label>
                                        <input value={newSupplier.nom} onChange={e => setNewSupplier({...newSupplier, nom: e.target.value})} placeholder="Nom du fournisseur" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>IF (Identifiant Fiscal) *</label>
                                        <input value={newSupplier.identifiant_fiscal} onChange={e => setNewSupplier({...newSupplier, identifiant_fiscal: e.target.value})} placeholder="7-8 chiffres" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>ICE *</label>
                                        <input value={newSupplier.ice} onChange={e => setNewSupplier({...newSupplier, ice: e.target.value})} placeholder="15 chiffres" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                    <div style={{gridColumn:'1 / -1'}}><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Adresse *</label>
                                        <input value={newSupplier.adresse} onChange={e => setNewSupplier({...newSupplier, adresse: e.target.value})} placeholder="Adresse" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Ville</label>
                                        <input value={newSupplier.ville} onChange={e => setNewSupplier({...newSupplier, ville: e.target.value})} placeholder="Ville" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Téléphone *</label>
                                        <input value={newSupplier.tel} onChange={e => setNewSupplier({...newSupplier, tel: e.target.value})} placeholder="0XXXXXXXXX" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                    <div style={{gridColumn:'1 / -1'}}><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Personne de contact *</label>
                                        <input value={newSupplier.contact_nom} onChange={e => setNewSupplier({...newSupplier, contact_nom: e.target.value})} placeholder="Nom du contact" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Email</label>
                                        <input type="email" value={newSupplier.email} onChange={e => setNewSupplier({...newSupplier, email: e.target.value})} placeholder="Email" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                    <div style={{gridColumn:'1 / -1'}}><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Catégorie</label>
                                        <select value={newSupplier.categorie} onChange={e => setNewSupplier({...newSupplier, categorie: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                            <option value="autre">Autre</option><option value="engrais">Engrais</option><option value="phyto">Phyto</option><option value="emballage">Emballage</option><option value="materiel">Matériel</option><option value="transport">Transport</option><option value="service">Service</option>
                                        </select></div>
                                </div>
                                <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                                    <button onClick={() => setShowCreateSupplier(false)} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                    <button onClick={handleCreateSupplier} disabled={creatingSup} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13,opacity:creatingSup?0.6:1}}>
                                        {creatingSup ? 'Création...' : 'Créer le fournisseur'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Modal Créer Article */}
                    {showCreateArticle && (
                        <div className="modal-overlay" onClick={e => { if (e.target === e.currentTarget) { setShowCreateArticle(false); setCreateArticleLineIdx(null); } }} style={{zIndex:10001}}>
                            <div className="modal-content" style={{maxWidth:500,width:'90vw'}}>
                                <h3 style={{marginTop:0,color:'var(--berry)'}}><i className="fa-solid fa-box" style={{marginRight:8}}></i>Nouvel Article</h3>
                                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:12}}>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Référence *</label>
                                        <input value={newArticle.reference} onChange={e => setNewArticle({...newArticle, reference: e.target.value})} placeholder="REF-001" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Nom *</label>
                                        <input value={newArticle.nom} onChange={e => setNewArticle({...newArticle, nom: e.target.value})} placeholder="Nom de l'article" style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Unité</label>
                                        <select value={newArticle.unite} onChange={e => setNewArticle({...newArticle, unite: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                            <option value="kg">kg</option><option value="L">L</option><option value="unité">unité</option><option value="carton">carton</option><option value="sac">sac</option><option value="bidon">bidon</option>
                                        </select></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Catégorie</label>
                                        <select value={newArticle.categorie} onChange={e => setNewArticle({...newArticle, categorie: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                            <option value="autre">Autre</option><option value="engrais">Engrais</option><option value="phyto">Phyto</option><option value="emballage">Emballage</option><option value="materiel">Matériel</option>
                                        </select></div>
                                    <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>TVA %</label>
                                        <select value={newArticle.taux_tva} onChange={e => setNewArticle({...newArticle, taux_tva: parseFloat(e.target.value)})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                            <option value={0}>0%</option><option value={7}>7%</option><option value={10}>10%</option><option value={14}>14%</option><option value={20}>20%</option>
                                        </select></div>
                                </div>
                                <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
                                    <button onClick={() => { setShowCreateArticle(false); setCreateArticleLineIdx(null); }} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                    <button onClick={handleCreateArticle} disabled={creatingArt} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13,opacity:creatingArt?0.6:1}}>
                                        {creatingArt ? 'Création...' : 'Créer l\'article'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            );
        }

export { AchatsBDCTab };
