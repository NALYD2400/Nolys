/**
 * Fenêtre des réglages : barre latérale en verre, pages à droite, et en fond
 * la pochette du morceau en cours, réfractée par les surfaces Liquid Glass.
 */
import { useEffect, useState } from 'react';
import { GlassContent, GlassScene, GlassSurface } from '@glass-sdk/liquid-glass';
import { ipcRenderer } from '../shared/ipc.js';
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
import MicMonitor from './pages/MicMonitor.jsx';
import Position from './pages/Position.jsx';
import About from './pages/About.jsx';

const PAGES = [
    { id: 'general', label: 'Général', icon: 'ph-gear-six', color: '#8e8e93', Page: General },
    { id: 'island', label: 'Island', icon: 'ph-pill', color: '#d49460', Page: Island },
    { id: 'appearance', label: 'Apparence', icon: 'ph-paint-brush', color: '#af52de', Page: Appearance },
    { id: 'music', label: 'Musique', icon: 'ph-music-notes', color: '#ff2d55', Page: Music },
    { id: 'wallpaper', label: 'Fond d’écran', icon: 'ph-image', color: '#0a84ff', Page: Wallpaper },
    { id: 'control', label: 'Centre de contrôle', icon: 'ph-squares-four', color: '#ff9f0a', Page: ControlCenter },
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
        <GlassContent className="backdrop">
            <BackdropLayers cover={cover} />
        </GlassContent>
    );
}

export default function App() {
    const store = useSettings();
    const cover = useCoverTheme(store.settings.coverSync);
    const [pageId, setPageId] = useState(() => {
        const saved = localStorage.getItem('liquid_settings_page');
        return PAGES.some((page) => page.id === saved) ? saved : 'general';
    });
    const page = PAGES.find((item) => item.id === pageId) ?? PAGES[0];
    // Page défilée : l'en-tête prend son voile (sinon il reste transparent).
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => localStorage.setItem('liquid_settings_page', pageId), [pageId]);
    // Thème de la pilule (Réglages → Island) : même couleur d'accent et même matière
    // que le menu clic droit ; la teinte et la texture du fond en découlent (styles.css).
    const look = themeLook(store.settings, cover.cover ? cover.primary : '');
    useEffect(() => {
        document.documentElement.style.setProperty('--accent', look.accent);
        document.documentElement.dataset.material = look.material;
    }, [look.accent, look.material]);

    return (
        <GlassScene className="window" appearance="dark" maxSurfaces={48}>
            <Backdrop cover={cover} />

            <GlassSurface className="sidebar" material="regular" radius={22}>
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
                                setPageId(item.id);
                                setScrolled(false);
                            }}
                        >
                            <span className="nav-icon"><Icon name={item.icon} /></span>
                            {item.label}
                        </button>
                    ))}
                </nav>
            </GlassSurface>

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
                    <button type="button" className="close" aria-label="Fermer" title="Fermer" onClick={() => ipcRenderer.send('close-settings')}>
                        <Icon name="ph-x" />
                    </button>
                </header>
                <div className="page" key={page.id} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 2)}>
                    <page.Page store={store} />
                </div>
            </main>
        </GlassScene>
    );
}
