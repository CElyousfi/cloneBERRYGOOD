/* Module: caisse | Déclaration(s): CaisseDropzone */
import { useState } from '../shared/reactHooks.jsx';

function CaisseDropzone({ onFiles, cc }) {
            const [drag, setDrag] = useState(false);
            const onDrop = (e) => {
                e.preventDefault(); setDrag(false);
                const fs = Array.from((e.dataTransfer && e.dataTransfer.files) || []).filter(f => /\.(xlsx|xlsm|xls)$/i.test(f.name));
                if (fs.length) onFiles(fs);
            };
            return (
                <label
                    onDragOver={e => { e.preventDefault(); setDrag(true); }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={onDrop}
                    style={{display:'block',padding:'18px 12px',border:`1.5px dashed ${drag ? cc.color : 'var(--gray-200)'}`,borderRadius:8,cursor:'pointer',textAlign:'center',marginBottom:8,fontSize:12,color: drag ? cc.color : 'var(--gray-400)',background: drag ? cc.bg : 'transparent',transition:'all .15s'}}>
                    <i className="fa-solid fa-cloud-arrow-up" style={{marginRight:6,fontSize:16}}></i>
                    <div style={{marginTop:4}}>Glissez le(s) fichier(s) ici ou cliquez</div>
                    <div style={{fontSize:10.5,color:'var(--gray-400)',marginTop:2}}>.xlsx, .xlsm — plusieurs fichiers acceptés</div>
                    <input type="file" accept=".xlsx,.xlsm,.xls" multiple onChange={e => { const fs = Array.from(e.target.files || []); if (fs.length) onFiles(fs); e.target.value = ''; }} style={{display:'none'}} />
                </label>
            );
        }

export { CaisseDropzone };
