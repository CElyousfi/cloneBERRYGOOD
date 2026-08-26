// @ts-check
import React, { useState } from 'react';
import { UiBadge } from '../../shared/components/UiBadge';
import { UiStatCard } from '../../shared/components/UiStatCard';

export function StockDomainView({ activeFarm = 'Ferme 1 - Souss' }) {
  const [activeTab, setActiveTab] = useState('soldes');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddStockModal, setShowAddStockModal] = useState(false);

  // Form states
  const [stkArticle, setStkArticle] = useState('');
  const [stkQty, setStkQty] = useState('');
  const [stkSeuil, setStkSeuil] = useState('100');
  const [stkValue, setStkValue] = useState('');

  const [stockItems, setStockItems] = useState([
    { id: 'STK-01', article: 'Caisses Plastique Récolte 5kg', quantite: '4,500 unités', minSeuil: '1,000', valorisation: '67,500 MAD', status: 'Stock Optimal', variant: 'emerald' },
    { id: 'STK-02', article: 'Engrais NPK 20-20-20 (Sac 25kg)', quantite: '85 sacs', minSeuil: '100', valorisation: '25,500 MAD', status: 'Réapprovisionner', variant: 'amber' },
    { id: 'STK-03', article: 'Barquettes Clamshell 250g PET', quantite: '12,000 unités', minSeuil: '2,500', valorisation: '14,400 MAD', status: 'Stock Optimal', variant: 'emerald' },
    { id: 'STK-04', article: 'Film Plastique Paillage Noir 30µ', quantite: '42 rouleaux', minSeuil: '10', valorisation: '33,600 MAD', status: 'Stock Optimal', variant: 'emerald' },
  ]);

  const handleAddStock = (e) => {
    e.preventDefault();
    if (!stkArticle || !stkQty) return;

    const qtyNum = parseFloat(stkQty) || 0;
    const valNum = parseFloat(stkValue) || qtyNum * 15;
    const seuilNum = parseFloat(stkSeuil) || 10;
    const isLow = qtyNum <= seuilNum;

    const newStk = {
      id: `STK-${Date.now().toString().slice(-2)}`,
      article: stkArticle,
      quantite: `${qtyNum.toLocaleString('fr-FR')} unités`,
      minSeuil: `${seuilNum}`,
      valorisation: `${valNum.toLocaleString('fr-FR')} MAD`,
      status: isLow ? 'Réapprovisionner' : 'Stock Optimal',
      variant: isLow ? 'amber' : 'emerald'
    };

    setStockItems([newStk, ...stockItems]);
    setShowAddStockModal(false);
    setStkArticle(''); setStkQty(''); setStkValue('');
  };

  const handleDeleteStock = (id) => {
    if (confirm(`Supprimer l'article de stock ${id} ?`)) {
      setStockItems(stockItems.filter(s => s.id !== id));
    }
  };

  const handleExportStockCSV = () => {
    const headers = ['Ref Stock', 'Article', 'Quantité', 'Seuil Alerte', 'Valorisation', 'Statut'];
    const rows = stockItems.map(s => [s.id, s.article, s.quantite, s.minSeuil, s.valorisation, s.status]);
    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `stock_magasinier_${activeFarm}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const filteredStock = stockItems.filter(s => {
    return s.article.toLowerCase().includes(searchQuery.toLowerCase()) || s.id.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', animation: 'fadeIn 0.2s ease-in-out' }}>
      {/* Top Stock KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
        <UiStatCard
          label="Valorisation Stock Total"
          value="141,000 MAD"
          subtext="4 familles d'articles"
          trend="+3.2%"
          highlightColor="var(--emerald-600)"
          infoTooltip="Valeur financière totale des stocks en magasin"
        />
        <UiStatCard
          label="Articles sous Seuil Alerte"
          value={`${stockItems.filter(s => s.status === 'Réapprovisionner').length} article`}
          subtext="Engrais NPK 20-20-20"
          trend="Réappro urgent"
          highlightColor="var(--amber-500)"
          infoTooltip="Nombre d'articles nécessitant un réapprovisionnement"
        />
        <UiStatCard
          label="Bons de Réception (BR)"
          value="18 BR intégrés"
          subtext="Mois en cours"
          trend="100% rapprochés"
          highlightColor="var(--indigo-600)"
          infoTooltip="Nombre de réceptions validées par le magasinier"
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

      {/* Sub-Tab Navigation */}
      <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-color)', paddingBottom: '10px' }}>
        <button
          onClick={() => setActiveTab('soldes')}
          style={{
            padding: '8px 14px',
            borderRadius: 'var(--radius-md)',
            fontSize: '13px',
            fontWeight: activeTab === 'soldes' ? '700' : '500',
            backgroundColor: activeTab === 'soldes' ? 'var(--emerald-600)' : 'var(--bg-card)',
            color: activeTab === 'soldes' ? '#FFFFFF' : 'var(--text-secondary)',
            border: activeTab === 'soldes' ? 'none' : '1px solid var(--border-color)',
            cursor: 'pointer'
          }}
        >
          <i className="fa-solid fa-boxes-stacked" style={{ marginRight: '6px' }}></i>
          Soldes de Stock Théoriques
        </button>
      </div>

      {/* Content Table */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ backgroundColor: 'var(--bg-card)', borderRadius: 'var(--radius-lg)', padding: '20px 24px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h4 style={{ fontSize: '16px', fontWeight: '700', color: 'var(--text-main)' }}>Stock Magasinier & Seuil d'Alerte — {activeFarm}</h4>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Contrôle des stocks physiques & valeur d'inventaire</p>
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
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr style={{ backgroundColor: 'var(--bg-subtle)', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Ref Stock</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Article / Intitulé</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Quantité en Stock</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Seuil Alerte</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Valorisation</th>
                <th style={{ padding: '12px 20px', fontWeight: '600' }}>Statut</th>
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
                    <button onClick={() => handleDeleteStock(s.id)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--rose-500)', backgroundColor: 'transparent', color: 'var(--rose-500)', fontSize: '11px', cursor: 'pointer' }}>
                      Supprimer
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Add Stock */}
      {showAddStockModal && (
        <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <form onSubmit={handleAddStock} style={{ backgroundColor: 'var(--bg-card)', padding: '28px', borderRadius: 'var(--radius-xl)', width: '420px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '18px', fontWeight: '700' }}>Saisie Entrée Article / Stock</h3>
            <input type="text" placeholder="Designation Article *" required value={stkArticle} onChange={e => setStkArticle(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="number" placeholder="Quantité en Stock *" required value={stkQty} onChange={e => setStkQty(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="number" placeholder="Seuil d'Alerte (ex: 100)" value={stkSeuil} onChange={e => setStkSeuil(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <input type="number" placeholder="Valorisation MAD (ex: 15000)" value={stkValue} onChange={e => setStkValue(e.target.value)} style={{ padding: '10px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button type="button" onClick={() => setShowAddStockModal(false)} style={{ padding: '8px 16px', borderRadius: '6px' }}>Annuler</button>
              <button type="submit" style={{ padding: '8px 16px', borderRadius: '6px', backgroundColor: 'var(--emerald-600)', color: '#FFF', border: 'none' }}>Enregistrer Entrée</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
