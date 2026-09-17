/* Module: admin | Déclaration(s): DGSignatureTab */
import { useEffect, useRef, useState } from '../shared/reactHooks.jsx';

// ===================== DG SIGNATURE & CACHET =====================
        function DGSignatureTab({ currentProfile, profileData }) {
            // Étapes : 'upload' → 'preview' → 'done'
            const [step, setStep] = useState('upload');
            const [pdfFile, setPdfFile] = useState(null);
            const [pdfName, setPdfName] = useState('');
            const [pdfBytes, setPdfBytes] = useState(null);
            const [processing, setProcessing] = useState(false);
            const [resultUrl, setResultUrl] = useState(null);
            const [error, setError] = useState(null);
            const [pageCount, setPageCount] = useState(0);

            // Aperçu pages
            const [pageImages, setPageImages] = useState([]);
            const [pageSizes, setPageSizes] = useState([]);
            const [currentPage, setCurrentPage] = useState(0);
            const [loadingPreview, setLoadingPreview] = useState(false);

            // Images cachet/signature en data URL pour l'aperçu
            const [cachetDataUrl, setCachetDataUrl] = useState(null);
            const [signatureDataUrl, setSignatureDataUrl] = useState(null);
            const [cachetBytesTransparent, setCachetBytesTransparent] = useState(null);
            const [signatureBytesRaw, setSignatureBytesRaw] = useState(null);

            // Paramètres ajustables
            const [cachetSize, setCachetSize] = useState(220);
            const [sigSize, setSigSize] = useState(200);
            const [overlap, setOverlap] = useState(15);

            // Positions par page : { [pageIndex]: { xPct, yPct } } en % de la page
            const [positions, setPositions] = useState({});

            // Drag state
            const [dragging, setDragging] = useState(false);
            const [dragStart, setDragStart] = useState(null);
            const previewRef = useRef(null);
            const [previewScale, setPreviewScale] = useState(1);

            useEffect(() => {
                return () => { if (resultUrl) URL.revokeObjectURL(resultUrl); };
            }, [resultUrl]);

            // Compute dynamic scale: preview container px / PDF page points
            useEffect(() => {
                const updateScale = () => {
                    const el = previewRef.current;
                    const ps = pageSizes[currentPage];
                    if (el && ps && ps.width > 0) {
                        setPreviewScale(el.getBoundingClientRect().width / ps.width);
                    }
                };
                updateScale();
                const ro = new ResizeObserver(updateScale);
                if (previewRef.current) ro.observe(previewRef.current);
                return () => ro.disconnect();
            }, [currentPage, pageSizes]);

            // Détourer le cachet
            const removeCachetBackground = (imgBytes) => {
                return new Promise((resolve) => {
                    const blob = new Blob([imgBytes], { type: 'image/png' });
                    const url = URL.createObjectURL(blob);
                    const img = new Image();
                    img.onload = () => {
                        const c = document.createElement('canvas');
                        c.width = img.naturalWidth; c.height = img.naturalHeight;
                        const ctx = c.getContext('2d');
                        ctx.drawImage(img, 0, 0);
                        const imageData = ctx.getImageData(0, 0, c.width, c.height);
                        const d = imageData.data;
                        for (let i = 0; i < d.length; i += 4) {
                            if (d[i] > 230 && d[i+1] > 230 && d[i+2] > 230) d[i+3] = 0;
                        }
                        ctx.putImageData(imageData, 0, 0);
                        const dataUrl = c.toDataURL('image/png');
                        c.toBlob(b => {
                            b.arrayBuffer().then(ab => { URL.revokeObjectURL(url); resolve({ dataUrl, bytes: ab }); });
                        }, 'image/png');
                    };
                    img.src = url;
                });
            };

            // Charger le PDF et générer les aperçus
            const handleFileChange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                if (file.type !== 'application/pdf') { setError('Veuillez sélectionner un fichier PDF.'); return; }
                setPdfFile(file);
                setPdfName(file.name);
                setError(null);
                setLoadingPreview(true);

                try {
                    const bytes = await file.arrayBuffer();
                    setPdfBytes(bytes);

                    // Charger images
                    const [rawCachetBytes, rawSigBytes] = await Promise.all([
                        fetch('/assets/cachet.png').then(r => r.arrayBuffer()),
                        fetch('/assets/signature_transparent_hd.png').then(r => r.arrayBuffer()),
                    ]);
                    const { dataUrl: cachetDU, bytes: cachetTB } = await removeCachetBackground(rawCachetBytes);
                    setCachetDataUrl(cachetDU);
                    setCachetBytesTransparent(cachetTB);
                    setSignatureBytesRaw(rawSigBytes);
                    const sigBlob = new Blob([rawSigBytes], { type: 'image/png' });
                    setSignatureDataUrl(URL.createObjectURL(sigBlob));

                    // Rendre les pages avec pdf.js
                    if (!window.pdfjsLib) throw new Error('pdf.js non chargé');
                    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                    const pdf = await window.pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
                    const total = pdf.numPages;
                    setPageCount(total);
                    const images = [];
                    const sizes = [];

                    for (let i = 1; i <= total; i++) {
                        const page = await pdf.getPage(i);
                        const vp = page.getViewport({ scale: 1.5 });
                        const canvas = document.createElement('canvas');
                        canvas.width = vp.width; canvas.height = vp.height;
                        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
                        images.push(canvas.toDataURL('image/png'));
                        const origVp = page.getViewport({ scale: 1 });
                        sizes.push({ width: origVp.width, height: origVp.height });
                    }
                    pdf.destroy();
                    setPageImages(images);
                    setPageSizes(sizes);

                    // Positions par défaut : dernière page au centre, autres en bas à droite
                    const defaultPos = {};
                    for (let i = 0; i < total; i++) {
                        const isLast = i === total - 1;
                        if (isLast) {
                            defaultPos[i] = { xPct: 50, yPct: 50 };
                        } else {
                            defaultPos[i] = { xPct: 80, yPct: 85 };
                        }
                    }
                    setPositions(defaultPos);
                    setCurrentPage(0);
                    setStep('preview');
                } catch (err) {
                    console.error(err);
                    setError(err.message || 'Erreur lors du chargement du PDF.');
                }
                setLoadingPreview(false);
            };

            // Drag handlers
            const handleMouseDown = (e) => {
                e.preventDefault();
                const rect = previewRef.current?.getBoundingClientRect();
                if (!rect) return;
                setDragging(true);
                setDragStart({ mx: e.clientX, my: e.clientY, pos: { ...positions[currentPage] } });
            };
            const handleMouseMove = (e) => {
                if (!dragging || !dragStart || !previewRef.current) return;
                const rect = previewRef.current.getBoundingClientRect();
                const dx = ((e.clientX - dragStart.mx) / rect.width) * 100;
                const dy = ((e.clientY - dragStart.my) / rect.height) * 100;
                const newX = Math.max(0, Math.min(100, dragStart.pos.xPct + dx));
                const newY = Math.max(0, Math.min(100, dragStart.pos.yPct + dy));
                setPositions(p => ({ ...p, [currentPage]: { xPct: newX, yPct: newY } }));
            };
            const handleMouseUp = () => { setDragging(false); setDragStart(null); };

            // Touch handlers pour mobile
            const handleTouchStart = (e) => {
                const touch = e.touches[0];
                const rect = previewRef.current?.getBoundingClientRect();
                if (!rect) return;
                setDragging(true);
                setDragStart({ mx: touch.clientX, my: touch.clientY, pos: { ...positions[currentPage] } });
            };
            const handleTouchMove = (e) => {
                if (!dragging || !dragStart || !previewRef.current) return;
                e.preventDefault();
                const touch = e.touches[0];
                const rect = previewRef.current.getBoundingClientRect();
                const dx = ((touch.clientX - dragStart.mx) / rect.width) * 100;
                const dy = ((touch.clientY - dragStart.my) / rect.height) * 100;
                const newX = Math.max(0, Math.min(100, dragStart.pos.xPct + dx));
                const newY = Math.max(0, Math.min(100, dragStart.pos.yPct + dy));
                setPositions(p => ({ ...p, [currentPage]: { xPct: newX, yPct: newY } }));
            };
            const handleTouchEnd = () => { setDragging(false); setDragStart(null); };

            // Appliquer la même position à toutes les pages (sauf dernière ou sauf autres)
            const applyToOtherPages = () => {
                const pos = positions[currentPage];
                if (!pos) return;
                setPositions(p => {
                    const updated = { ...p };
                    const isCurrentLast = currentPage === pageCount - 1;
                    for (let i = 0; i < pageCount; i++) {
                        if (isCurrentLast) {
                            if (i === pageCount - 1) updated[i] = { ...pos };
                        } else {
                            if (i !== pageCount - 1) updated[i] = { ...pos };
                        }
                    }
                    return updated;
                });
            };

            // Signer le PDF final
            const processAndSign = async () => {
                if (!pdfBytes || typeof PDFLib === 'undefined' || !PDFLib) return;
                setProcessing(true);
                setError(null);
                try {
                    const { PDFDocument, pushGraphicsState, popGraphicsState, concatTransformationMatrix } = PDFLib;
                    const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: false }).catch(() => {
                        throw new Error('Ce PDF est protégé par un mot de passe ou corrompu.');
                    });

                    const cachetImage = await pdfDoc.embedPng(cachetBytesTransparent);
                    const signatureImage = await pdfDoc.embedPng(signatureBytesRaw);

                    const cachetW = cachetSize;
                    const cachetH = cachetW * (cachetImage.height / cachetImage.width);
                    const sigW = sigSize;
                    const sigH = sigW * (signatureImage.height / signatureImage.width);
                    const groupW = Math.max(cachetW, sigW);
                    const groupH = sigH + cachetH - overlap;

                    const pages = pdfDoc.getPages();
                    for (let i = 0; i < pages.length; i++) {
                        const page = pages[i];
                        const { width: W, height: H } = page.getSize();
                        const rotation = page.getRotation().angle;
                        const pos = positions[i] || { xPct: 50, yPct: 50 };

                        // Dimensions visuelles (après rotation d'affichage)
                        const isSwapped = rotation === 90 || rotation === 270;
                        const vw = isSwapped ? H : W;
                        const vh = isSwapped ? W : H;

                        // Centre visuel depuis les pourcentages utilisateur
                        const vx = (pos.xPct / 100) * vw;
                        const vy = (pos.yPct / 100) * vh;

                        // Convertir coordonnées visuelles → PDF (origine bas-gauche, non-rotaté)
                        let centerX, centerYPdf;
                        switch (rotation) {
                            case 90:
                                centerX = vy;
                                centerYPdf = vx;
                                break;
                            case 180:
                                centerX = W - vx;
                                centerYPdf = vy;
                                break;
                            case 270:
                                centerX = W - vy;
                                centerYPdf = H - vx;
                                break;
                            default:
                                centerX = vx;
                                centerYPdf = H - vy;
                        }

                        // Pour les pages rotées, appliquer une contre-rotation au stamp
                        if (rotation !== 0) {
                            const rad = rotation * Math.PI / 180;
                            const cs = Math.cos(rad), sn = Math.sin(rad);
                            const tx = centerX * (1 - cs) + centerYPdf * sn;
                            const ty = centerYPdf * (1 - cs) - centerX * sn;
                            page.pushOperators(
                                pushGraphicsState(),
                                concatTransformationMatrix(cs, sn, -sn, cs, tx, ty)
                            );
                        }

                        const baseX = centerX - groupW / 2;
                        const baseY = centerYPdf - groupH / 2;

                        // Cachet (en bas du groupe)
                        page.drawImage(cachetImage, {
                            x: baseX + (groupW - cachetW) / 2, y: baseY,
                            width: cachetW, height: cachetH, opacity: 0.9,
                        });
                        // Signature au-dessus
                        page.drawImage(signatureImage, {
                            x: baseX + (groupW - sigW) / 2, y: baseY + cachetH - overlap,
                            width: sigW, height: sigH, opacity: 1,
                        });

                        if (rotation !== 0) {
                            page.pushOperators(popGraphicsState());
                        }
                    }

                    const modifiedBytes = await pdfDoc.save();
                    const blob = new Blob([modifiedBytes], { type: 'application/pdf' });
                    if (resultUrl) URL.revokeObjectURL(resultUrl);
                    setResultUrl(URL.createObjectURL(blob));
                    setStep('done');
                } catch (err) {
                    console.error('Signature PDF error:', err);
                    setError(err.message || 'Erreur lors du traitement du PDF.');
                }
                setProcessing(false);
            };

            const handleDownload = () => {
                if (!resultUrl) return;
                const a = document.createElement('a');
                a.href = resultUrl;
                a.download = pdfName.replace(/\.pdf$/i, '_signé.pdf');
                a.click();
            };

            const resetForm = () => {
                setPdfFile(null); setPdfName(''); setPdfBytes(null);
                setStep('upload'); setPageImages([]); setPageSizes([]);
                setPositions({}); setCurrentPage(0); setPageCount(0);
                if (resultUrl) URL.revokeObjectURL(resultUrl);
                setResultUrl(null); setError(null);
                setCachetSize(220); setSigSize(200); setOverlap(15);
            };

            const cardStyle = { background: 'var(--card-bg)', borderRadius: 16, padding: 28, boxShadow: '0 2px 12px rgba(0,0,0,0.06)' };
            const pos = positions[currentPage] || { xPct: 50, yPct: 50 };

            return (
                <div className="fade-in" onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onTouchEnd={handleTouchEnd}>
                    <div style={{display:'flex', alignItems:'center', gap:12, marginBottom:24}}>
                        <div style={{width:44, height:44, borderRadius:12, background:'linear-gradient(135deg, var(--berry), var(--berry-light))', display:'flex', alignItems:'center', justifyContent:'center'}}>
                            <i className="fa-solid fa-stamp" style={{color:'#fff', fontSize:20}}></i>
                        </div>
                        <div>
                            <h2 style={{margin:0, fontSize:20, fontWeight:700}}>Signature & Cachet</h2>
                            <p style={{margin:0, fontSize:13, color:'var(--gray-500)'}}>Apposer la signature DG et le cachet Berry Good sur un PDF</p>
                        </div>
                    </div>

                    {/* ÉTAPE 1 : Upload */}
                    {step === 'upload' && (
                        <div style={cardStyle}>
                            <div style={{marginBottom:20}}>
                                <label style={{display:'block', fontWeight:600, marginBottom:8, fontSize:14}}>
                                    <i className="fa-solid fa-file-pdf" style={{marginRight:6, color:'#e74c3c'}}></i>
                                    Sélectionner un fichier PDF
                                </label>
                                <div style={{position:'relative', border:'2px dashed var(--gray-300)', borderRadius:12, padding:'30px 20px', textAlign:'center', cursor:'pointer', background: loadingPreview ? 'var(--gray-100)' : 'transparent'}}
                                    onClick={() => !loadingPreview && document.getElementById('pdf-upload-input').click()}>
                                    <input id="pdf-upload-input" type="file" accept=".pdf" onChange={handleFileChange}
                                        style={{position:'absolute', top:0, left:0, width:'100%', height:'100%', opacity:0, cursor:'pointer'}} />
                                    {loadingPreview ? (
                                        <div><i className="fa-solid fa-spinner fa-spin" style={{fontSize:28, color:'var(--berry)', marginBottom:8}}></i>
                                        <p style={{margin:0, fontWeight:500, color:'var(--gray-500)'}}>Chargement de l'aperçu...</p></div>
                                    ) : (
                                        <div><i className="fa-solid fa-cloud-arrow-up" style={{fontSize:32, color:'var(--gray-400)', marginBottom:8}}></i>
                                        <p style={{margin:0, fontWeight:500, color:'var(--gray-500)'}}>Cliquez ou glissez un PDF ici</p></div>
                                    )}
                                </div>
                            </div>
                            {error && (
                                <div style={{background:'#fdeaea', border:'1px solid #e74c3c', borderRadius:8, padding:'10px 14px', color:'#c0392b', fontSize:13}}>
                                    <i className="fa-solid fa-circle-exclamation" style={{marginRight:6}}></i>{error}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ÉTAPE 2 : Aperçu + Ajustements */}
                    {step === 'preview' && (
                        <div style={{display:'flex', gap:20, flexWrap:'wrap'}}>
                            {/* Colonne gauche : Aperçu page */}
                            <div style={{...cardStyle, flex:'1 1 500px', minWidth:0}}>
                                <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12}}>
                                    <h3 style={{margin:0, fontSize:16, fontWeight:600}}>
                                        <i className="fa-solid fa-eye" style={{marginRight:6, color:'var(--berry)'}}></i>
                                        Aperçu — Page {currentPage + 1}/{pageCount}
                                        {currentPage === pageCount - 1 && <span style={{marginLeft:8, fontSize:11, background:'var(--berry)', color:'#fff', padding:'2px 8px', borderRadius:10}}>Dernière page</span>}
                                    </h3>
                                    <div style={{display:'flex', gap:6}}>
                                        <button onClick={() => setCurrentPage(p => Math.max(0, p-1))} disabled={currentPage === 0}
                                            style={{width:32, height:32, borderRadius:8, border:'1px solid var(--gray-300)', background:'#fff', cursor: currentPage === 0 ? 'not-allowed' : 'pointer', opacity: currentPage === 0 ? 0.4 : 1}}>
                                            <i className="fa-solid fa-chevron-left"></i>
                                        </button>
                                        <button onClick={() => setCurrentPage(p => Math.min(pageCount-1, p+1))} disabled={currentPage === pageCount-1}
                                            style={{width:32, height:32, borderRadius:8, border:'1px solid var(--gray-300)', background:'#fff', cursor: currentPage === pageCount-1 ? 'not-allowed' : 'pointer', opacity: currentPage === pageCount-1 ? 0.4 : 1}}>
                                            <i className="fa-solid fa-chevron-right"></i>
                                        </button>
                                    </div>
                                </div>

                                {/* Zone d'aperçu avec le stamp draggable */}
                                <div ref={previewRef}
                                    style={{position:'relative', border:'1px solid var(--gray-200)', borderRadius:8, overflow:'hidden', cursor: dragging ? 'grabbing' : 'default', userSelect:'none', touchAction:'none'}}>
                                    {pageImages[currentPage] && <img src={pageImages[currentPage]} style={{width:'100%', display:'block', pointerEvents:'none'}} alt={'Page '+(currentPage+1)} />}

                                    {/* Overlay stamp draggable */}
                                    {cachetDataUrl && signatureDataUrl && (
                                        <div
                                            onMouseDown={handleMouseDown}
                                            onTouchStart={handleTouchStart}
                                            onTouchMove={handleTouchMove}
                                            style={{
                                                position:'absolute',
                                                left: pos.xPct + '%', top: pos.yPct + '%',
                                                transform: 'translate(-50%, -50%)',
                                                cursor: dragging ? 'grabbing' : 'grab',
                                                zIndex: 10,
                                                display:'flex', flexDirection:'column', alignItems:'center',
                                                filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.2))',
                                                touchAction: 'none',
                                            }}>
                                            <img src={signatureDataUrl} alt="Signature"
                                                style={{width: sigSize * previewScale, height:'auto', marginBottom: -overlap * previewScale, position:'relative', zIndex:2, pointerEvents:'none'}} />
                                            <img src={cachetDataUrl} alt="Cachet"
                                                style={{width: cachetSize * previewScale, height:'auto', opacity:0.9, pointerEvents:'none'}} />
                                        </div>
                                    )}
                                </div>
                                <p style={{margin:'8px 0 0', fontSize:11, color:'var(--gray-400)', textAlign:'center'}}>
                                    <i className="fa-solid fa-hand-pointer" style={{marginRight:4}}></i>
                                    Glissez le cachet/signature pour ajuster la position
                                </p>
                            </div>

                            {/* Colonne droite : Paramètres */}
                            <div style={{...cardStyle, flex:'0 0 280px'}}>
                                <h3 style={{margin:'0 0 16px', fontSize:16, fontWeight:600}}>
                                    <i className="fa-solid fa-sliders" style={{marginRight:6, color:'var(--berry)'}}></i> Ajustements
                                </h3>

                                <div style={{marginBottom:16}}>
                                    <label style={{display:'flex', justifyContent:'space-between', fontSize:13, fontWeight:500, marginBottom:4}}>
                                        <span>Taille cachet</span><span style={{color:'var(--gray-400)'}}>{cachetSize}pt</span>
                                    </label>
                                    <input type="range" min="60" max="360" value={cachetSize} onChange={e => setCachetSize(+e.target.value)}
                                        style={{width:'100%', accentColor:'var(--berry)'}} />
                                </div>

                                <div style={{marginBottom:16}}>
                                    <label style={{display:'flex', justifyContent:'space-between', fontSize:13, fontWeight:500, marginBottom:4}}>
                                        <span>Taille signature</span><span style={{color:'var(--gray-400)'}}>{sigSize}pt</span>
                                    </label>
                                    <input type="range" min="50" max="320" value={sigSize} onChange={e => setSigSize(+e.target.value)}
                                        style={{width:'100%', accentColor:'var(--berry)'}} />
                                </div>

                                <div style={{marginBottom:20}}>
                                    <label style={{display:'flex', justifyContent:'space-between', fontSize:13, fontWeight:500, marginBottom:4}}>
                                        <span>Chevauchement</span><span style={{color:'var(--gray-400)'}}>{overlap}pt</span>
                                    </label>
                                    <input type="range" min="0" max="40" value={overlap} onChange={e => setOverlap(+e.target.value)}
                                        style={{width:'100%', accentColor:'var(--berry)'}} />
                                </div>

                                <div style={{borderTop:'1px solid var(--gray-200)', paddingTop:16, marginBottom:16}}>
                                    <label style={{fontSize:13, fontWeight:500, marginBottom:8, display:'block'}}>Position (page {currentPage+1})</label>
                                    <div style={{display:'flex', gap:8, marginBottom:8}}>
                                        <div style={{flex:1}}>
                                            <span style={{fontSize:11, color:'var(--gray-400)'}}>X: {pos.xPct.toFixed(0)}%</span>
                                            <input type="range" min="5" max="95" value={pos.xPct} onChange={e => setPositions(p => ({...p, [currentPage]: {...p[currentPage], xPct: +e.target.value}}))}
                                                style={{width:'100%', accentColor:'var(--berry)'}} />
                                        </div>
                                        <div style={{flex:1}}>
                                            <span style={{fontSize:11, color:'var(--gray-400)'}}>Y: {pos.yPct.toFixed(0)}%</span>
                                            <input type="range" min="5" max="95" value={pos.yPct} onChange={e => setPositions(p => ({...p, [currentPage]: {...p[currentPage], yPct: +e.target.value}}))}
                                                style={{width:'100%', accentColor:'var(--berry)'}} />
                                        </div>
                                    </div>
                                    {pageCount > 1 && (
                                        <button onClick={applyToOtherPages}
                                            style={{width:'100%', padding:'6px 10px', fontSize:12, background:'var(--gray-100)', border:'1px solid var(--gray-300)', borderRadius:8, cursor:'pointer', color:'var(--gray-600)'}}>
                                            <i className="fa-solid fa-copy" style={{marginRight:4}}></i>
                                            Appliquer à {currentPage === pageCount - 1 ? 'la dernière page' : 'toutes les pages (sauf dernière)'}
                                        </button>
                                    )}
                                </div>

                                {error && (
                                    <div style={{background:'#fdeaea', border:'1px solid #e74c3c', borderRadius:8, padding:'8px 12px', marginBottom:12, color:'#c0392b', fontSize:12}}>
                                        <i className="fa-solid fa-circle-exclamation" style={{marginRight:4}}></i>{error}
                                    </div>
                                )}

                                <button onClick={processAndSign} disabled={processing}
                                    style={{width:'100%', padding:'12px 16px', background: processing ? 'var(--gray-300)' : 'var(--berry)', color:'#fff', border:'none', borderRadius:10, fontSize:14, fontWeight:600, cursor: processing ? 'not-allowed' : 'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8, marginBottom:8}}>
                                    {processing ? <><i className="fa-solid fa-spinner fa-spin"></i> Traitement...</> : <><i className="fa-solid fa-stamp"></i> Signer le PDF</>}
                                </button>
                                <button onClick={resetForm}
                                    style={{width:'100%', padding:'8px 16px', background:'var(--gray-100)', color:'var(--gray-600)', border:'1px solid var(--gray-200)', borderRadius:10, fontSize:13, cursor:'pointer'}}>
                                    <i className="fa-solid fa-rotate-left" style={{marginRight:4}}></i> Changer de PDF
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ÉTAPE 3 : Résultat */}
                    {step === 'done' && (
                        <div style={cardStyle}>
                            <div style={{textAlign:'center'}}>
                                <div style={{width:60, height:60, borderRadius:'50%', background:'#d4edda', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 16px'}}>
                                    <i className="fa-solid fa-check" style={{fontSize:28, color:'#28a745'}}></i>
                                </div>
                                <h3 style={{margin:'0 0 8px', fontSize:18, fontWeight:700}}>PDF signé avec succès</h3>
                                <p style={{margin:'0 0 20px', fontSize:13, color:'var(--gray-500)'}}>
                                    {pageCount} page{pageCount > 1 ? 's' : ''} — Signature et cachet appliqués
                                </p>
                                <div style={{display:'flex', gap:12, justifyContent:'center', marginBottom:8}}>
                                    <button onClick={handleDownload}
                                        style={{padding:'10px 24px', background:'var(--berry)', color:'#fff', border:'none', borderRadius:10, fontSize:14, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', gap:8}}>
                                        <i className="fa-solid fa-download"></i> Télécharger
                                    </button>
                                    <button onClick={() => setStep('preview')}
                                        style={{padding:'10px 24px', background:'var(--gray-100)', color:'var(--gray-700)', border:'1px solid var(--gray-200)', borderRadius:10, fontSize:14, fontWeight:500, cursor:'pointer', display:'flex', alignItems:'center', gap:8}}>
                                        <i className="fa-solid fa-pen"></i> Modifier
                                    </button>
                                    <button onClick={resetForm}
                                        style={{padding:'10px 24px', background:'var(--gray-100)', color:'var(--gray-700)', border:'1px solid var(--gray-200)', borderRadius:10, fontSize:14, fontWeight:500, cursor:'pointer', display:'flex', alignItems:'center', gap:8}}>
                                        <i className="fa-solid fa-rotate-left"></i> Nouveau
                                    </button>
                                </div>
                                {resultUrl && (
                                    <div style={{border:'1px solid var(--gray-200)', borderRadius:12, overflow:'hidden', height:500, marginTop:16}}>
                                        <iframe src={resultUrl} style={{width:'100%', height:'100%', border:'none'}} title="Aperçu PDF signé"></iframe>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            );
        }

export { DGSignatureTab };
