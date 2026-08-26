// @ts-check
import React, { useState } from 'react';
import { UiBadge } from '../../shared/components/UiBadge';
import { UiStatCard } from '../../shared/components/UiStatCard';
import { DocumentViewerModal } from '../../shared/components/DocumentViewerModal';
import { AppConfirmModal } from '../../shared/components/AppConfirmModal';

export function StockDomainView({ activeFarm = 'Ferme 1 - Souss' }) {
  const [activeSubTab, setActiveSubTab] = useState('inventaire');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddStockModal, setShowAddStockModal] = useState(false);
  const [showAddMouvementModal, setShowAddMouvementModal] = useState(false);
  const [selectedDoc, setSelectedDoc] = useState(null);

  // Custom Confirm Modal State
  const [confirmModalState, setConfirmModalState] = useState({ isOpen: false, title: '', message: '', onConfirm: () => {} });

  // Form states — Stock Article
  const [stkArticle, setStkArticle] = useState('');
  const [stkQty, setStkQty] = useState('');
  const [stkSeuil, setStkSeuil] = useState('100');
  const [stkValue, setStkValue] = useState('');
  const [stkFileUrl, setStkFileUrl] = useState('');

  // Form states — Mouvement
  const [mvtArticle, setMvtArticle] = useState('');
  const [mvtType, setMvtType] = useState('entree');
  const [mvtQty, setMvtQty] = useState('');

  // Clean Production State Arrays
  const [stockItems, setStockItems] = useState([]);
  const [mouvements, setMouvements] = useState([]);

  // REAL-TIME DYNAMIC STOCK RECALCULATION ENGINE
  const dynamicTotalValuation = stockItems.reduce((acc, s) => acc + (s.rawValue || 0), 0);
  const lowStockCount = stockItems.filter(s => s.status === 'Réapprovisionner').length;

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setStkFileUrl(event.target?.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddStock = (e) => {
    e.preventDefault();
    if (!stkArticle || !stkQty) return;

    const qtyNum = parseFloat(stkQty) || 0;
    const valNum = parseFloat(stkValue) || qtyNum * 15;
    const seuilNum = parseFloat(stkSeuil) || 10;
    const isLow = qtyNum <= seuilNum;
    const docUrl = stkFileUrl || 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf';

    const newStk = {
      id: `STK-${Date.now().toString().slice(-2)}`,
      article: stkArticle,
      quantite: `${qtyNum.toLocaleString('fr-FR')} unités`,
      rawQty: qtyNum,
      minSeuil: `${seuilNum}`,
      valorisation: `${valNum.toLocaleString('fr-FR')} MAD`,
      rawValue: valNum,
      status: isLow ? 'Réapprovisionner' : 'Stock Optimal',
      variant: isLow ? 'amber' : 'emerald',
      documentUrl: docUrl
    };

    setStockItems([newStk, ...stockItems]);
    setShowAddStockModal(false);
    setStkArticle(''); setStkQty(''); setStkValue(''); setStkFileUrl('');
  };

  const handleAddMouvement = (e) => {
    e.preventDefault();
    if (!mvtArticle || !mvtQty) return;

    const q = parseFloat(mvtQty) || 0;
    const newM = {
      id: `MVT-${Date.now().toString().slice(-3)}`,
      article: mvtArticle,
      type: mvtType,
      quantite: mvtType === 'entree' ? `+ ${q}` : `- ${q}`,
      date: new Date().toISOString().split('T')[0],
      operateur: 'Magasinier Central',
      statut: 'Validé',
      variant: mvtType === 'entree' ? 'emerald' : 'amber'
    };

    setMouvements([newM, ...mouvements]);
    setShowAddMouvementModal(false);
    setMvtArticle(''); setMvtQty('');
  };

  const handleDeleteStock = (id) => {
    setConfirmModalState({
      isOpen: true,
      title: 'Suppression Article Stock',
      message: `Voulez-vous vraiment supprimer l'article de stock ${id} ?`,
      onConfirm: () => {
        setStockItems(stockItems.filter(s => s.id !== id));
      }
    });
  };

  const handleDeleteMouvement = (id) => {
    setConfirmModalState({
      isOpen: true,
      title: 'Suppression Mouvement Stock',
      message: `Voulez-vous vraiment supprimer le mouvement ${id} ?`,
      onConfirm: () => {
        setMouvements(mouvements.filter(m => m.id !== id));
      }
    });
  };

  const handleExportStockCSV = () => {
    const headers = ['Ref Stock', 'Article', 'Quantité', 'Seuil Alerte', 'Valorisation', 'Statut'];
    const rows = stockItems.map(s => [s.id, s.article, s.quantite, s.minSeuil, s.valorisation, s.status]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `stock_${activeFarm}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const subTabs = [
    { id: 'inventaire', label: 'Inventaire & Soldes', icon: 'fa-boxes-stacked' },
    { id: 'mouvements', label: 'Mouvements Entrées / Sorties', icon: 'fa-right-left' },
    { id: 'alertes', label: 'Réapprovisionnement & Alertes', icon: 'fa-triangle-exclamation' },
  ];

  const filteredStock = stockItems.filter(s => s.article.toLowerCase().includes(searchQuery.toLowerCase()) || s.id.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredMouvements = mouvements.filter(m => m.article.toLowerCase().includes(searchQuery.toLowerCase()) || m.id.toLowerCase().includes(searchQuery.toLowerCase()));
  const lowStockItems = stockItems.filter(s => s.status === 'Réapprovisionner');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s ease-in-out' }}>
      {/* REAL-TIME DYNAMIC STOCK KPI CARDS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
        <UiStatCard
          label="Valorisation Stock Total"
          value={`${dynamicTotalValuation.toLocaleString('fr-FR')} MAD`}
          subtext={`${stockItems.length} références gérées`}
          trend="0.0%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Valeur financière recalculée dynamiquement en temps réel sur les stocks réels"
        />
        <UiStatCard
          label="Articles sous Seuil Alerte"
          value={`${lowStockCount} article${lowStockCount > 1 ? 's' : ''}`}
          subtext={lowStockCount > 0 ? 'Réapprovisionnement requis' : 'Stock suffisant'}
          trend={lowStockCount > 0 ? 'Alerte Stock' : 'Stock Optimal'}
          highlightColor={lowStockCount > 0 ? 'var(--amber-500)' : 'var(--emerald-600)'}
          infoTooltip="Nombre dynamique d'articles sous le seuil d'alerte"
        />
        <UiStatCard
          label="Total Mouvements Enregistrés"
          value={`${mouvements.length} flux`}
          subtext="Magasin central active"
          trend="Flux réels"
          highlightColor="var(--indigo-600)"
          infoTooltip="Flux d'entrées et de sorties d'articles"
        />
        <UiStatCard
          label="Taux Écart Inventaire"
          value="0.0 %"
          subtext="Dernier récolement physique"
          trend="Écart nul"
          highlightColor="var(--emerald-600)"
          infoTooltip="Écart entre stock théorique et stock physique"
        />
      </div>

      {/* Sub-Tab Navigation Pills */}
      <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
        {subTabs.map(tab => {
          const isActive = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 14px',
                borderRadius: 'var(--radius-md)',
                fontSize: '13px',
                fontWeight: isActive ? '700' : '500',
                backgroundColor: isActive ? 'var(--emerald-600)' : 'var(--bg-card)',
                color: isActive ? '#FFFFFF' : 'var(--text-secondary)',
                border: isActive ? 'none' : '1px solid var(--border-color)',
                cursor: 'pointer',
                whiteSpace: 'nowrap'
              }}
            >
              <i className={`fa-solid ${tab.icon}`}></i>
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* SUB-TAB 1: INVENTAIRE */}
      {activeSubTab === 'inventaire' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)' }}>Stock Magasinier & Seuil d'Alerte — {activeFarm}</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Stockage & lecture des bons de réception (BR) numérisés</p>
            </div>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Rechercher article/ref..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={{ padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '13px', outline: 'none' }}
              />
              <button onClick={handleExportStockCSV} style={{ padding: '8px 14px', borderRadius: '6px', backgroundColor: 'var(--bg-subtle)', border: '1px solid var(--border-color)', fontSize: '13px', fontWeight: '600' }}>
                <i className="fa-solid fa-download" style={{ marginRight: '6px' }}></i> Exporter CSV
              </button>
              <button onClick={() => setShowAddStockModal(true)} style={{ padding: '8px 14px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none', fontSize: '13px', fontWeight: '600' }}>
                <i className="fa-solid fa-plus" style={{ marginRight: '6px' }}></i> Entrée / Nouvel Article
              </button>
            </div>
          </div>

          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            {filteredStock.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <i className="fa-solid fa-boxes-stacked" style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.4 }}></i>
                <p style={{ fontSize: '14px', fontWeight: '600' }}>Aucun article dans l'inventaire stock</p>
                <p style={{ fontSize: '12px' }}>Cliquez sur <strong>"Entrée / Nouvel Article"</strong> pour enregistrer et joindre votre premier Bon de Réception.</p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Ref Stock</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Article / Intitulé</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Quantité en Stock</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Seuil Alerte</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Valorisation</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Statut</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Document</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStock.map((s, idx) => (
                    <tr key={s.id} style={{ borderBottom: idx === filteredStock.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{s.id}</td>
                      <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{s.article}</td>
                      <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{s.quantite}</td>
                      <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{s.minSeuil}</td>
                      <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--emerald-600)' }}>{s.valorisation}</td>
                      <td style={{ padding: '14px 20px' }}>
                        <UiBadge variant={s.variant}>{s.status}</UiBadge>
                      </td>
                      <td style={{ padding: '14px 20px' }}>
                        <button
                          onClick={() => setSelectedDoc({ title: `Bon Réception ${s.id} — ${s.article}`, url: s.documentUrl })}
                          style={{ padding: '5px 10px', borderRadius: '4px', border: '1px solid var(--emerald-600)', backgroundColor: 'var(--emerald-50)', color: 'var(--emerald-700)', fontSize: '11px', fontWeight: '600', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                        >
                          <i className="fa-solid fa-eye"></i> Voir BR
                        </button>
                      </td>
                      <td style={{ padding: '14px 20px' }}>
                        <button onClick={() => handleDeleteStock(s.id)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--rose-500)', backgroundColor: 'transparent', color: 'var(--rose-500)', fontSize: '11px', cursor: 'pointer' }}>
                          Supprimer
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 2: MOUVEMENTS */}
      {activeSubTab === 'mouvements' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)' }}>Historique des Mouvements Entrées / Sorties Magasin — {activeFarm}</h4>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Traçabilité des consommations d'engrais, cartons et fioul terrain</p>
            </div>
            <button onClick={() => setShowAddMouvementModal(true)} style={{ padding: '8px 14px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none', fontSize: '13px', fontWeight: '600' }}>
              <i className="fa-solid fa-plus" style={{ marginRight: '6px' }}></i> Saisie Mouvement Stock
            </button>
          </div>

          <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border-color)', overflow: 'hidden' }}>
            {filteredMouvements.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                <i className="fa-solid fa-right-left" style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.4 }}></i>
                <p style={{ fontSize: '14px', fontWeight: '600' }}>Aucun mouvement enregistré</p>
                <p style={{ fontSize: '12px' }}>Cliquez sur <strong>"Saisie Mouvement Stock"</strong> pour déclarer un flux d'entrée ou de sortie.</p>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Réf Flux</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Article Concerné</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Sens Mouvement</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Quantité</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Date Mouvement</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Opérateur</th>
                    <th style={{ padding: '12px 20px', fontWeight: '600' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMouvements.map((m, idx) => (
                    <tr key={m.id} style={{ borderBottom: idx === filteredMouvements.length - 1 ? 'none' : '1px solid var(--border-subtle)' }}>
                      <td style={{ padding: '14px 20px', fontWeight: '700', color: 'var(--text-main)' }}>{m.id}</td>
                      <td style={{ padding: '14px 20px', fontWeight: '600', color: 'var(--text-main)' }}>{m.article}</td>
                      <td style={{ padding: '14px 20px' }}>
                        <UiBadge variant={m.variant}>{m.type === 'entree' ? 'Entrée Magasin (+)' : 'Sortie Champ (-)'}</UiBadge>
                      </td>
                      <td style={{ padding: '14px 20px', fontWeight: '700', color: m.type === 'entree' ? 'var(--emerald-600)' : 'var(--amber-500)' }}>{m.quantite}</td>
                      <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{m.date}</td>
                      <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{m.operateur}</td>
                      <td style={{ padding: '14px 20px' }}>
                        <button onClick={() => handleDeleteMouvement(m.id)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--rose-500)', backgroundColor: 'transparent', color: 'var(--rose-500)', fontSize: '11px', cursor: 'pointer' }}>
                          Supprimer
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* SUB-TAB 3: ALERTES REAPPRO */}
      {activeSubTab === 'alertes' && (
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)' }}>
          <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)', marginBottom: '8px' }}>Articles en Alerte Réapprovisionnement — {activeFarm}</h4>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '20px' }}>Articles dont le stock actuel est inférieur ou égal au seuil de sécurité défini</p>

          {lowStockItems.length === 0 ? (
            <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-muted)' }}>
              <i className="fa-solid fa-circle-check" style={{ fontSize: '32px', color: 'var(--emerald-600)', marginBottom: '12px' }}></i>
              <p style={{ fontSize: '14px', fontWeight: '600' }}>Tous les stocks sont à des niveaux optimaux</p>
              <p style={{ fontSize: '12px' }}>Aucun article n'a franchi le seuil de réapprovisionnement d'urgence.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {lowStockItems.map(item => (
                <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--amber-200)', backgroundColor: '#FFFBEB' }}>
                  <div>
                    <strong style={{ fontSize: '14px', color: 'var(--text-main)' }}>{item.article}</strong>
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Stock actuel: <strong>{item.quantite}</strong> (Seuil alerte: {item.minSeuil})</p>
                  </div>
                  <UiBadge variant="amber">Réapprovisionner Urgent</UiBadge>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MODALS */}
      {showAddStockModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleAddStock} style={{ backgroundColor: 'var(--bg-card)', padding: '28px', borderRadius: 'var(--radius-xl)', width: '440px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '700' }}>Saisie Entrée Article & Bon de Réception</h3>
            <input type="text" placeholder="Designation Article *" required value={stkArticle} onChange={e => setStkArticle(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="number" placeholder="Quantité en Stock *" required value={stkQty} onChange={e => setStkQty(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="number" placeholder="Seuil d'Alerte (ex: 100)" value={stkSeuil} onChange={e => setStkSeuil(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="number" placeholder="Valorisation MAD (ex: 15000)" value={stkValue} onChange={e => setStkValue(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-secondary)' }}>Joindre Bon de Réception Magasinier (BR) *</label>
              <input type="file" accept="image/*,.pdf" onChange={handleFileUpload} style={{ fontSize: '12px' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' }}>
              <button type="button" onClick={() => setShowAddStockModal(false)} style={{ padding: '8px 16px', borderRadius: '6px' }}>Annuler</button>
              <button type="submit" style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none' }}>Enregistrer & Joindre</button>
            </div>
          </form>
        </div>
      )}

      {showAddMouvementModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleAddMouvement} style={{ backgroundColor: 'var(--bg-card)', padding: '28px', borderRadius: 'var(--radius-xl)', width: '420px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '700' }}>Saisie Mouvement Entrée / Sortie</h3>
            <select value={mvtType} onChange={e => setMvtType(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
              <option value="entree">Entrée Magasin (+)</option>
              <option value="sortie">Sortie Champ (-)</option>
            </select>
            <input type="text" placeholder="Désignation Article *" required value={mvtArticle} onChange={e => setMvtArticle(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="number" placeholder="Quantité *" required value={mvtQty} onChange={e => setMvtQty(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => setShowAddMouvementModal(false)} style={{ padding: '8px 16px', borderRadius: '6px' }}>Annuler</button>
              <button type="submit" style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none' }}>Enregistrer Mouvement</button>
            </div>
          </form>
        </div>
      )}

      {/* Universal Document Viewer Modal */}
      <DocumentViewerModal
        isOpen={!!selectedDoc}
        onClose={() => setSelectedDoc(null)}
        documentTitle={selectedDoc?.title || 'Document Preview'}
        documentUrl={selectedDoc?.url}
      />

      {/* In-App Confirmation Modal */}
      <AppConfirmModal
        isOpen={confirmModalState.isOpen}
        onClose={() => setConfirmModalState({ ...confirmModalState, isOpen: false })}
        onConfirm={confirmModalState.onConfirm}
        title={confirmModalState.title}
        message={confirmModalState.message}
      />
    </div>
  );
}
