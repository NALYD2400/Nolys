/**
 * Réglages, ouverts dans l'Island (mode `settings`, voir mount.jsx) : barre latérale en
 * verre, pages à droite, et en fond la pochette du morceau en cours, floutée.
 * (CSS statique, sans verre réfracté : le défilement reste fluide).
 */
import { useEffect, useRef, useState } from 'react';
import { themeLook } from '../shared/theme-look.js';
import { Icon } from './components/controls.jsx';
import { useCoverTheme, useSettings } from './state/useSettings.js';
import { playClick } from './state/sound.js';
import General from './pages/General.jsx';
import Appearance from './pages/Appearance.jsx';
import Music from './pages/Music.jsx';
import Island from './pages/Island.jsx';
import Wallpaper from './pages/Wallpaper.jsx';
import ControlCenter from './pages/ControlCenter.jsx';
import Shortcuts from './pages/Shortcuts.jsx';
import MicMonitor from './pages/MicMonitor.jsx';
import Position from './pages/Position.jsx';
import About from './pages/About.jsx';
import Menus from './pages/Menus.jsx';

const PAGES = [
    { id: 'general', label: 'Général', icon: 'ph-gear-six', color: '#8e8e93', Page: General },
    { id: 'island', label: 'Island', icon: 'ph-pill', color: '#d49460', Page: Island },
    { id: 'menus', label: 'Menus', icon: 'ph-list-bullets', color: '#d49460', Page: Menus },
    { id: 'appearance', label: 'Apparence', icon: 'ph-paint-brush', color: '#af52de', Page: Appearance },
    { id: 'music', label: 'Musique', icon: 'ph-music-notes', color: '#ff2d55', Page: Music },
    { id: 'wallpaper', label: 'Fond d’écran', icon: 'ph-image', color: '#0a84ff', Page: Wallpaper },
    { id: 'control', label: 'Centre de contrôle', icon: 'ph-squares-four', color: '#ff9f0a', Page: ControlCenter },
    { id: 'shortcuts', label: 'Raccourcis', icon: 'ph-keyboard', color: '#bf5af2', Page: Shortcuts },
    { id: 'mic', label: 'Retour micro', icon: 'ph-microphone', color: '#e08a5a', Page: MicMonitor },
    { id: 'position', label: 'Position', icon: 'ph-arrows-out-cardinal', color: '#30d158', Page: Position },
    { id: 'about', label: 'À propos', icon: 'ph-info', color: '#64d2ff', Page: About },
];

function BackdropLayers({ cover }) {
    return (
        <>
            {cover.cover ? <img className="backdrop-cover" src={cover.cover} alt="" /> : <div className="backdrop-default" />}
            <div className="backdrop-shade" />
        </>
    );
}

function Backdrop({ cover }) {
    return (
        <div className="backdrop">
            <BackdropLayers cover={cover} />
        </div>
    );
}

const knownPage = (id) => PAGES.some((page) => page.id === id);

/** Libellés courts de la barre latérale (la capsule est étroite) ; le titre garde le nom complet. */
const SHORT_LABELS = { control: 'Contrôle' };

export default function App({ host, initialPage, pageRequest, onBack, onClose }) {
    const store = useSettings();
    const cover = useCoverTheme(store.settings.coverSync);
    const [pageId, setPageId] = useState(() => {
        if (knownPage(initialPage)) return initialPage;
        const saved = localStorage.getItem('liquid_settings_page');
        return knownPage(saved) ? saved : 'general';
    });
    const page = PAGES.find((item) => item.id === pageId) ?? PAGES[0];
    // Page défilée : l'en-tête prend son voile (sinon il reste transparent).
    const [scrolled, setScrolled] = useState(false);
    const pageRef = useRef(null);

    useEffect(() => localStorage.setItem('liquid_settings_page', pageId), [pageId]);
    // Page demandée de l'extérieur (retour du mode placement) alors que la vue est ouverte.
    useEffect(() => {
        if (knownPage(pageRequest?.page)) {
            setPageId(pageRequest.page);
            setScrolled(false);
        }
    }, [pageRequest]);
    // Thème de la pilule (Réglages → Island) : même couleur d'accent et même matière
    // que le menu clic droit ; la teinte et la texture du fond en découlent (styles.css).
    const look = themeLook(store.settings, cover.cover ? cover.primary : '');
    // Posés sur l'hôte du shadow DOM, pas sur la page : l'Island garde ses propres variables.
    useEffect(() => {
        host.style.setProperty('--accent-raw', look.accent);
        host.dataset.material = look.material;
    }, [host, look.accent, look.material]);

    return (
        <div className="window">
            <Backdrop cover={cover} />

            {/* Concentrique à la coque : 40 − 12 de retrait. */}
            <div className="sidebar glass">
                <header className="sidebar-header">
                    <img src="/assets/app-logo.png" alt="" />
                    <div>
                        <strong>Nolys</strong>
                        <span>Réglages</span>
                    </div>
                </header>
                <nav className="nav" aria-label="Sections">
                    {PAGES.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            className={`nav-item${item.id === page.id ? ' is-active' : ''}`}
                            aria-current={item.id === page.id ? 'page' : undefined}
                            onClick={() => {
                                playClick();
                                // Page déjà ouverte : retour en haut (le voile de l'en-tête suit le défilement).
                                if (item.id === page.id) {
                                    pageRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                                    return;
                                }
                                setPageId(item.id);
                                setScrolled(false);
                            }}
                        >
                            <span className="nav-icon"><Icon name={item.icon} /></span>
                            {SHORT_LABELS[item.id] ?? item.label}
                        </button>
                    ))}
                </nav>
            </div>

            <main className={`content${scrolled ? ' is-scrolled' : ''}`}>
                {/* Copie exacte du fond de la fenêtre, derrière le titre : le verre des cartes
                    (peint dans le fond, pas dans la zone qui défile) ne remonte plus derrière le
                    titre, et sans bandeau visible puisque c'est le même fond. Hors de l'en-tête :
                    sa zone « déplacer la fenêtre » (gérée par Windows) engloberait sinon ce grand
                    calque, et la molette ne faisait plus défiler la page. */}
                <div className="header-backdrop" aria-hidden="true">
                    <div className="header-backdrop-inner">
                        <BackdropLayers cover={cover} />
                    </div>
                </div>
                <header className="content-header">
                    <h1>{page.label}</h1>
                    <div className="header-actions">
                        {/* Boutons en CSS et pas en verre du SDK : leur lentille est peinte dans le fond,
                            que le voile de l'en-tête recouvre dès que la page défile. */}
                        <button type="button" className="round-btn" aria-label="Menu" title="Menu" onClick={onBack}>
                            <Icon name="ph-squares-four" />
                        </button>
                        <button type="button" className="round-btn" aria-label="Fermer" title="Fermer (Échap)" onClick={onClose}>
                            <Icon name="ph-x" />
                        </button>
                    </div>
                </header>
                <div className="page" key={page.id} ref={pageRef} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 2)}>
                    <page.Page store={store} />
                </div>
                {/* Les surfaces en verre sont peintes dans le fond de la scène : ce voile
                    les efface aussi avant l'arrondi inférieur, au-delà de la zone défilante. */}
                <div className="footer-backdrop" aria-hidden="true">
                    <div className="footer-backdrop-inner">
                        <BackdropLayers cover={cover} />
                    </div>
                </div>
            </main>
        </div>
    );
}
