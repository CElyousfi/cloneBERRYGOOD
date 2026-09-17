/* Module: shared | Déclaration(s): KPICard */


// KPI Card
        function KPICard({ icon, iconClass, value, label, change, subItems, onClick }) {
            return (
                <div className="kpi-card fade-in" onClick={onClick} style={onClick ? {cursor:'pointer', transition:'transform 0.15s, box-shadow 0.15s'} : {}}
                    onMouseEnter={e => { if (onClick) { e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 8px 24px rgba(0,0,0,0.12)'; }}}
                    onMouseLeave={e => { if (onClick) { e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow=''; }}}>
                    <div className="kpi-header">
                        <div className={`kpi-icon ${iconClass}`}>
                            <i className={`fa-solid ${icon}`}></i>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:6}}>
                            {change !== undefined && (
                                <span className={`kpi-change ${change >= 0 ? 'up' : 'down'}`}>
                                    <i className={`fa-solid ${change >= 0 ? 'fa-arrow-up' : 'fa-arrow-down'}`}></i> {Math.abs(change)}%
                                </span>
                            )}
                            {onClick && <i className="fa-solid fa-arrow-up-right-from-square" style={{fontSize:9,color:'var(--gray-300)'}}></i>}
                        </div>
                    </div>
                    <div className="kpi-value">{value}</div>
                    <div className="kpi-label">{label}</div>
                    {subItems && (
                        <div className="kpi-sub">
                            {subItems.map((item, i) => {
                                const clickable = typeof item.onClick === 'function';
                                return (
                                    <div className="kpi-sub-item" key={i}
                                        onClick={clickable ? (e) => { e.stopPropagation(); item.onClick(e); } : undefined}
                                        style={clickable ? {cursor:'pointer', textDecoration:'underline', textDecorationStyle:'dotted', textUnderlineOffset:2} : {}}
                                        onMouseEnter={clickable ? (e) => { e.currentTarget.style.color='var(--berry)'; } : undefined}
                                        onMouseLeave={clickable ? (e) => { e.currentTarget.style.color=''; } : undefined}
                                        title={clickable ? 'Voir le détail des ouvriers' : undefined}>
                                        <strong>{item.value}</strong>
                                        {item.label}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            );
        }

export { KPICard };
