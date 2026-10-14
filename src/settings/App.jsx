/**
 * Fenêtre des réglages : barre latérale en verre, pages à droite, et en fond
 * la pochette du morceau en cours, réfractée par les surfaces Liquid Glass.
 */
import { useEffect, useState } from 'react';
import { GlassButton, GlassContent, GlassScene, GlassSurface } from '@glass-sdk/liquid-glass';
import { ipcRenderer } from '../shared/ipc.js';
import { Icon } from './components/controls.jsx';
import { useCoverTheme, useSettings } from './state/useSettings.js';
import { playClick } from './state/sound.js';
import General from './pages/General.jsx';
import Appearance from './pages/Appearance.jsx';
import Music from './pages/Music.jsx';
import Wallpaper from './pages/Wallpaper.jsx';
import ControlCenter from './pages/ControlCenter.jsx';
import MicMonitor from './pages/MicMonitor.jsx';
import Position from './pages/Position.jsx';
import About from './pages/About.jsx';

const PAGES = [
    { id: 'general', label: 'Général', icon: 'ph-gear-six', color: '#8e8e93', Page: General },
    { id: 'appearance', label: 'Apparence', icon: 'ph-paint-brush', color: '#af52de', Page: Appearance },
    { id: 'music', label: 'Musique', icon: 'ph-music-notes', color: '#ff2d55', Page: Music },
    { id: 'wallpaper', label: 'Fond d’écran', icon: 'ph-image', color: '#0a84ff', Page: Wallpaper },
    { id: 'control', label: 'Centre de contrôle', icon: 'ph-squares-four', color: '#ff9f0a', Page: ControlCenter },
    { id: 'mic', label: 'Retour micro', icon: 'ph-microphone', color: '#e08a5a', Page: MicMonitor },
    { id: 'position', label: 'Position', icon: 'ph-arrows-out-cardinal', color: '#30d158', Page: Position },
    { id: 'about', label: 'À propos', icon: 'ph-info', color: '#64d2ff', Page: About },
];

function Backdrop({ cover }) {
    return (
        <GlassContent className="backdrop">
            {cover.cover ? <img className="backdrop-cover" src={cover.cover} alt="" /> : <div className="backdrop-default" />}
            <div className="backdrop-shade" />
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

    useEffect(() => localStorage.setItem('liquid_settings_page', pageId), [pageId]);
    useEffect(() => {
        document.documentElement.style.setProperty('--accent', cover.primary || '#D49460');
    }, [cover.primary]);

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
                            }}
                        >
                            <span className="nav-icon"><Icon name={item.icon} /></span>
                            {item.label}
                        </button>
                    ))}
                </nav>
            </GlassSurface>

            <main className="content">
                <header className="content-header">
                    <h1>{page.label}</h1>
                    <GlassButton
                        size="icon"
                        radius="circle"
                        className="close"
                        aria-label="Fermer"
                        onClick={() => ipcRenderer.send('close-settings')}
                    >
                        <Icon name="ph-x" />
                    </GlassButton>
                </header>
                <div className="page" key={page.id}>
                    <page.Page store={store} />
                </div>
            </main>
        </GlassScene>
    );
}
