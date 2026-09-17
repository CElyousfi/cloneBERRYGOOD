/*
 * MagBCTab.jsx — Onglet magasinier "Bons de Consommation" (engrais / phyto /
 * tous) : liste filtrable + tri + export Excel, création d'un bon (articles,
 * parcelle ou groupe de parcelles, scan), création d'article au catalogue et
 * pop-up de détail d'un bon.
 *
 * Exports : MagBCTab, MagBCEngraisTab, MagBCPhytoTab.
 * Extrait du monolithe à comportement IDENTIQUE. XLSX (SheetJS) et React
 * sont des globales CDN.
 *
 * Props (MagBCTab) :
 *   - type          : '' | 'engrais' | 'pesticide'
 *   - label, icon   : surcharges d'affichage (déduites de type si absentes)
 *   - currentProfile: id du profil courant (string)
 *   - profileData   : objet profil (name, …)
 */

import * as ArticleSelect from '../shared/lib/articleSelect.js';
import * as CampagneUtils from '../shared/lib/campagneUtils.js';
import * as CultureUtils from '../shared/lib/cultureUtils.js';
import * as ParcelleGroupUtils from '../shared/lib/parcelleGroupUtils.js';
import * as UniteConsoUtils from '../shared/lib/uniteConsoUtils.js';
import { ArticleConversionFields } from './ArticleConversionFields.jsx';
import { BCDoublonDialog } from './BCDoublonDialog.jsx';
import { MagBCScanModal } from './MagBCScanModal.jsx';
import { cachedFetch } from '../shared/cachedFetch.jsx';
import { sbParcelle } from '../shared/sbParcelleState.js';
import { useStockLocations } from '../shared/lib/useStockLocations.js';

