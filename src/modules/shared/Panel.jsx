/* Module: shared | Déclaration(s): Panel */


// Panel
        function Panel({ title, icon, actions, children }) {
            return (
                <div className="panel fade-in">
                    <div className="panel-header">
                        <div className="panel-title">
                            {icon && <i className={`fa-solid ${icon}`}></i>}
                            {title}
                        </div>
                        {actions}
                    </div>
                    <div className="panel-body">{children}</div>
                </div>
            );
        }

export { Panel };