var useState = React.useState;
var useEffect = React.useEffect;

      /**
       * ArticleCombo — le champ « Article » du bon de consommation, en
       * SÉLECTION FERMÉE (demande d'Omar : « liste déroulante avec champ de
       * sélection en tapant le nom »).
       *
       * L'ancien `<input list>` + `<datalist>` RESSEMBLAIT à une liste
       * déroulante et acceptait n'importe quoi : toute faute de frappe entrait
       * dans le système comme un article.
       *
       * ⚠️ POURQUOI LA FRAPPE LIBRE RESTE POSSIBLE. On tape pour FILTRER, et
       * c'est aussi la seule façon de nommer un article ABSENT du catalogue
       * pour en demander la création. Interdire la frappe libre enfermerait le
       * magasinier devant une marchandise qu'il a physiquement en main. Ce qui
       * est fermé, c'est la VALIDATION : tant que la saisie ne désigne pas une
       * fiche unique, la ligne est marquée en rouge et `handleCreate` refuse
       * d'envoyer le bon (cf. ArticleSelect.lignesInvalides).
       *
       * Toutes les décisions vivent dans shared/lib/articleSelect.js (pur,
       * testé). Ce composant n'est que le rendu — il ne compare aucun libellé
       * lui-même.
       */
      function ArticleCombo({ valeur, index, onChoisir, onSaisir, getStock, placeholder }) {
          const AS = ArticleSelect;
          const [ouvert, setOuvert] = useState(false);
          // Fermeture DIFFÉRÉE au blur : sur mobile comme sur desktop, le clic
          // sur une option déclenche le blur de l'input AVANT le clic. Fermer
          // tout de suite ferait disparaître l'option sous le doigt.
          const fermerPlusTard = () => window.setTimeout(() => setOuvert(false), 150);
          // Lib non chargée, OU catalogue inconnu (`list-articles` en échec /
          // pas encore revenu) : on rend un champ simple, sans liste et sans
          // verdict. Filtrer sur un catalogue qu'on n'a pas lu ferait refuser
          // des articles qui existent — cf. le pavé de `catalogueConnu`.
          // Le serveur reste la garde qui fait foi.
          if (!AS || !index || !index.entrees.length) {
              return <input value={valeur || ''} onChange={e => onSaisir(e.target.value)} placeholder={placeholder}
                  style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}} />;
          }
          const verdict = AS.verdictChoix(index, valeur);
          const options = ouvert ? AS.filtrerEntrees(index, valeur, 40) : [];
          // ⚠️ `en_cours` (frappe partielle QUI A des correspondances) n'est
          // NI rouge, NI une erreur : le magasinier est en train de taper.
          // Le peindre en rouge à chaque lettre d'une saisie normale était
          // l'autre moitié du défaut remonté par Omar sur `sulfate`.
          const invalide = verdict.issue === AS.ISSUE_INCONNU || verdict.issue === AS.ISSUE_AMBIGU;
          // Rappel DISCRET, et seulement une fois la liste refermée : tant
          // qu'elle est ouverte, les options parlent d'elles-mêmes.
          const enCours = !ouvert && verdict.issue === AS.ISSUE_EN_COURS;
          return (
              <div style={{position:'relative'}}>
                  <input
                      value={valeur || ''}
                      onChange={e => { onSaisir(e.target.value); setOuvert(true); }}
                      onFocus={() => setOuvert(true)}
                      onBlur={fermerPlusTard}
                      placeholder={placeholder || 'Taper pour chercher…'}
                      autoComplete="off"
                      style={{width:'100%',padding:'4px 8px',borderRadius:6,fontSize:12,
                          border: invalide ? '2px solid #e74c3c' : '1px solid #ddd'}}
                  />
                  {ouvert && (
                      <div style={{position:'absolute',zIndex:30,left:0,right:0,top:'100%',marginTop:2,maxHeight:220,
                          overflowY:'auto',background:'#fff',border:'1px solid #ddd',borderRadius:6,
                          boxShadow:'0 4px 14px rgba(0,0,0,.14)'}}>
                          {options.length === 0 ? (
                              <div style={{padding:'6px 8px',fontSize:11,color:'#888'}}>Aucun article du catalogue ne correspond.</div>
                          ) : options.map(e => (
                              // onMouseDown, PAS onClick : le blur de l'input part
                              // avant le click et refermerait la liste sans jamais
                              // déclencher le choix.
                              <div key={e.cle} onMouseDown={ev => { ev.preventDefault(); onChoisir(e); setOuvert(false); }}
                                  style={{padding:'6px 8px',fontSize:12,cursor:'pointer',borderBottom:'1px solid #f4f4f4',
                                      background: e.ambigu ? '#fff6f5' : '#fff'}}>
                                  {e.nom}
                                  {e.ambigu
                                      ? <span style={{color:'#a01d10',fontSize:10,marginLeft:6,fontWeight:600}}>
                                          <i className="fa-solid fa-triangle-exclamation" style={{marginRight:3}}></i>
                                          {e.fiches.length} fiches — à fusionner
                                        </span>
                                      : <span style={{color:'#888',fontSize:10,marginLeft:6}}>stock : {getStock ? getStock(e.nom) : '—'}</span>}
                              </div>
                          ))}
                      </div>
                  )}
                  {invalide && (
                      <div style={{fontSize:10,color:'#a01d10',marginTop:3,fontWeight:600,lineHeight:1.3}}>
                          <i className="fa-solid fa-triangle-exclamation" style={{marginRight:3}}></i>{verdict.message}
                      </div>
                  )}
                  {enCours && (
                      <div style={{fontSize:10,color:'#888',marginTop:3,lineHeight:1.3}}>
                          <i className="fa-solid fa-list" style={{marginRight:3}}></i>{verdict.message}
                      </div>
                  )}
              </div>
          );
      }

      // ===================== MAGASINIER: BONS CONSOMMATION ENGRAIS TAB =====================
      function MagBCEngraisTab({ currentProfile, profileData }) {
          return <MagBCTab type="engrais" label="Engrais" icon="fa-flask" currentProfile={currentProfile} profileData={profileData} />;
      }

      // ===================== MAGASINIER: BONS CONSOMMATION PHYTO TAB =====================
      function MagBCPhytoTab({ currentProfile, profileData }) {
          return <MagBCTab type="pesticide" label="Phytosanitaire" icon="fa-bug" currentProfile={currentProfile} profileData={profileData} />;
      }

      // ===================== MAGASINIER: BONS CONSOMMATION (shared) =====================
      function MagBCTab({ type: typeProp, label: labelProp, icon: iconProp, currentProfile, profileData }) {
          const type = typeProp || '';
          const label = labelProp || (type === 'engrais' ? 'Engrais' : type === 'pesticide' ? 'Phytosanitaire' : 'Tous');
          const icon = iconProp || 'fa-flask';

          // ---- Brouillon persistant de saisie -------------------------------
          // Le bon en cours de saisie ne doit JAMAIS disparaître : l'état local
          // était perdu à chaque remount du tab (retour de fenêtre / sortie du
          // plein écran, pull-to-refresh, rechargement mobile). On sauvegarde le
          // brouillon dans localStorage à chaque frappe et on le restaure au
          // montage. Effacé à la création du bon et à « Annuler ».
          const BC_DRAFT_KEY = 'bcDraft_v1_' + (type || 'tous');
          const BC_DRAFT_TTL_MS = 24 * 3600 * 1000;
          const clearBcDraft = () => { try { window.localStorage.removeItem(BC_DRAFT_KEY); } catch (e) {} };
          // Un brouillon n'est restauré que s'il contient vraiment quelque chose :
          // un formulaire vierge ne doit pas rouvrir la fenêtre tout seul.
          const bcDraftHasContent = (f) => !!(f && Array.isArray(f.items) && f.items.some(
              it => (it.article || '').trim() || String(it.quantite || '').trim() || (it.parcelle || '').trim()));
          const readBcDraft = () => {
              try {
                  const raw = window.localStorage.getItem(BC_DRAFT_KEY);
                  if (!raw) return null;
                  const d = JSON.parse(raw);
                  if (!d || !d.form || !Array.isArray(d.form.items)) return null;
                  if (!d.savedAt || (Date.now() - d.savedAt) > BC_DRAFT_TTL_MS) { clearBcDraft(); return null; }
                  if (!bcDraftHasContent(d.form)) { clearBcDraft(); return null; }
                  return d;
              } catch (e) { return null; }
          };
          // Lu une seule fois, au premier rendu (useState paresseux plus bas).
          const bcDraftRef = React.useRef(undefined);
          if (bcDraftRef.current === undefined) bcDraftRef.current = readBcDraft();
          const bcDraft0 = bcDraftRef.current;
          // -------------------------------------------------------------------

          const [bcs, setBcs] = useState([]);
          const [loading, setLoading] = useState(true);
          const [showForm, setShowForm] = useState(!!bcDraft0);
          // Modale « Scanner des bons » (composant séparé, MagBCScanModal)
          const [showScan, setShowScan] = useState(false);
          const [stocks, setStocks] = useState([]);
          const [catalogueArticles, setCatalogueArticles] = useState([]);
          const [showCreateArticle, setShowCreateArticle] = useState(false);
          const [newArticle, setNewArticle] = useState({ reference: '', nom: '', unite: 'kg', categorie: 'autre', taux_tva: 20 });
          const [creatingArt, setCreatingArt] = useState(false);
          const [createArticleLineIdx, setCreateArticleLineIdx] = useState(null);
          const canCreateArticle = currentProfile === 'achats' || currentProfile === 'dg';
          const [parcelles, setParcelles] = useState([]);
          const [refParcelles, setRefParcelles] = useState({ courante: [], precedente: [] });
          // Référentiel Smart Berry (sb_parcelle_referentiel), clé = label BEE ONE
          // en MAJUSCULES. Source de vérité pour le NOM et la CULTURE affichés :
          // une parcelle renommée côté RH doit apparaître sous son nom SB partout.
          const [sbRefMap, setSbRefMap] = useState(() => sbParcelle.REF || {});
          // Groupes de parcelles = raccourci de saisie (parcelle combinée). Le
          // backend éclate la ligne en N parcelles RÉELLES au prorata des Ha.
          const [parcelleGroupes, setParcelleGroupes] = useState([]);
          const FARMS = ['F1', 'F5'];
          // Magasins dérivés de la config stock (get-locations) — source unique, plus de hardcode.
          const MAGASINS = useStockLocations().magasins;
          const STATIONS = ['Station F1', 'Station F2', 'Station F3', 'Station F4', 'Station F5', 'Station F6'];
          const emptyItem = { article: '', quantite: '', unite: 'kg', parcelle: '', parcelle_ref: '', culture: '', ferme: '', groupe_id: '' };
          const [form, setForm] = useState(() => (bcDraft0 && bcDraft0.form)
              || { date: new Date().toISOString().split('T')[0], lieu_source_type: 'magasin', lieu_source_id: 'F1', items: [{ ...emptyItem }] });
          const [scanFileBC, setScanFileBC] = useState(null);
          const [scanPreviewBC, setScanPreviewBC] = useState(null);
          // Campagne (année fiscale Juillet→Juin) : '2025-2026', etc.
          // Source unique : CampagneUtils (lib/campagneUtils.js). Fallback
          // défensif si le lib n'est pas encore chargé (renvoie '' comme l'ancien helper).
          const bcCampagneOf = (dateStr) => (CampagneUtils ? (CampagneUtils.campagneOf(dateStr) || '') : (() => { const m = (dateStr || '').match(/^(\d{4})-(\d{2})/); if (!m) return ''; const y = +m[1], mo = +m[2]; const start = mo >= 7 ? y : y - 1; return start + '-' + (start + 1); })());
          const [bcCampagne, setBcCampagne] = useState(() => (bcDraft0 && bcDraft0.bcCampagne)
              || bcCampagneOf(new Date().toISOString().slice(0, 10)));
          // Culture : filtre GLOBAL au bon (pas une donnée du bon). '' = toutes.
          // Jamais envoyé au backend — même convention que bcCampagne.
          const [bcCulture, setBcCulture] = useState(() => (bcDraft0 && bcDraft0.bcCulture) || '');

          const [query, setQuery] = useState('');
          const [filterSource, setFilterSource] = useState('');
          const [dateFrom, setDateFrom] = useState('');
          const [dateTo, setDateTo] = useState('');
          const [sortField, setSortField] = useState('date');
          const [sortDir, setSortDir] = useState('desc');
          const [detailBc, setDetailBc] = useState(null);
          // --- Modification de la DATE d'un bon (magasinier) ------------------
          // Périmètre volontairement étroit : la date, et rien d'autre. Le
          // backend (action `update-bc-date`) met à jour le bon ET les
          // stock_movements liés dans la MÊME transaction.
          const [editDateBc, setEditDateBc] = useState(null);
          const [editDateValue, setEditDateValue] = useState('');
          const [editDateSaving, setEditDateSaving] = useState(false);
          const [editDateError, setEditDateError] = useState('');
          // --- Doublon refusé par create-bc (409) -----------------------------
          // NOUVEAUX useState AJOUTÉS EN FIN DE LISTE, jamais intercalés : les
          // tests de rendu indexent les hooks par ordre de déclaration.
          const [doublonBc, setDoublonBc] = useState(null);
          // --- Suppression d'un bon (magasinier / achats / dg) ----------------
          const [deleteBc, setDeleteBc] = useState(null);
          const [deleteMotif, setDeleteMotif] = useState('');
          const [deleteSaving, setDeleteSaving] = useState(false);
          const [deleteError, setDeleteError] = useState('');
          // Seconde étape de confirmation du magasinier (retaper le numéro).
          // ENCORE EN FIN DE LISTE : cf. l'avertissement plus haut, les tests
          // de rendu indexent les hooks par position.
          const [deleteConfirmBc, setDeleteConfirmBc] = useState(null);
          const [deleteNumeroSaisi, setDeleteNumeroSaisi] = useState('');
          // --- Conversion d'unité d'un article (magasinier / achats / dg) -----
          // ENCORE ET TOUJOURS EN FIN DE LISTE : cf. l'avertissement plus haut,
          // les tests de rendu indexent les hooks par position.
          const [conversionArticle, setConversionArticle] = useState(null);
          const [conversionForm, setConversionForm] = useState({ unite_consommation: '', stock_par_unite_consommation: '' });
          const [conversionSaving, setConversionSaving] = useState(false);
          const [conversionError, setConversionError] = useState('');
          const isImportBC = (bc) => bc._isImport || (bc.numero || '').startsWith('IMP-') || bc.created_by?.userId === 'import_caneva';
          const loadBcs = () => {
              Promise.all([
                  fetch('/api/stock?action=list-bc&type=' + type).then(r => r.json()).catch(() => ({ success: false })),
                  fetch('/api/stock?action=list-movements&type=consommation&limit=3000').then(r => r.json()).catch(() => ({ success: false })),
              ]).then(([bcJson, movJson]) => {
                  const list = bcJson.success ? (bcJson.bcs || []) : [];
                  const movs = movJson.success ? (movJson.movements || []) : [];
                  // Append movements without bc_id (imports / direct mouvements) as virtual BC rows
                  const extras = movs.filter(m => !m.bc_id).map(m => ({
                      id: 'mov_' + m.id,
                      numero: m.numero,
                      date: m.date,
                      ferme: m.ferme,
                      lieu_source: m.lieu_source || null,
                      items: (m.items || []).map(i => ({ article: i.article_nom || i.article_ref, quantite: i.quantite, unite: i.unite, parcelle: m.lieu_destination?.id || '', ferme: m.ferme })),
                      created_by: m.created_by || {},
                      _isImport: (m.numero || '').startsWith('IMP-') || m.created_by?.userId === 'import_caneva',
                  }));
                  setBcs([...list, ...extras]);
              }).finally(() => setLoading(false));
          };
          useEffect(() => { loadBcs(); }, []);
          // Sauvegarde du brouillon à chaque modification pendant la saisie.
          // (Le scan joint n'est pas sérialisable : il est à re-joindre après un
          // retour de fenêtre — le reste du bon est intact.)
          useEffect(() => {
              if (!showForm || !bcDraftHasContent(form)) return;
              try { window.localStorage.setItem(BC_DRAFT_KEY, JSON.stringify({ form, bcCampagne, bcCulture, savedAt: Date.now() })); } catch (e) {}
          }, [showForm, form, bcCampagne, bcCulture]); // eslint-disable-line react-hooks/exhaustive-deps
          useEffect(() => { cachedFetch('/api/stock?action=stock-levels').then(json => { if (json.success) setStocks(json.stocks || []); }).catch(() => {}); }, []);
          // ⚠️ LISTE COMPLÈTE, DOUBLONS COMPRIS. Elle était dédoublonnée par nom
          // ici même, ce qui rendait le front AVEUGLE aux ~105 paires de fiches
          // jumelles du catalogue : deux fiches « Acide Nitrique » en désaccord
          // sur la conversion faisaient afficher « = 6.6 KG déduits » pendant
          // que le serveur, lui, voyait l'ambiguïté et déduisait 5 L d'un stock
          // en kilos. Le dédoublonnage ne sert qu'à l'AFFICHAGE de la liste de
          // suggestions (catalogueArticlesAffichage), jamais à décider.
          useEffect(() => { fetch('/api/stock?action=list-articles').then(r=>r.json()).then(j=>{ if(j.success) { setCatalogueArticles(j.articles||[]); } }).catch(()=>{}); }, []);
          useEffect(() => { cachedFetch('/api/parcelles').then(json => { if (json.success) setParcelles(json.parcelles || []); }).catch(() => {}); }, []);
          useEffect(() => {
              fetch('/api/pointage-rh?action=parcelles-campagne-list')
                  .then(r => r.json())
                  .then(j => { if (j.success) setRefParcelles({ courante: j.campagne_courante || [], precedente: j.campagne_precedente || [] }); })
                  .catch(() => {});
          }, []);
          useEffect(() => {
              // Référentiel SB : chargé ici (et pas seulement via SB_PARCELLE_REF
              // posé au boot par sbLoad) pour garantir un re-rendu quand il arrive.
              fetch('/api/pointage-rh?action=sb-referentiel-list')
                  .then(r => r.json())
                  .then(j => {
                      if (!j.success) return;
                      const map = {};
                      (j.parcelles || []).forEach(p => { map[(p.label_bee_one || p.id || '').toUpperCase().trim()] = p; });
                      sbParcelle.REF = map;
                      setSbRefMap(map);
                  })
                  .catch(() => {});
          }, []);
          useEffect(() => {
              // Groupes de parcelles (lecture ouverte à tout profil authentifié).
              // `valide: false` = un membre n'a plus de Ha SB → groupe non
              // proposé à la saisie (le backend le refuserait de toute façon).
              fetch('/api/pointage-rh?action=sb-groupes-list')
                  .then(r => r.json())
                  .then(j => { if (j.success) setParcelleGroupes((j.groupes || []).filter(g => g.valide)); })
                  .catch(() => {});
          }, []);

          const catalogUnit = (article) => { const a = catalogueArticles.find(x => (x.nom||'').toLowerCase() === (article||'').toLowerCase()); return a && a.unite ? (a.unite || '').toLowerCase() : null; };
          // Liste d'AFFICHAGE uniquement : une seule entrée par nom dans les
          // suggestions, sinon le magasinier voit la même ligne deux fois.
          // ⚠️ Ne JAMAIS s'en servir pour décider quoi que ce soit (conversion,
          // fiches à corriger) : c'est précisément ce dédoublonnage, appliqué
          // trop tôt, qui masquait les fiches jumelles au front.
          const catalogueArticlesAffichage = (() => {
              const seen = new Set();
              return catalogueArticles.filter(a => { if (seen.has(a.nom)) return false; seen.add(a.nom); return true; });
          })();
          // --- SÉLECTION FERMÉE DE L'ARTICLE (lib/articleSelect) -------------
          // Index bâti sur le catalogue COMPLET, jamais sur
          // `catalogueArticlesAffichage` : ce dédoublonnage-là se fait sur le
          // nom BRUT et masquerait les fiches jumelles, donc l'ambiguïté que la
          // liste doit précisément montrer. `indexerCatalogue` dédoublonne, lui,
          // sur la clé d'IDENTITÉ — la même que le serveur.
          const AS = ArticleSelect;
          const articleIndex = AS ? AS.indexerCatalogue(catalogueArticles) : null;
          /**
           * Le catalogue est-il RÉELLEMENT connu ?
           *
           * ⚠️ SANS CETTE GARDE, LE LOT ENFERME LE MAGASINIER SUR LE TERRAIN.
           * `list-articles` (1 019 fiches) est chargé en `useEffect` avec un
           * `.catch(()=>{})` : sur une 3G qui saute, l'appel part en timeout,
           * l'échec est avalé, et `catalogueArticles` reste vide. L'index est
           * alors vide, TOUT devient `inconnu`, et un article qui EXISTE se
           * voit refuser — avec un message invitant à demander sa création.
           * Le magasinier envoie une demande pour un article déjà au
           * catalogue, et son bon, qui passait la veille, ne passe plus.
           *
           * Catalogue inconnu ⇒ ON NE FILTRE PAS. Le serveur refuse déjà en
           * fail-closed (`identiteArticle`, #362, en production) : ce filtre
           * rend le refus rare, il ne le remplace pas — et il ne doit surtout
           * pas en inventer un que le serveur n'aurait pas prononcé.
           *
           * Un catalogue VRAIMENT vide donnerait le même résultat, et c'est
           * sans conséquence : il n'y aurait alors aucun article à saisir.
           */
          const catalogueConnu = !!(articleIndex && articleIndex.entrees.length);
          /** Verdict de la ligne : `choisi` | `en_cours` | `inconnu` | `ambigu` | `vide`. */
          const verdictArticle = (nom) => (AS && catalogueConnu ? AS.verdictChoix(articleIndex, nom) : null);
          // --- CONVERSION D'UNITÉ (lib/uniteConsoUtils) ----------------------
          // Un article peut être stocké au KG et dosé au L (acide nitrique :
          // 1 L = 1,32 KG). L'unité n'est donc plus un choix libre, et la
          // quantité réellement déduite du stock est montrée à la saisie.
          // Lib absente (script non chargé) → tout retombe sur le comportement
          // d'avant, aucun écran ne casse.
          const UCU = UniteConsoUtils;
          const uniteIndex = UCU ? UCU.indexerArticles(catalogueArticles) : null;
          /** Fiche de conversion d'un article, ou null (inconnu / doublons en désaccord). */
          const ficheConversion = (nom) => (UCU && uniteIndex ? UCU.trouverArticle(uniteIndex, nom) : null);
          /** Unités que le magasinier a le droit de choisir pour cette ligne. */
          const unitesPourArticle = (nom) => (UCU ? UCU.unitesSaisissables(ficheConversion(nom)) : []);
          /**
           * Unité EFFECTIVE d'une ligne : celle qui est affichée ET envoyée.
           * Un brouillon restauré (ou un bon scanné) peut porter « kg » quand
           * la fiche écrit « KG » : sans ce rapprochement, le <select>
           * afficherait la première option pendant que l'état en garde une
           * autre — l'écran et l'envoi diraient deux choses différentes.
           *
           * ⚠️ Une unité qui ne correspond à AUCUNE unité permise est gardée
           * TELLE QUELLE, jamais remplacée en douce par l'unité de stock : la
           * ligne serait déduite d'une quantité que personne n'a saisie. Elle
           * reste proposée dans le sélecteur et la ligne est signalée comme
           * non convertible — c'est exactement le cas que le filet doit
           * attraper.
           */
          const uniteEffective = (it) => {
              const permises = unitesPourArticle(it.article);
              if (!permises.length) return it.unite;
              const match = permises.filter(u => UCU.normaliserUnite(u) === UCU.normaliserUnite(it.unite))[0];
              return match || it.unite;
          };
          /** Options du sélecteur d'unité d'une ligne (cf. uniteEffective). */
          const optionsUnite = (it) => {
              const permises = unitesPourArticle(it.article);
              if (!permises.length) {
                  // Article inconnu du catalogue : on ne sait rien de lui, la
                  // liste générique reste (sinon la ligne est insaisissable).
                  return [...new Set(['kg', 'L', 'unité', 'carton', 'sac', 'bidon', ...(it.unite ? [it.unite] : [])])];
              }
              const eff = uniteEffective(it);
              return permises.indexOf(eff) >= 0 ? permises : [...permises, eff];
          };
          /** Verdict de conversion d'une ligne (null si la lib n'est pas chargée). */
          const verdictLigne = (it) => (UCU
              ? UCU.convertirQuantite({ article: it.article, quantite: it.quantite, unite: uniteEffective(it) }, ficheConversion(it.article))
              : null);
          const suggestRef = (nom) => 'ART-' + (nom || '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
          const openCreateArticle = (lineIdx, prefillNom) => {
              const nom = (prefillNom || '').trim();
              setNewArticle({ reference: nom ? suggestRef(nom) : '', nom, unite: 'kg', categorie: 'autre', taux_tva: 20 });
              setCreateArticleLineIdx(typeof lineIdx === 'number' ? lineIdx : null);
              setShowCreateArticle(true);
          };
          // Le magasinier n'a pas le droit de créer une fiche (canCreateArticle
          // = achats | dg). Depuis le refus fail-closed du résolveur d'identité,
          // le laisser sans issue reviendrait à bloquer sa saisie sans recours :
          // il peut donc DEMANDER la création, et le DG crée l'article depuis
          // son écran Catalogue. Le serveur dédoublonne les demandes.
          const [demandeArticleEnCours, setDemandeArticleEnCours] = useState('');
          const [demandesEnvoyees, setDemandesEnvoyees] = useState([]);
          const demanderCreationArticle = async (nom) => {
              const libelle = (nom || '').trim();
              if (!libelle || demandeArticleEnCours) return;
              setDemandeArticleEnCours(libelle);
              try {
                  const r = await fetch('/api/stock?action=request-article-creation', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ libelle, origine: 'bon_consommation' }),
                  });
                  const j = await r.json();
                  if (j.success) {
                      setDemandesEnvoyees(prev => prev.includes(libelle) ? prev : [...prev, libelle]);
                      alert(j.message || ('Demande de création envoyée au DG pour « ' + libelle + ' ».'));
                  } else {
                      alert(j.error || 'La demande de création n\'a pas pu être envoyée.');
                  }
              } catch (e) {
                  alert('La demande de création n\'a pas pu être envoyée : ' + e.message);
              } finally {
                  setDemandeArticleEnCours('');
              }
          };
          const handleCreateArticle = async () => {
              if (!newArticle.nom.trim() || !newArticle.reference.trim()) return alert('Le nom et la référence sont requis');
              setCreatingArt(true);
              try {
                  const r = await fetch('/api/stock?action=create-article', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...newArticle, created_by: { profileId: currentProfile, name: profileData?.name || currentProfile } }) });
                  const j = await r.json();
                  if (j.success) {
                      const listR = await fetch('/api/stock?action=list-articles');
                      const listJ = await listR.json();
                      // Liste COMPLÈTE (cf. le chargement initial) : dédoublonner ici
                      // rendrait à nouveau le front aveugle aux fiches jumelles.
                      if (listJ.success) { setCatalogueArticles(listJ.articles||[]); }
                      if (createArticleLineIdx != null) {
                          const li = createArticleLineIdx;
                          const items = [...form.items];
                          items[li] = { ...items[li], article: newArticle.nom, unite: (newArticle.unite || 'kg').toLowerCase() };
                          setForm({ ...form, items });
                      }
                      setShowCreateArticle(false);
                      setCreateArticleLineIdx(null);
                      setNewArticle({ reference: '', nom: '', unite: 'kg', categorie: 'autre', taux_tva: 20 });
                  } else { alert(j.error || 'Erreur lors de la création'); }
              } catch (e) { alert('Erreur réseau'); }
              setCreatingArt(false);
          };

          // --- Renseigner la conversion d'unité d'un article ------------------
          // Le magasinier n'a PAS accès à Stock › Articles, et c'est pourtant
          // lui qui sait qu'un fût de 25 L d'acide nitrique pèse 33 kg. Le
          // serveur (`update-article`) ne lui ouvre que ces DEUX champs et
          // décide sur le contenu réel d'`updates` : ce bouton n'est donc pas
          // la sécurité, juste le chemin.
          const canSetConversion = currentProfile === 'magasinier' || currentProfile === 'achats' || currentProfile === 'dg';
          /**
           * TOUTES les fiches actives portant ce nom. Le catalogue porte ~105
           * paires de jumelles : n'en corriger qu'une laisse les deux fiches en
           * désaccord, donc l'article ambigu, donc TOUJOURS pas converti — la
           * réparation paraîtrait sans effet. Lit la liste COMPLÈTE, jamais la
           * liste d'affichage (dédoublonnée).
           */
          const fichesDuNom = (nom) => {
              const cible = UCU ? UCU.canonNom(nom) : (nom || '').trim().toLowerCase();
              return catalogueArticles.filter(a => (UCU ? UCU.canonNom(a.nom) : (a.nom || '').trim().toLowerCase()) === cible);
          };
          const openConversion = (nom) => {
              const fiches = fichesDuNom(nom);
              // Pré-remplissage depuis la PREMIÈRE fiche : quand les jumelles se
              // contredisent, il faut bien en proposer une. L'enregistrement
              // écrit ensuite la MÊME valeur sur toutes, ce qui lève le désaccord.
              const f = fiches[0] || {};
              setConversionArticle({ nom: nom, unite_stock: (f.unite || '').trim(), ids: fiches.map(a => a.id).filter(Boolean) });
              setConversionForm({
                  unite_consommation: (f.unite_consommation || '').trim(),
                  stock_par_unite_consommation: (f.stock_par_unite_consommation === null || f.stock_par_unite_consommation === undefined) ? '' : String(f.stock_par_unite_consommation),
              });
              setConversionError('');
          };
          const saveConversion = async () => {
              if (!conversionArticle) return;
              const uc = (conversionForm.unite_consommation || '').trim();
              const facteur = UCU ? UCU.lireFacteur(conversionForm.stock_par_unite_consommation) : null;
              // Une unité de consommation sans facteur ne convertit rien : on
              // refuse ICI plutôt que d'écrire une fiche qui laisserait croire
              // à une conversion inexistante.
              if (uc && UCU && UCU.normaliserUnite(uc) !== UCU.normaliserUnite(conversionArticle.unite_stock) && facteur === null) {
                  setConversionError('Indiquez combien vaut 1 ' + uc + ' en ' + (conversionArticle.unite_stock || 'unité de stock') + ' (nombre supérieur à 0).');
                  return;
              }
              if (!conversionArticle.ids.length) {
                  setConversionError('Aucune fiche catalogue pour « ' + conversionArticle.nom +' ».');
                  return;
              }
              setConversionSaving(true);
              setConversionError('');
              try {
                  // Les DEUX champs, et rien d'autre : y joindre un champ de plus
                  // ferait refuser TOUTE la requête au magasinier (garde serveur).
                  // Toutes les fiches homonymes sont mises à jour — n'en corriger
                  // qu'une laisserait la conversion ambiguë, donc inopérante.
                  const updates = { unite_consommation: uc, stock_par_unite_consommation: uc ? facteur : null };
                  for (const id of conversionArticle.ids) {
                      const r = await fetch('/api/stock?action=update-article', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ id, updates, updated_by: { profileId: currentProfile, name: profileData?.name || currentProfile } }) });
                      const j = await r.json();
                      if (!j.success) { setConversionError(j.error || 'Échec de l\'enregistrement'); setConversionSaving(false); return; }
                  }
                  const listJ = await fetch('/api/stock?action=list-articles').then(r => r.json());
                  if (listJ.success) { setCatalogueArticles(listJ.articles || []); }
                  setConversionArticle(null);
              } catch (e) {
                  setConversionError('Erreur réseau');
              }
              setConversionSaving(false);
          };

          const filteredParcelles = parcelles;
          const bcCampagneToday = bcCampagneOf(new Date().toISOString().slice(0, 10));
          const campagnePrecedente = (() => { const y = parseInt(bcCampagneToday.slice(0, 4), 10) - 1; return y + '-' + (y + 1); })();
          const useConsoSelector = currentProfile === 'magasinier' && (refParcelles.courante.length > 0 || refParcelles.precedente.length > 0);
          const bcCampagnesDispo = [
              ...(refParcelles.courante.length > 0 ? [bcCampagneToday] : []),
              ...(refParcelles.precedente.length > 0 ? [campagnePrecedente] : []),
          ];
          if (!bcCampagnesDispo.length) bcCampagnesDispo.push(bcCampagneToday);
          const refForCampagne = bcCampagne === bcCampagneToday ? refParcelles.courante : refParcelles.precedente;
          const sbMap = sbRefMap;
          // Nom affiché d'une parcelle = nom_sb du référentiel RH s'il existe,
          // sinon le libellé BEE ONE. La VALEUR envoyée au backend reste toujours
          // le libellé BEE ONE (clé de jointure stock / analytique).
          const sbEntryOf = (label) => sbMap[(label || '').toUpperCase().trim()];
          const parcelleNom = (label) => { const e = sbEntryOf(label); return (e && e.nom_sb) ? e.nom_sb : (label || ''); };
          // Culture affichée = culture_sb du référentiel si définie, sinon la culture BEE ONE.
          const parcelleCulture = (label, fallback) => { const e = sbEntryOf(label); return (e && e.culture_sb) ? e.culture_sb : (fallback || ''); };
          // Culture/ferme d'un libellé de parcelle, quelle que soit la source du select.
          const metaForParcelle = (label) => {
              const ref = refForCampagne.find(p => p.label === label);
              if (ref) return { culture: parcelleCulture(label, ref.culture), ferme: ref.ferme || '' };
              const parc = parcelles.find(p => p.Parcelle_Physique === label);
              return { culture: parcelleCulture(label, parc?.Culture), ferme: parc?.Ferme || '' };
          };
          // Valeur unique parmi les membres d'un groupe, sinon '' (groupe à cheval
          // sur deux cultures/fermes → on ne devine pas).
          const uniqueMemberMeta = (groupe, field) => {
              const vals = [...new Set((groupe.membres || []).map(m => metaForParcelle(m.label)[field]).filter(Boolean))];
              return vals.length === 1 ? vals[0] : '';
          };
          // --- Filtre Culture (global au bon) -------------------------------
          // Référentiel Smart Berry lu AU RENDU : sbLoad() est asynchrone au boot
          // (bootstrap), un useState initial figerait un objet vide.
          // Défensif : lib absente → on ne filtre rien (comportement actuel).
          const cultureOk = (parcelle, filtre) => {
              const CU = CultureUtils;
              if (!CU || !filtre) return true;
              return CU.matchesCulture(parcelle, filtre, sbMap);
          };
          // Un membre de groupe n'a qu'un `label` : on lui rattache la culture
          // connue du référentiel de saisie avant de résoudre.
          const groupeOk = (groupe, filtre) => {
              if (!filtre || !CultureUtils) return true;
              // Groupe à cheval sur deux cultures : proposé si AU MOINS un membre
              // matche (même prudence que uniqueMemberMeta : on ne devine pas).
              return (groupe.membres || []).some(m => cultureOk({ label: m.label, culture: metaForParcelle(m.label).culture }, filtre));
          };
          const refForCampagneCulture = refForCampagne.filter(p => cultureOk(p, bcCulture));
          const filteredParcellesCulture = filteredParcelles.filter(p => cultureOk(p, bcCulture));
          const parcelleGroupesCulture = parcelleGroupes.filter(g => groupeOk(g, bcCulture));
          const aucuneParcellePourCulture = !!bcCulture
              && parcelleGroupesCulture.length === 0
              && (useConsoSelector ? refForCampagneCulture.length : filteredParcellesCulture.length) === 0;
          // Changement de culture : les lignes dont la destination sort de la
          // liste filtrée perdent leur parcelle (article/qté/unité intacts).
          const changeBcCulture = (val) => {
              setBcCulture(val);
              // '' = plus de filtre (rien ne devient invalide) ; lib absente = pas de filtre du tout.
              if (!val || !CultureUtils) return;
              const items = form.items.map(it => {
                  if (!it.parcelle && !it.groupe_id) return it;
                  let keep;
                  if (it.groupe_id) {
                      const g = parcelleGroupes.find(x => x.id === it.groupe_id);
                      keep = !!g && groupeOk(g, val);
                  } else {
                      const src = useConsoSelector
                          ? refForCampagne.find(p => p.label === it.parcelle)
                          : filteredParcelles.find(p => p.Parcelle_Physique === it.parcelle);
                      keep = !!src && cultureOk(src, val);
                  }
                  return keep ? it : { ...it, parcelle: '', parcelle_ref: '', culture: '', ferme: '', groupe_id: '' };
              });
              setForm({ ...form, items });
          };

          const selectParcelleForItem = (idx, val) => {
              const items = [...form.items];
              if ((val || '').startsWith('GRP::')) {
                  // Parcelle combinée : on ne pose que le libellé du groupe +
                  // groupe_id. L'éclatement en parcelles réelles est fait par le
                  // backend (create-bc), au prorata des Ha du référentiel SB.
                  const g = parcelleGroupes.find(x => x.id === val.slice(5));
                  items[idx] = { ...items[idx], parcelle: g ? g.label : '', parcelle_ref: '', groupe_id: g ? g.id : '', culture: g ? uniqueMemberMeta(g, 'culture') : '', ferme: g ? uniqueMemberMeta(g, 'ferme') : '' };
                  setForm({ ...form, items });
                  return;
              }
              const ref = refForCampagne.find(p => p.label === val);
              if (ref) {
                  items[idx] = { ...items[idx], parcelle: val, parcelle_ref: ref.ref || '', culture: parcelleCulture(val, ref.culture), ferme: ref.ferme || '', groupe_id: '' };
              } else {
                  const parc = parcelles.find(p => p.Parcelle_Physique === val);
                  items[idx] = { ...items[idx], parcelle: val, parcelle_ref: '', culture: parcelleCulture(val, parc?.Culture), ferme: parc?.Ferme || '', groupe_id: '' };
              }
              setForm({ ...form, items });
          };

          const updateItem = (idx, field, value) => { const items = [...form.items]; items[idx] = { ...items[idx], [field]: value }; setForm({ ...form, items }); };
          const addItem = () => setForm({ ...form, items: [...form.items, { ...emptyItem }] });
          const removeItem = (idx) => { if (form.items.length > 1) setForm({ ...form, items: form.items.filter((_, i) => i !== idx) }); };
          const getStock = (article) => { const s = stocks.find(x => x.article === article); return s ? s.stock : 0; };

          const uploadScanBC = async (base64) => {
              if (!base64) return null;
              const res = await fetch('/api/stock?action=upload-scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file_base64: base64, filename: 'scan_bc.jpg', contentType: 'image/jpeg' }) });
              const json = await res.json();
              return json.success ? json.url : null;
          };

          const handleCreate = async () => {
              const validItems = form.items.filter(i => i.article && i.quantite);
              if (!validItems.length) { alert('Ajoutez au moins un article'); return; }
              // --- SÉLECTION FERMÉE : on ne valide QUE des articles du catalogue.
              // La décision vient du module pur, jamais d'une comparaison de
              // libellés écrite ici — elle divergerait du serveur, et le
              // magasinier verrait un bon accepté à l'écran puis rejeté.
              //
              // ⚠️ CE N'EST PAS LA GARDE QUI FAIT FOI. Le scan de bon
              // (MagBCScanModal) et les appels directs à l'API n'empruntent pas
              // ce champ : `create-bc` refuse toujours de son côté
              // (identiteArticle + uniteFigee). Ce filtre rend le refus rare,
              // il ne le remplace pas.
              // `catalogueConnu` : un catalogue non chargé (3G qui saute) ne
              // doit JAMAIS faire refuser un article qui existe. Cf. le pavé
              // de `catalogueConnu` plus haut.
              if (AS && catalogueConnu) {
                  const fautives = AS.lignesInvalides(validItems, articleIndex);
                  if (fautives.length) {
                      alert('Ce bon ne peut pas être enregistré :\n\n'
                          + fautives.map(f => '• ' + f.message).join('\n\n')
                          + '\n\nChoisissez chaque article dans la liste déroulante.');
                      return;
                  }
              }
              for (const it of validItems) {
                  if (!it.parcelle) { alert('Parcelle requise pour l\'article ' + it.article); return; }
              }
              for (const it of validItems) {
                  const dispo = getStock(it.article);
                  if (parseFloat(it.quantite) > dispo) {
                      if (!confirm('Stock insuffisant pour ' + it.article + ' (dispo: ' + dispo + '). Continuer quand meme ?')) return;
                  }
              }
              let scanUrl = null;
              if (scanFileBC) { scanUrl = await uploadScanBC(scanFileBC); }
              // `type` envoyé tel quel, vide compris : le défaut est posé
              // côté serveur (create-bc). Un repli muet ici a produit
              // 48 bons /48 en « engrais » et un onglet Pesticides vide ;
              // la classification vient désormais de l'article, pas du bon.
              return postBc(validItems, scanUrl, false);
          };

          /**
           * Envoi effectif de `create-bc`. `force` n'est PAS un détail de
           * signature : c'est l'échappatoire du magasinier face à la garde
           * anti-doublon. Un refus 409 ouvre la fenêtre de doublon au lieu
           * d'un `alert` brut — sinon le magasinier est dans une impasse,
           * bloqué par un message qui ne nomme même pas le bon fautif.
           */
          const postBc = (validItems, scanUrl, force) => {
              const by = { profileId: currentProfile, name: profileData?.name || currentProfile };
              // `uniteEffective` : on envoie l'unité RÉELLEMENT affichée dans le
              // sélecteur. Envoyer `i.unite` brut ferait diverger l'écran de
              // l'envoi sur un brouillon restauré (« kg » affiché « KG »), et la
              // conversion serveur ne s'appliquerait pas au même intitulé.
              const payload = { type: type || '', date: form.date, lieu_source: { type: form.lieu_source_type, id: form.lieu_source_id }, items: validItems.map(i => ({ article: i.article, quantite: i.quantite, unite: uniteEffective(i), parcelle: i.parcelle, parcelle_ref: i.parcelle_ref || '', culture: i.culture, ferme: i.ferme, groupe_id: i.groupe_id || '' })), scan_url: scanUrl, authorized_by: by, created_by: by };
              // Drapeau envoyé UNIQUEMENT sur forçage explicite : présent à
              // chaque appel, il neutraliserait la garde en permanence.
              if (force) payload.force_doublon = true;
              return fetch('/api/stock?action=create-bc', { method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload),
              }).then(r => r.json()).then(json => {
                  if (json.success) {
                      setDoublonBc(null);
                      // Le serveur renvoie les lignes qu'il n'a PAS su convertir :
                      // le bon est créé (on ne bloque pas), mais le magasinier doit
                      // l'apprendre tout de suite, article et unités nommés.
                      const nonConv = json.lignes_non_convertibles || [];
                      const avis = nonConv.length
                          ? '\n\nAttention — ' + nonConv.length + ' ligne(s) déduites sans conversion :\n'
                              + nonConv.map(l => '• ' + l.article + ' : ' + l.quantite + ' ' + (l.unite_saisie || '?')
                                  + ' retirés d\'un stock tenu en ' + (l.unite_stock || '?')).join('\n')
                              + '\nRenseignez la conversion sur la fiche de ces articles.'
                          : '';
                      alert('Bon de consommation ' + json.numero + ' cree' + avis); clearBcDraft(); setShowForm(false); loadBcs();
                      return;
                  }
                  if (json.doublon) {
                      // On mémorise de quoi REJOUER l'envoi tel quel : re-dériver
                      // les items au moment du forçage risquerait d'envoyer autre
                      // chose que ce que le serveur a jugé doublon.
                      setDoublonBc({ ...json.doublon, message: json.error || '', items: validItems, scan_url: scanUrl });
                      return;
                  }
                  setDoublonBc(null);
                  alert('Erreur: ' + (json.error || 'Echec'));
              }).catch(() => alert('Erreur reseau'));
          };

          const forcerCreationDoublon = () => {
              if (!doublonBc) return;
              return postBc(doublonBc.items || [], doublonBc.scan_url || null, true);
          };

          // --- Suppression d'un bon de consommation ---------------------------
          // Ouverte à `magasinier`, `achats` et `dg` : le serveur (delete-bc)
          // refuse les autres, un bouton visible pour eux ne mènerait qu'à un
          // 403. Supprimer un bon ANNULE l'impact stock de ses mouvements :
          // les quantités reviennent en stock. Le motif est exigé ICI aussi,
          // pour ne pas envoyer une requête qui échouera de toute façon.
          const canDeleteBc = currentProfile === 'magasinier' || currentProfile === 'achats' || currentProfile === 'dg';
          // Le magasinier supprime SON PROPRE bon, dans le flux de saisie et
          // souvent sur mobile : c'est le seul profil chez qui le geste risque
          // d'être machinal. Une seconde étape lui est donc imposée — et à lui
          // seul, `achats`/`dg` gardant le parcours d'origine.
          //
          // ⚠️ PROTECTION D'INTERFACE, PAS DE SÉCURITÉ. Le serveur ne sait rien
          // de cette étape et ne doit jamais en dépendre : il valide le rôle
          // (résolu depuis le jeton) et le motif, un point c'est tout. Aucun
          // drapeau « double_confirmation » n'est envoyé — il serait usurpable
          // et ne donnerait qu'une fausse impression de sûreté.
          const deleteDoubleConfirm = currentProfile === 'magasinier';
          const openDeleteBc = (bc) => { setDeleteBc(bc); setDeleteMotif(''); setDeleteError(''); setDeleteConfirmBc(null); setDeleteNumeroSaisi(''); };
          const closeDeleteBc = () => { setDeleteBc(null); setDeleteError(''); setDeleteConfirmBc(null); setDeleteNumeroSaisi(''); };
          const closeDeleteConfirm = () => { setDeleteConfirmBc(null); setDeleteNumeroSaisi(''); setDeleteError(''); };
          const deleteMotifValide = (deleteMotif || '').trim().length >= 3;
          // Numéro attendu à la seconde étape. Comparaison STRICTE : ni trim,
          // ni casse ignorée. Un « bc-0001 » ou un « BC-0001 » collé avec une
          // espace passeraient distraitement, ce qui viderait le geste de son
          // sens. Un bon sans numéro ne peut PAS être confirmé (chaîne vide
          // == chaîne vide serait vrai, et le bouton s'activerait tout seul).
          const deleteNumeroAttendu = (deleteConfirmBc && deleteConfirmBc.numero) || '';
          const deleteNumeroOk = deleteNumeroAttendu !== '' && deleteNumeroSaisi === deleteNumeroAttendu;
          const deleteLignes = (deleteConfirmBc && (deleteConfirmBc.items || []).length) || 0;
          /**
           * Première étape validée. Pour `achats`/`dg` c'est l'envoi direct ;
           * pour le magasinier, cela n'ouvre QUE la seconde fenêtre — aucune
           * requête n'est émise à ce stade.
           */
          const nextDeleteStep = () => {
              if (!deleteBc) return;
              if (!deleteMotifValide) { setDeleteError('Motif obligatoire (3 caractères minimum)'); return; }
              if (!deleteDoubleConfirm) return submitDeleteBc();
              setDeleteError('');
              setDeleteNumeroSaisi('');
              setDeleteConfirmBc(deleteBc);
          };
          const submitDeleteBc = async () => {
              if (!deleteBc) return;
              if (!deleteMotifValide) { setDeleteError('Motif obligatoire (3 caractères minimum)'); return; }
              setDeleteSaving(true);
              setDeleteError('');
              try {
                  const r = await fetch('/api/stock?action=delete-bc', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ bc_id: deleteBc.id, motif: deleteMotif.trim() }),
                  });
                  const j = await r.json();
                  if (!j.success) {
                      // Message serveur affiché TEL QUEL (403, bon introuvable,
                      // déjà supprimé…) — jamais reformulé côté client.
                      setDeleteError(j.error || 'Échec de la suppression');
                      setDeleteSaving(false);
                      return;
                  }
                  setDeleteConfirmBc(null);
                  setDeleteNumeroSaisi('');
                  setDeleteBc(null);
                  setDetailBc(null);
                  loadBcs();
              } catch (e) {
                  setDeleteError('Erreur réseau');
              }
              setDeleteSaving(false);
          };

          // --- Modification de la date d'un bon existant ----------------------
          // Réservé au magasinier (même conditionnement que « Nouveau bon »).
          // Exclus : les lignes VIRTUELLES issues de mouvements sans bc_id
          // (id 'mov_…' : aucun document consumption_vouchers à modifier) et
          // les bons importés (convention repo : un import ne s'édite pas).
          const canEditBcDate = currentProfile === 'magasinier';
          const isEditableBc = (bc) => !!bc && !String(bc.id || '').startsWith('mov_') && !isImportBC(bc);
          const openEditDate = (bc) => { setEditDateBc(bc); setEditDateValue(bc.date || ''); setEditDateError(''); };
          const closeEditDate = () => { setEditDateBc(null); setEditDateError(''); };
          // Avertissement AVANT validation : un basculement de campagne
          // (année fiscale Juillet→Juin) fausserait les analyses sans que
          // personne ne le voie. bcCampagneOf est la source unique.
          const editDateCampagne = (() => {
              const from = bcCampagneOf(editDateBc && editDateBc.date);
              const to = bcCampagneOf(editDateValue);
              return { from, to, changed: !!from && !!to && from !== to };
          })();
          const submitEditDate = async () => {
              if (!editDateBc || !editDateValue) { setEditDateError('Choisissez une date'); return; }
              setEditDateSaving(true);
              setEditDateError('');
              try {
                  const r = await fetch('/api/stock?action=update-bc-date', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ bc_id: editDateBc.id, date: editDateValue }),
                  });
                  const j = await r.json();
                  if (!j.success) {
                      // Erreur serveur affichée TELLE QUELLE (date future, bon
                      // introuvable, 403…) — jamais reformulée côté client.
                      setEditDateError(j.error || 'Échec de la modification');
                      setEditDateSaving(false);
                      return;
                  }
                  setEditDateBc(null);
                  setDetailBc(null);
                  loadBcs();
              } catch (e) {
                  setEditDateError('Erreur réseau');
              }
              setEditDateSaving(false);
          };

          if (loading) return React.createElement('div', {className:'fade-in',style:{textAlign:'center',padding:60}}, React.createElement('i', {className:'fa-solid fa-spinner fa-spin',style:{fontSize:32,color:'var(--berry)'}}));

          const matchesBC = (bc) => {
              if (dateFrom && bc.date && bc.date < dateFrom) return false;
              if (dateTo && bc.date && bc.date > dateTo) return false;
              if (filterSource === 'import' && !isImportBC(bc)) return false;
              if (filterSource === 'saisie' && isImportBC(bc)) return false;
              if (!query) return true;
              const q = query.toLowerCase();
              return (bc.numero||'').toLowerCase().includes(q)
                  || (bc.items||[]).some(i => (i.article||'').toLowerCase().includes(q) || (i.parcelle||'').toLowerCase().includes(q) || parcelleNom(i.parcelle).toLowerCase().includes(q))
                  || (bc.ferme||'').toLowerCase().includes(q);
          };
          const sortValueBC = (bc, field) => {
              if (field === 'numero') return bc.numero || '';
              if (field === 'date') return bc.date || '';
              if (field === 'parcelles') return [...new Set((bc.items||[]).map(i => parcelleNom(i.parcelle)).filter(Boolean))].join(',');
              if (field === 'fermes') return [...new Set((bc.items||[]).map(i => i.ferme).filter(Boolean))].join(',') || (bc.ferme || '');
              if (field === 'cree_par') return bc.created_by?.name || '';
              return '';
          };
          const filteredBcs = bcs.filter(matchesBC).slice().sort((a, b) => {
              const va = sortValueBC(a, sortField), vb = sortValueBC(b, sortField);
              if (va < vb) return sortDir === 'asc' ? -1 : 1;
              if (va > vb) return sortDir === 'asc' ? 1 : -1;
              // Tie-break par numéro pour garder les lignes d'un même bon groupées
              const na = a.numero || '', nb = b.numero || '';
              if (na < nb) return sortDir === 'asc' ? -1 : 1;
              if (na > nb) return sortDir === 'asc' ? 1 : -1;
              return 0;
          });
          const lieuSourceOf = (bc) => (bc.lieu_source && bc.lieu_source.id) || bc.lieu_source_id || '—';
          const toggleSort = (field) => {
              if (sortField === field) setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
              else { setSortField(field); setSortDir('asc'); }
          };
          const sortArrow = (field) => sortField === field ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';
          const sortThStyle = { cursor: 'pointer', userSelect: 'none' };

          const exportBcExcel = () => {
              if (!filteredBcs.length) { alert('Aucun bon à exporter'); return; }
              const aoa = [['N° Bon', 'Date', 'Lieu départ', 'Ferme', 'Parcelle', 'Article', 'Quantité', 'Unité', 'Culture', 'Créé par']];
              filteredBcs.forEach(bc => {
                  const lieuDepart = bc.lieu_source?.id || bc.lieu_source_id || '—';
                  const creePar = bc.created_by?.name || '';
                  const items = bc.items || [];
                  if (!items.length) {
                      aoa.push([bc.numero || '', bc.date || '', lieuDepart, bc.ferme || '', '', '', '', '', '', creePar]);
                  } else {
                      items.forEach(i => {
                          aoa.push([
                              bc.numero || '',
                              bc.date || '',
                              lieuDepart,
                              i.ferme || bc.ferme || '',
                              parcelleNom(i.parcelle) || '',
                              i.article || '',
                              i.quantite != null ? i.quantite : '',
                              i.unite || '',
                              i.culture || '',
                              creePar,
                          ]);
                      });
                  }
              });
              const ws = XLSX.utils.aoa_to_sheet(aoa);
              const wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, ws, 'Bons de Consommation');
              XLSX.writeFile(wb, 'Bons_Consommation_' + new Date().toISOString().slice(0, 10) + '.xlsx');
          };

          return (
              <div className="fade-in">
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
                      <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
                          <h3 style={{margin:0}}><i className={'fa-solid ' + icon} style={{marginRight:8}}></i>Bons de Consommation {label} ({filteredBcs.length})</h3>
                          <button onClick={exportBcExcel} title="Exporter la liste filtrée en Excel"
                              style={{background:'#1d6f42',color:'#fff',border:'none',borderRadius:8,padding:'7px 14px',cursor:'pointer',fontWeight:600,fontSize:12}}>
                              <i className="fa-solid fa-file-excel" style={{marginRight:6}}></i>Export Excel
                          </button>
                      </div>
                      <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                          <input type="search" placeholder="Rechercher (n°, article, parcelle…)" value={query} onChange={e => setQuery(e.target.value)} style={{padding:'6px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:12,minWidth:240}} />
                          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="Date début" style={{padding:'6px 8px',borderRadius:8,border:'1px solid #ddd',fontSize:12}} />
                          <span style={{fontSize:11,color:'var(--gray-400)'}}>→</span>
                          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} title="Date fin" style={{padding:'6px 8px',borderRadius:8,border:'1px solid #ddd',fontSize:12}} />
                          <select value={filterSource} onChange={e => setFilterSource(e.target.value)} title="Source" style={{padding:'6px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:12}}>
                              <option value="">Toutes sources</option>
                              <option value="saisie">Saisie</option>
                              <option value="import">Import</option>
                          </select>
                          {currentProfile === 'magasinier' && <button onClick={() => setShowScan(true)} title="Déposer des photos de bons papier"
                              style={{background:'#e65100',color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',cursor:'pointer',fontWeight:600,fontSize:13}}>
                              <i className="fa-solid fa-camera" style={{marginRight:6}}></i>Scanner des bons
                          </button>}
                          {currentProfile === 'magasinier' && <button onClick={() => { clearBcDraft(); setForm({ date: new Date().toISOString().split('T')[0], lieu_source_type: 'magasin', lieu_source_id: 'F1', items: [{ ...emptyItem }] }); setBcCulture(''); setShowForm(true); }}
                              style={{background:'var(--berry)',color:'#fff',border:'none',borderRadius:8,padding:'8px 16px',cursor:'pointer',fontWeight:600,fontSize:13}}>
                              <i className="fa-solid fa-plus" style={{marginRight:6}}></i>Nouveau bon
                          </button>}
                      </div>
                  </div>
                  <div className="table-responsive"><table className="data-table">
                      <thead><tr>
                          <th style={sortThStyle} onClick={() => toggleSort('numero')}>N° bon{sortArrow('numero')}</th>
                          <th style={sortThStyle} onClick={() => toggleSort('date')}>Date{sortArrow('date')}</th>
                          <th>Lieu (départ)</th>
                          <th style={sortThStyle} onClick={() => toggleSort('parcelles')}>Parcelle/Destination{sortArrow('parcelles')}</th>
                          <th>Article</th>
                          <th>Unité</th>
                          <th style={{textAlign:'right'}}>Quantité</th>
                      </tr></thead>
                      <tbody>
                          {filteredBcs.map((bc) => {
                              const lieuDepart = lieuSourceOf(bc);
                              const items = (bc.items && bc.items.length) ? bc.items : [null];
                              return items.map((item, itemIndex) => {
                                  const isFirst = itemIndex === 0;
                                  const rowStyle = {
                                      cursor: 'pointer',
                                      borderTop: isFirst ? '2px solid #e0e0e0' : '1px solid #f3f3f3',
                                  };
                                  return (
                                      <tr key={bc.id + '_' + itemIndex} onClick={() => setDetailBc(bc)} style={rowStyle}
                                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(139,34,82,0.04)'; }}
                                          onMouseLeave={e => { e.currentTarget.style.background = ''; }}>
                                          <td style={{fontWeight:700,color:'var(--berry)',fontSize:12}}>{isFirst ? bc.numero : ''}</td>
                                          <td style={{fontSize:12}}>
                                              {isFirst ? (bc.date || '—') : ''}
                                              {isFirst && canEditBcDate && isEditableBc(bc) && (
                                                  <button onClick={e => { e.stopPropagation(); openEditDate(bc); }} title="Modifier la date du bon"
                                                      style={{marginLeft:6,background:'none',border:'none',cursor:'pointer',color:'var(--berry)',fontSize:11,padding:0}}>
                                                      <i className="fa-solid fa-pen"></i>
                                                  </button>
                                              )}
                                              {isFirst && canDeleteBc && isEditableBc(bc) && (
                                                  <button onClick={e => { e.stopPropagation(); openDeleteBc(bc); }} title="Supprimer le bon"
                                                      style={{marginLeft:6,background:'none',border:'none',cursor:'pointer',color:'#e74c3c',fontSize:11,padding:0}}>
                                                      <i className="fa-solid fa-trash"></i>
                                                  </button>
                                              )}
                                          </td>
                                          <td style={{fontSize:12}}>{isFirst ? lieuDepart : ''}</td>
                                          <td style={{fontWeight:600,fontSize:12}}>{parcelleNom(item ? (item.parcelle || bc.parcelle) : bc.parcelle) || '—'}</td>
                                          <td style={{fontSize:12}}>{item ? (item.article || '—') : '—'}</td>
                                          <td style={{fontSize:12}}>{item ? (item.unite || '—') : '—'}</td>
                                          <td style={{fontSize:12,textAlign:'right'}}>{item && item.quantite != null ? item.quantite : '—'}</td>
                                      </tr>
                                  );
                              });
                          })}
                          {filteredBcs.length === 0 && <tr><td colSpan="7" style={{textAlign:'center',color:'var(--gray-400)',padding:40}}>Aucun bon de consommation {label.toLowerCase()}.</td></tr>}
                      </tbody>
                  </table></div>

                  {/* Modale de scan IA. Garde explicite sur le global : une référence
                      nue crasherait TOUT le tab si le script n'est pas chargé
                      (mémoire tab-bare-global-ref-crash). */}
                  {showScan && MagBCScanModal && React.createElement(MagBCScanModal, {
                      // La modale de scan reçoit la liste d'AFFICHAGE (une entrée par
                      // nom), comme avant ce ticket : son appariement se fait par nom.
                      type, catalogueArticles: catalogueArticlesAffichage, getStock, catalogUnit, refForCampagne, parcelles,
                      parcelleGroupes, parcelleNom, parcelleCulture, metaForParcelle,
                      useConsoSelector, MAGASINS, STATIONS, currentProfile, profileData,
                      // La campagne sélectionnée pilote DÉJÀ refForCampagne : elle
                      // sert aussi de clé aux alias de parcelle mémorisés, pour
                      // qu'un alias appris sur une campagne ne soit jamais
                      // appliqué à la suivante (les parcelles changent).
                      campagne: bcCampagne,
                      onClose: () => setShowScan(false),
                      onCreated: loadBcs,
                  })}

                  {/* Pas de fermeture au clic sur le fond : un clic hors de la fenêtre
                      en cours de saisie perdait tout le brouillon du bon (le formulaire
                      est réinitialisé à la réouverture). Sortie explicite via « Annuler ». */}
                  {showForm && (
                      <div className="modal-overlay">
                          <div className="modal-content" style={{maxWidth:800,maxHeight:'90vh',overflowY:'auto'}}>
                              <h3 style={{marginTop:0,color:'var(--berry)'}}><i className={'fa-solid ' + icon} style={{marginRight:8}}></i>Nouveau Bon de Consommation {label}</h3>
                              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:16}}>
                                  <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Lieu de départ *</label>
                                      <div style={{display:'flex',gap:6}}>
                                          <select value={form.lieu_source_type} onChange={e => setForm({...form, lieu_source_type: e.target.value, lieu_source_id: e.target.value === 'magasin' ? MAGASINS[0] : STATIONS[0]})} style={{padding:'8px 8px',borderRadius:8,border:'1px solid #ddd',fontSize:12}}>
                                              <option value="magasin">Magasin</option><option value="station">Station</option>
                                          </select>
                                          <select value={form.lieu_source_id} onChange={e => setForm({...form, lieu_source_id: e.target.value})} style={{flex:1,padding:'8px 8px',borderRadius:8,border:'1px solid #ddd',fontSize:12}}>
                                              {(form.lieu_source_type === 'magasin' ? MAGASINS : STATIONS).map(l => <option key={l} value={l}>{l}</option>)}
                                          </select>
                                      </div></div>
                                  <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Date</label>
                                      <input type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} /></div>
                                  {useConsoSelector && (
                                      <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Campagne</label>
                                          <select value={bcCampagne} onChange={e => setBcCampagne(e.target.value)} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                              {bcCampagnesDispo.map(c => <option key={'camp-' + c} value={c}>{c}</option>)}
                                          </select></div>
                                  )}
                                  <div><label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Culture</label>
                                      <select value={bcCulture} onChange={e => changeBcCulture(e.target.value)} style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}}>
                                          <option value="">Toutes les cultures</option>
                                          {((CultureUtils && CultureUtils.CULTURES) || []).map(c => <option key={'cult-' + c} value={c}>{c}</option>)}
                                      </select>
                                      {aucuneParcellePourCulture && <div style={{fontSize:10,color:'#888',marginTop:4}}>Aucune parcelle pour cette culture</div>}</div>
                              </div>
                              <div style={{marginBottom:16}}>
                                  <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}><i className="fa-solid fa-paperclip" style={{marginRight:4}}></i>Scanner le bon de consommation</label>
                                  <input type="file" accept="image/*,application/pdf" onChange={e => { const f = e.target.files[0]; if (f) { if (f.size > 10*1024*1024) { alert('Max 10 Mo'); return; } const r = new FileReader(); r.onload = ev => { setScanFileBC(ev.target.result); setScanPreviewBC(f.type.startsWith('image/') ? ev.target.result : f.name); }; r.readAsDataURL(f); }}} style={{fontSize:12}} />
                                  {scanPreviewBC && (typeof scanPreviewBC === 'string' && scanPreviewBC.startsWith('data:image') ? <img src={scanPreviewBC} alt="Scan" style={{maxHeight:80,marginTop:6,borderRadius:6}} /> : <span style={{fontSize:11,color:'var(--green)',marginLeft:8}}><i className="fa-solid fa-check"></i> Fichier sélectionné</span>)}
                              </div>
                              <h4 style={{fontSize:13,marginBottom:8}}>Articles a consommer</h4>
                              {!catalogueConnu && (
                                  // Le `.catch(()=>{})` du chargement rend la panne INVISIBLE : un
                                  // catalogue vide est indiscernable d'un catalogue réellement vide.
                                  // Sans ce bandeau, le magasinier voit un champ qui ne propose rien
                                  // et n'a aucun moyen de savoir pourquoi. On ne le bloque pas — le
                                  // serveur garde la main — mais on lui dit ce qui se passe.
                                  <div style={{fontSize:11,color:'#8a6d1f',background:'#fdf6e3',border:'1px solid #f0dCa0',
                                      borderRadius:6,padding:'6px 10px',marginBottom:8,lineHeight:1.4}}>
                                      <i className="fa-solid fa-triangle-exclamation" style={{marginRight:5}}></i>
                                      <strong>Liste des articles indisponible</strong> — la recherche ne peut pas
                                      s'afficher. Saisissez le nom exact ; le contrôle se fera à l'enregistrement.
                                      Rechargez la page si le problème persiste.
                                  </div>
                              )}
                              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                  <thead><tr style={{background:'#f8f8f8'}}><th style={{padding:'6px 8px',textAlign:'left'}}>Article</th><th style={{padding:'6px 8px',textAlign:'left',minWidth:140}}>Parcelle dest. *</th><th style={{padding:'6px 8px',width:70}}>Qte</th><th style={{padding:'6px 8px',width:60}}>Unite</th><th style={{padding:'6px 8px',width:70}}>Stock</th><th style={{width:30}}></th></tr></thead>
                                  <tbody>
                                      {form.items.map((it, idx) => { const dispo = getStock(it.article); const insuffisant = it.article && it.quantite && parseFloat(it.quantite) > dispo; return (
                                          <tr key={idx}><td>
                                              {/* SÉLECTION FERMÉE (demande d'Omar). On tape pour filtrer ;
                                                  seule une entrée réelle du catalogue permet de valider le
                                                  bon. La frappe libre reste possible — c'est elle qui nomme
                                                  l'article à faire créer par le DG. */}
                                              <ArticleCombo
                                                  valeur={it.article}
                                                  index={articleIndex}
                                                  getStock={getStock}
                                                  placeholder="Article"
                                                  onSaisir={val => { const items = [...form.items]; items[idx] = { ...items[idx], article: val }; setForm({ ...form, items }); }}
                                                  onChoisir={e => { const items = [...form.items]; const next = { ...items[idx], article: e.nom }; /* L'unité par défaut est celle du STOCK, écrite comme sur la fiche (« KG », pas « kg ») : c'est la valeur des options du sélecteur juste à côté. */ const permises = unitesPourArticle(e.nom); const u = permises.length ? permises[0] : catalogUnit(e.nom); if (u) next.unite = u; items[idx] = next; setForm({ ...form, items }); }}
                                              />
                                              {(() => { const v = (it.article || '').trim();
                                                  // L'issue offerte au magasinier quand ce qu'il tape n'est
                                                  // PAS au catalogue. Sans elle, la sélection fermée
                                                  // l'enfermerait devant une marchandise qu'il a en main.
                                                  //
                                                  // ⚠️ SEUL le cas `inconnu` l'ouvre. Un libellé AMBIGU
                                                  // désigne DEUX fiches actives : le remède est une FUSION,
                                                  // et en créer une troisième aggraverait le catalogue
                                                  // (même arbitrage que `demandeCreationArticle.libellesADemander`).
                                                  const verdict = verdictArticle(v);
                                                  if (!v || !verdict || verdict.issue !== AS.ISSUE_INCONNU) return null;
                                                  // Achats/DG créent la fiche eux-mêmes ; le magasinier la DEMANDE.
                                                  if (canCreateArticle) return (
                                                  <button type="button" onClick={() => openCreateArticle(idx, v)} title="Créer cet article au catalogue" style={{marginTop:3,padding:'2px 6px',borderRadius:5,border:'1px dashed var(--berry)',background:'var(--berry-pale)',color:'var(--berry)',cursor:'pointer',fontSize:10,fontWeight:600,whiteSpace:'nowrap'}}>
                                                      <i className="fa-solid fa-plus" style={{marginRight:3}}></i>Créer « {v.length > 18 ? v.slice(0,18)+'…' : v} »
                                                  </button>
                                                  );
                                                  const envoyee = demandesEnvoyees.includes(v);
                                                  return (
                                                  <button type="button" disabled={envoyee || demandeArticleEnCours === v} onClick={() => demanderCreationArticle(v)} title={envoyee ? 'Demande déjà envoyée au DG' : 'Demander au DG de créer cet article au catalogue'} style={{marginTop:3,padding:'2px 6px',borderRadius:5,border:'1px dashed #e67e22',background:'#fdf3e7',color:'#e67e22',cursor: envoyee ? 'default' : 'pointer',fontSize:10,fontWeight:600,whiteSpace:'nowrap'}}>
                                                      <i className={'fa-solid ' + (envoyee ? 'fa-check' : 'fa-paper-plane')} style={{marginRight:3}}></i>
                                                      {envoyee ? 'Demande envoyée' : 'Demander la création au DG'}
                                                  </button>
                                              ); })()}
                                          </td>
                                          <td>
                                              <select value={it.groupe_id ? ('GRP::' + it.groupe_id) : it.parcelle} onChange={e => selectParcelleForItem(idx, e.target.value)} style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:11}}>
                                                  <option value="">-- Parcelle --</option>
                                                  {parcelleGroupesCulture.length > 0 && (
                                                      <optgroup label="Groupes">
                                                          {parcelleGroupesCulture.map(g => <option key={'grp-' + g.id} value={'GRP::' + g.id}>{g.label} ({(g.membres || []).length} parcelles)</option>)}
                                                      </optgroup>
                                                  )}
                                                  {useConsoSelector ? (
                                                      <React.Fragment>
                                                          <optgroup label="Mes parcelles">
                                                              {refForCampagneCulture.map(p => <option key={'ref-' + p.label} value={p.label}>{parcelleNom(p.label)}</option>)}
                                                          </optgroup>
                                                      </React.Fragment>
                                                  ) : (
                                                      filteredParcellesCulture.map(p => <option key={p.Parcelle_Physique} value={p.Parcelle_Physique}>{parcelleNom(p.Parcelle_Physique)} — {parcelleCulture(p.Parcelle_Physique, p.Culture) || '?'}</option>)
                                                  )}
                                              </select>
                                              {it.ferme && <div style={{fontSize:10,color:'#888',marginTop:2}}>{it.ferme} — {it.culture}</div>}
                                              {it.groupe_id && (() => {
                                                  // Aperçu LECTURE SEULE du split (le calcul qui fait foi est
                                                  // refait côté backend à la création du bon).
                                                  const g = parcelleGroupes.find(x => x.id === it.groupe_id);
                                                  if (!g || !ParcelleGroupUtils) return null;
                                                  const apercu = ParcelleGroupUtils.formatApercu(it.quantite, g.membres || [], it.unite);
                                                  return <div style={{fontSize:10,color:'var(--green)',marginTop:2,fontWeight:600}}>
                                                      <i className="fa-solid fa-object-group" style={{marginRight:4}}></i>
                                                      {apercu || 'Saisir une quantité pour voir la répartition'}
                                                  </div>;
                                              })()}
                                          </td>
                                          <td>
                                              <input type="number" value={it.quantite} onChange={e => updateItem(idx,'quantite',e.target.value)} style={{width:'100%',padding:'4px 8px',borderRadius:6,border: insuffisant ? '2px solid #e74c3c' : '1px solid #ddd',fontSize:12}} />
                                              {(() => {
                                                  // CE QUI SERA RÉELLEMENT DÉDUIT DU STOCK. Sans cette
                                                  // ligne, le magasinier saisit 5 L et ne voit jamais que
                                                  // 6,6 kg quittent le solde.
                                                  const v = verdictLigne(it);
                                                  if (!v || !v.converti) return null;
                                                  return <div style={{fontSize:10,color:'var(--green)',marginTop:2,fontWeight:600}}>
                                                      = {v.quantite_stock} {v.unite_stock} déduits du stock
                                                  </div>;
                                              })()}
                                          </td>
                                          <td>
                                              {/* Le choix d'unité n'est PLUS libre : l'unité de stock de
                                                  l'article et, si elle existe, son unité de consommation
                                                  (cf. optionsUnite). C'est le choix libre qui a produit les
                                                  87 lignes déduites dans la mauvaise unité. */}
                                              <select className="bc-unite-select" value={uniteEffective(it)} onChange={e => updateItem(idx,'unite',e.target.value)} style={{width:'100%',padding:'4px 8px',borderRadius:6,border:'1px solid #ddd',fontSize:12}}>
                                                  {optionsUnite(it).map(u => <option key={u} value={u}>{u}</option>)}
                                              </select>
                                              {(() => {
                                                  // LE FILET. Unité différente de celle du stock et aucune
                                                  // conversion exploitable : on ne bloque pas (décision
                                                  // d'Omar), on NOMME l'article et les deux unités, et on
                                                  // propose de renseigner la conversion sur-le-champ.
                                                  const v = verdictLigne(it);
                                                  if (!v || v.convertible || !it.article) return null;
                                                  if (v.motif === UCU.MOTIFS.QUANTITE_INVALIDE) return null;
                                                  // Fiches JUMELLES en désaccord : l'article existe, il est
                                                  // seulement en double. Le dire « absent du catalogue »
                                                  // enverrait le magasinier chercher un problème inexistant —
                                                  // et ici la réparation est possible (renseigner la même
                                                  // conversion sur toutes les fiches du nom).
                                                  const ambigu = UCU.estAmbigu(uniteIndex, it.article);
                                                  const inconnu = v.motif === UCU.MOTIFS.ARTICLE_INCONNU && !ambigu;
                                                  return <div style={{fontSize:10,color:'#a01d10',marginTop:3,fontWeight:600,lineHeight:1.3}}>
                                                      <i className="fa-solid fa-triangle-exclamation" style={{marginRight:3}}></i>
                                                      {ambigu
                                                          ? 'Plusieurs fiches « ' + it.article + ' » au catalogue, en désaccord sur la conversion : la quantité sera déduite telle quelle.'
                                                          : (inconnu
                                                              ? 'Article absent du catalogue : la quantité sera déduite telle quelle.'
                                                              : 'Saisi en ' + v.unite_saisie + ', stock tenu en ' + v.unite_stock + ' — conversion non renseignée. La quantité sera déduite telle quelle.')}
                                                      {!inconnu && canSetConversion && (
                                                          <button type="button" onClick={() => openConversion(it.article)} style={{display:'block',marginTop:3,padding:'2px 6px',borderRadius:5,border:'1px dashed var(--berry)',background:'var(--berry-pale)',color:'var(--berry)',cursor:'pointer',fontSize:10,fontWeight:600}}>
                                                              <i className="fa-solid fa-right-left" style={{marginRight:3}}></i>Renseigner la conversion
                                                          </button>
                                                      )}
                                                  </div>;
                                              })()}
                                          </td>
                                          <td style={{textAlign:'center',fontSize:11,color: insuffisant ? '#e74c3c' : 'var(--green)',fontWeight:600}}>{it.article ? dispo : '—'}</td>
                                          <td><button onClick={() => removeItem(idx)} style={{background:'none',border:'none',cursor:'pointer',color:'#e74c3c',fontSize:13}}><i className="fa-solid fa-trash"></i></button></td></tr>
                                      ); })}
                                  </tbody>
                              </table>
                              <button onClick={addItem} style={{marginTop:8,background:'none',border:'1px dashed #ddd',borderRadius:8,padding:'6px 16px',cursor:'pointer',fontSize:12,color:'var(--blue)'}}>+ Ajouter article</button>
                              <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
                                  <button onClick={() => { clearBcDraft(); setShowForm(false); }} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                  <button onClick={handleCreate} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}>Creer le bon</button>
                              </div>
                          </div>
                      </div>
                  )}

                  {/* Renseigner la conversion d'unité d'un article, depuis la
                      saisie. Le magasinier n'a pas l'écran Stock › Articles :
                      sans cette fenêtre, il verrait le signalement sans pouvoir
                      rien y faire. Les DEUX champs de conversion, et rien
                      d'autre — le serveur refuserait le reste. */}
                  {conversionArticle && (
                      <div className="modal-overlay" style={{zIndex:10003}}>
                          <div className="modal-content" style={{maxWidth:480,width:'92vw'}}>
                              <h3 style={{marginTop:0,color:'var(--berry)'}}><i className="fa-solid fa-right-left" style={{marginRight:8}}></i>Conversion d'unité</h3>
                              <div style={{fontSize:12,color:'var(--gray-400)',marginBottom:4}}>
                                  Article <strong style={{color:'var(--berry)'}}>{conversionArticle.nom}</strong> — stock tenu en <strong>{conversionArticle.unite_stock || '—'}</strong>
                              </div>
                              <div style={{fontSize:11,color:'var(--gray-400)',marginBottom:8}}>
                                  Seuls l'unité de consommation et sa conversion sont modifiés. Le prix, la catégorie et l'unité de stock ne changent pas.
                              </div>
                              {ArticleConversionFields && (
                                  <ArticleConversionFields
                                      uniteStock={conversionArticle.unite_stock}
                                      uniteConsommation={conversionForm.unite_consommation}
                                      facteur={conversionForm.stock_par_unite_consommation}
                                      disabled={conversionSaving}
                                      compact={true}
                                      onChange={patch => { setConversionForm({ ...conversionForm, ...patch }); setConversionError(''); }}
                                  />
                              )}
                              {conversionError && (
                                  <div style={{marginTop:10,padding:'8px 10px',borderRadius:8,background:'#fdecea',border:'1px solid #e74c3c',color:'#a01d10',fontSize:12}}>
                                      {conversionError}
                                  </div>
                              )}
                              <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
                                  <button onClick={() => setConversionArticle(null)} disabled={conversionSaving} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                  <button onClick={saveConversion} disabled={conversionSaving} style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13}}>
                                      {conversionSaving ? 'Enregistrement…' : 'Enregistrer la conversion'}
                                  </button>
                              </div>
                          </div>
                      </div>
                  )}

                  {/* Modification de la DATE d'un bon (magasinier). Sortie
                      explicite par « Annuler » — pas de fermeture au clic sur
                      le fond, même convention que les autres fenêtres du tab. */}
                  {editDateBc && (
                      <div className="modal-overlay" style={{zIndex:10002}}>
                          <div className="modal-content" style={{maxWidth:420,width:'90vw'}}>
                              <h3 style={{marginTop:0,color:'var(--berry)'}}><i className="fa-solid fa-calendar-day" style={{marginRight:8}}></i>Modifier la date</h3>
                              <div style={{fontSize:12,color:'var(--gray-400)',marginBottom:12}}>
                                  Bon <strong style={{color:'var(--berry)'}}>{editDateBc.numero || ''}</strong> — date actuelle : <strong>{editDateBc.date || '—'}</strong>
                              </div>
                              <div style={{fontSize:11,color:'var(--gray-400)',marginBottom:12}}>
                                  Seule la date est modifiée. Les articles, quantités et parcelles restent inchangés.
                              </div>
                              <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Nouvelle date</label>
                              <input type="date" value={editDateValue} onChange={e => { setEditDateValue(e.target.value); setEditDateError(''); }}
                                  style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} />
                              {editDateCampagne.changed && (
                                  <div style={{marginTop:10,padding:'8px 10px',borderRadius:8,background:'#fff4e5',border:'1px solid #ffb74d',color:'#8a4b00',fontSize:12,fontWeight:600}}>
                                      <i className="fa-solid fa-triangle-exclamation" style={{marginRight:6}}></i>
                                      Attention : ce bon change de campagne ({editDateCampagne.from} → {editDateCampagne.to}). Les analyses par campagne en seront modifiées.
                                  </div>
                              )}
                              {editDateError && (
                                  <div style={{marginTop:10,padding:'8px 10px',borderRadius:8,background:'#fdecea',border:'1px solid #e74c3c',color:'#a01d10',fontSize:12}}>
                                      {editDateError}
                                  </div>
                              )}
                              <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
                                  <button onClick={closeEditDate} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                  <button onClick={submitEditDate} disabled={editDateSaving || !editDateValue}
                                      style={{padding:'8px 16px',borderRadius:8,border:'none',background:'var(--berry)',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13,opacity:(editDateSaving || !editDateValue)?0.6:1}}>
                                      {editDateSaving ? 'Enregistrement...' : 'Confirmer la date'}
                                  </button>
                              </div>
                          </div>
                      </div>
                  )}

                  {/* Doublon refusé par create-bc (409). Composant partagé avec
                      le modal de scan. */}
                  {doublonBc && BCDoublonDialog && (
                      <BCDoublonDialog doublon={doublonBc}
                          onCancel={() => setDoublonBc(null)}
                          onForce={forcerCreationDoublon} />
                  )}

                  {/* Suppression d'un bon (magasinier / achats / dg), étape 1.
                      Motif obligatoire et effet stock annoncé AVANT d'agir :
                      les quantités du bon reviennent en stock. Pour le
                      magasinier, valider ici n'envoie RIEN : cela ouvre la
                      seconde confirmation, plus bas. */}
                  {deleteBc && (
                      <div className="modal-overlay" style={{zIndex:10002}}>
                          <div className="modal-content" style={{maxWidth:440,width:'90vw'}}>
                              <h3 style={{marginTop:0,color:'#a01d10'}}><i className="fa-solid fa-trash" style={{marginRight:8}}></i>Supprimer le bon</h3>
                              <div style={{fontSize:12,color:'var(--gray-400)',marginBottom:12}}>
                                  Bon <strong style={{color:'var(--berry)'}}>{deleteBc.numero || ''}</strong> — date : <strong>{deleteBc.date || '—'}</strong>
                              </div>
                              <div style={{padding:'8px 10px',borderRadius:8,background:'#fff4e5',border:'1px solid #ffb74d',color:'#8a4b00',fontSize:12,marginBottom:12}}>
                                  <i className="fa-solid fa-triangle-exclamation" style={{marginRight:6}}></i>
                                  Les quantités de ce bon <strong>reviennent en stock</strong> : la consommation est annulée, et le bon disparaît des listes et des analyses.
                              </div>
                              <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>Motif de la suppression *</label>
                              <input value={deleteMotif} onChange={e => { setDeleteMotif(e.target.value); setDeleteError(''); }}
                                  placeholder="Ex. : doublon de BC-2026-0032"
                                  style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} />
                              {deleteError && !deleteConfirmBc && (
                                  <div style={{marginTop:10,padding:'8px 10px',borderRadius:8,background:'#fdecea',border:'1px solid #e74c3c',color:'#a01d10',fontSize:12}}>
                                      {deleteError}
                                  </div>
                              )}
                              <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
                                  <button onClick={closeDeleteBc} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                  <button onClick={nextDeleteStep} disabled={deleteSaving || !deleteMotifValide}
                                      style={{padding:'8px 16px',borderRadius:8,border:'none',background:'#e74c3c',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13,opacity:(deleteSaving || !deleteMotifValide)?0.6:1}}>
                                      {deleteSaving ? 'Suppression...' : 'Supprimer ce bon'}
                                  </button>
                              </div>
                          </div>
                      </div>
                  )}

                  {/* Seconde confirmation, MAGASINIER UNIQUEMENT. Un second
                      « OK » se cliquerait par réflexe : on exige de RETAPER le
                      numéro du bon, geste court mais impossible à franchir
                      distraitement. La fenêtre redit ce qui va se passer (le
                      bon disparaît, les quantités reviennent en stock) et
                      combien de lignes sont concernées.

                      Rappel : protection d'ERGONOMIE. Le serveur ne la voit
                      pas et ne doit pas en dépendre. */}
                  {deleteConfirmBc && (
                      <div className="modal-overlay" style={{zIndex:10003}}>
                          <div className="modal-content" style={{maxWidth:460,width:'90vw'}}>
                              <h3 style={{marginTop:0,color:'#a01d10'}}><i className="fa-solid fa-triangle-exclamation" style={{marginRight:8}}></i>Confirmer la suppression</h3>
                              <div style={{padding:'10px 12px',borderRadius:8,background:'#fdecea',border:'1px solid #e74c3c',color:'#a01d10',fontSize:12,marginBottom:12}}>
                                  Le bon <strong>{deleteNumeroAttendu}</strong> va disparaître de la liste
                                  {deleteLignes > 0 && <span> ({deleteLignes} {deleteLignes > 1 ? 'lignes' : 'ligne'})</span>},
                                  et les quantités <strong>reviennent en stock</strong> : la consommation est annulée.
                              </div>
                              <label style={{fontSize:12,fontWeight:600,display:'block',marginBottom:4}}>
                                  Retapez le numéro du bon pour confirmer
                              </label>
                              <input value={deleteNumeroSaisi} onChange={e => { setDeleteNumeroSaisi(e.target.value); setDeleteError(''); }}
                                  placeholder={deleteNumeroAttendu}
                                  style={{width:'100%',padding:'8px 12px',borderRadius:8,border:'1px solid #ddd',fontSize:13}} />
                              {!deleteNumeroOk && (
                                  <div style={{fontSize:11,color:'var(--gray-400)',marginTop:4}}>
                                      Saisie exacte attendue : <strong>{deleteNumeroAttendu}</strong>
                                  </div>
                              )}
                              {deleteError && (
                                  <div style={{marginTop:10,padding:'8px 10px',borderRadius:8,background:'#fdecea',border:'1px solid #e74c3c',color:'#a01d10',fontSize:12}}>
                                      {deleteError}
                                  </div>
                              )}
                              <div style={{display:'flex',gap:8,justifyContent:'flex-end',marginTop:16}}>
                                  <button onClick={closeDeleteConfirm} style={{padding:'8px 16px',borderRadius:8,border:'1px solid #ddd',background:'#fff',cursor:'pointer',fontSize:13}}>Annuler</button>
                                  <button onClick={submitDeleteBc} disabled={deleteSaving || !deleteNumeroOk}
                                      style={{padding:'8px 16px',borderRadius:8,border:'none',background:'#e74c3c',color:'#fff',cursor:'pointer',fontWeight:600,fontSize:13,opacity:(deleteSaving || !deleteNumeroOk)?0.6:1}}>
                                      {deleteSaving ? 'Suppression...' : 'Supprimer définitivement'}
                                  </button>
                              </div>
                          </div>
                      </div>
                  )}

                  {/* Idem : saisie en cours, sortie explicite par « Annuler ». */}
                  {showCreateArticle && (
                      <div className="modal-overlay" style={{zIndex:10001}}>
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

                  {detailBc && (() => {
                      const bc = detailBc;
                      // Fenêtre de plausibilité [2000-01-01, 2100-01-01) en ms : sert à
                      // trancher l'unité d'un horodatage numérique SANS deviner. En base,
                      // created_at est un nombre de MILLISECONDES (ex. 1787672414121), mais
                      // d'autres horodatages du dépôt sont en SECONDES. Hors de la fenêtre
                      // dans les deux unités (0, NaN, valeur aberrante) → on n'affiche rien,
                      // plutôt qu'une date de 1970, de l'an 58000 ou un « Invalid Date ».
                      const TS_MIN_MS = 946684800000;  // 2000-01-01T00:00:00Z
                      const TS_MAX_MS = 4102444800000; // 2100-01-01T00:00:00Z
                      const msFromNumber = (n) => {
                          if (n >= TS_MIN_MS && n < TS_MAX_MS) return n;
                          if (n * 1000 >= TS_MIN_MS && n * 1000 < TS_MAX_MS) return n * 1000;
                          return null;
                      };
                      const fmtTs = (v) => {
                          if (!v) return null;
                          try {
                              if (typeof v === 'string') return v.length > 10 ? new Date(v).toLocaleString('fr-FR') : v;
                              if (typeof v === 'number') {
                                  const ms = msFromNumber(v);
                                  return ms == null ? null : new Date(ms).toLocaleString('fr-FR');
                              }
                              if (v.seconds != null) return new Date(v.seconds * 1000).toLocaleString('fr-FR');
                              if (v._seconds != null) return new Date(v._seconds * 1000).toLocaleString('fr-FR');
                              if (v instanceof Date) return v.toLocaleString('fr-FR');
                          } catch (e) { return null; }
                          return null;
                      };
                      const items = bc.items || [];
                      const hasParcelle = items.some(i => i.parcelle);
                      const hasCulture = items.some(i => i.culture);
                      const scan = bc.scan_url || '';
                      const isHttpScan = /^https?:\/\//i.test(scan);
                      const isImgScan = isHttpScan && /\.(png|jpe?g|gif|webp|bmp)(\?|$)/i.test(scan);
                      const isGsScan = /^gs:\/\//i.test(scan);
                      const infoRow = (lbl, value) => value == null || value === '' ? null : (
                          <div style={{display:'flex',gap:8,padding:'3px 0'}}>
                              <span style={{minWidth:140,color:'var(--gray-400)',fontSize:12}}>{lbl}</span>
                              <span style={{fontSize:12,fontWeight:600,color:'#1e293b'}}>{value}</span>
                          </div>
                      );
                      return (
                          <div onClick={() => setDetailBc(null)} style={{position:'fixed',inset:0,background:'rgba(15,23,42,0.55)',backdropFilter:'blur(2px)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
                              <div onClick={e => e.stopPropagation()} style={{background:'#fff',borderRadius:12,maxWidth:640,width:'100%',maxHeight:'85vh',overflow:'auto',padding:24,boxShadow:'0 20px 60px rgba(0,0,0,0.3)'}}>
                                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:16,gap:12}}>
                                      <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                                          <h3 style={{margin:0,color:'var(--berry)'}}><i className={'fa-solid ' + icon} style={{marginRight:8}}></i>Bon de Consommation {bc.numero || ''}</h3>
                                          {bc.status && <span className="status-badge" style={{fontSize:10}}>{bc.status}</span>}
                                      </div>
                                      <button onClick={() => setDetailBc(null)} style={{background:'none',border:'none',cursor:'pointer',fontSize:20,color:'var(--gray-400)',lineHeight:1}} title="Fermer">✕</button>
                                  </div>

                                  <div style={{marginBottom:16}}>
                                      {infoRow('Date', bc.date)}
                                      {infoRow('Lieu départ', bc.lieu_source?.id || bc.lieu_source_id)}
                                      {infoRow('Ferme', bc.ferme)}
                                      {infoRow('Type', bc.type)}
                                      {infoRow('Créé par', bc.created_by?.name)}
                                      {infoRow('Saisi le', fmtTs(bc.created_at))}
                                      {infoRow('Autorisé par', bc.authorized_by?.name)}
                                  </div>

                                  {items.length > 0 && (
                                      <div style={{marginBottom:16}}>
                                          <h4 style={{fontSize:13,margin:'0 0 8px'}}>Articles</h4>
                                          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                                              <thead><tr style={{background:'#f8f8f8',textAlign:'left'}}>
                                                  <th style={{padding:'6px 8px'}}>Article</th>
                                                  <th style={{padding:'6px 8px',textAlign:'right'}}>Quantité</th>
                                                  <th style={{padding:'6px 8px'}}>Unité</th>
                                                  {hasParcelle && <th style={{padding:'6px 8px'}}>Parcelle</th>}
                                                  {hasCulture && <th style={{padding:'6px 8px'}}>Culture</th>}
                                              </tr></thead>
                                              <tbody>
                                                  {items.map((i, idx) => (
                                                      <tr key={idx} style={{borderBottom:'1px solid #f0f0f0'}}>
                                                          <td style={{padding:'6px 8px'}}>{i.article || '—'}</td>
                                                          <td style={{padding:'6px 8px',textAlign:'right'}}>{i.quantite != null ? i.quantite : '—'}</td>
                                                          <td style={{padding:'6px 8px'}}>{i.unite || '—'}</td>
                                                          {hasParcelle && <td style={{padding:'6px 8px'}}>{parcelleNom(i.parcelle) || '—'}</td>}
                                                          {hasCulture && <td style={{padding:'6px 8px'}}>{i.culture || '—'}</td>}
                                                      </tr>
                                                  ))}
                                              </tbody>
                                          </table>
                                      </div>
                                  )}

                                  {scan && (
                                      <div style={{marginBottom:16}}>
                                          <h4 style={{fontSize:13,margin:'0 0 8px'}}>Scan du bon</h4>
                                          {isImgScan ? (
                                              <a href={scan} target="_blank" rel="noopener noreferrer">
                                                  <img src={scan} alt="Scan du bon" style={{maxWidth:'100%',maxHeight:280,borderRadius:8,border:'1px solid #eee',cursor:'zoom-in'}} />
                                              </a>
                                          ) : isHttpScan ? (
                                              <a href={scan} target="_blank" rel="noopener noreferrer" style={{color:'var(--blue)',fontSize:12}}><i className="fa-solid fa-paperclip" style={{marginRight:6}}></i>Voir le scan</a>
                                          ) : isGsScan ? (
                                              <span style={{fontSize:12,color:'var(--gray-400)'}}><i className="fa-solid fa-paperclip" style={{marginRight:6}}></i>Scan disponible (stockage interne)</span>
                                          ) : (
                                              <span style={{fontSize:12,color:'var(--gray-400)'}}><i className="fa-solid fa-paperclip" style={{marginRight:6}}></i>Scan disponible</span>
                                          )}
                                      </div>
                                  )}
                              </div>
                          </div>
                      );
                  })()}
              </div>
          );
      }

export { MagBCTab, MagBCEngraisTab, MagBCPhytoTab };
