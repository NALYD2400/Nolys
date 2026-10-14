/** Visualiseur audio (canvas) branché sur le niveau WASAPI. */
import { visualizerService } from '../../../services/AudioVisualizerService.js';
import { ThemeService } from '../../../services/ThemeService.js';
import { hexToRgb, rgbToHex } from '../helpers/color.js';

export const visualizerMethods = {
    _startVisualizer() {
        if (localStorage.getItem('liquid_eco_mode') === 'true') {
            visualizerService.setEcoMode(true);
            return;
        }

        if (this._vizUnsub) {
            this.syncVisualizerActivity();
            return;
        }

        visualizerService.setEcoMode(false);
        visualizerService.start().catch(() => {});

        // Subscribe to data
        this._vizUnsub = visualizerService.subscribe((data) => {
            // Smooth the bands with exponential moving average
            const alpha = 0.35;
            for (let i = 0; i < 5; i++) {
                this._vizBands[i] = this._vizBands[i] * (1 - alpha) + (data.bands[i] || 0) * alpha;
            }
            this._updateVizCanvas();
        });

        this.syncVisualizerActivity();
    },

    syncVisualizerActivity() {
        const canvas = this._vizCanvas;
        const ecoMode = localStorage.getItem('liquid_eco_mode') === 'true';
        visualizerService.setEcoMode(ecoMode);

        const hasVisibleCanvas = Boolean(!ecoMode && canvas && canvas.isConnected && canvas.width > 0 && canvas.height > 0);
        if (hasVisibleCanvas && !this._vizUnsub) {
            this._startVisualizer();
            return;
        }

        if (hasVisibleCanvas && !visualizerService.isRunning) {
            visualizerService.start().catch(() => {});
        }
        visualizerService.setActive(hasVisibleCanvas);

        if (hasVisibleCanvas) {
            this._updateVizCanvas();
        }
    },

    /** Couleur de chaque barre selon le réglage (pochette, couleur unie ou dégradé). */
    _getVizColors(count) {
        const mode = this._islandConfig.vizColorMode || 'cover';
        let from = { r: 212, g: 148, b: 96 };
        let to = { r: 237, g: 188, b: 137 };
        if (mode === 'cover' && this._coverColors) {
            from = this._coverColors.primary;
            to = this._coverColors.secondary || from;
        } else if (mode === 'solid') {
            from = to = hexToRgb(this._islandConfig.vizColorSolid || '#D49460') || from;
        } else if (mode === 'gradient') {
            from = hexToRgb(this._islandConfig.vizColorGradA || '#D49460') || from;
            to = hexToRgb(this._islandConfig.vizColorGradB || '#EDBC89') || to;
        }
        // Éclaircies vers le blanc : sur la pilule sombre, une pochette sombre resterait invisible.
        const lift = (c) => Math.round(c + (255 - c) * 0.35);
        return Array.from({ length: count }, (_, i) => {
            const t = count > 1 ? i / (count - 1) : 0;
            return [
                lift(from.r * (1 - t) + to.r * t),
                lift(from.g * (1 - t) + to.g * t),
                lift(from.b * (1 - t) + to.b * t),
            ];
        });
    },

    _updateVizCanvas() {
        const canvas = this._vizCanvas;
        if (localStorage.getItem('liquid_eco_mode') === 'true') {
            if (canvas) {
                const ctx = canvas.getContext('2d');
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }
            return;
        }

        if (!canvas || !canvas.isConnected) {
            this.syncVisualizerActivity();
            return;
        }

        // Canvas à la taille réelle de l'écran (sinon les barres sont floues ou pixelisées).
        const dpr = window.devicePixelRatio || 1;
        const cssW = canvas.clientWidth || 26;
        const cssH = canvas.clientHeight || 18;
        if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
            canvas.width = Math.round(cssW * dpr);
            canvas.height = Math.round(cssH * dpr);
        }
        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, cssW, cssH);

        // Onde façon Apple : quelques gélules centrées, chacune à son rythme.
        const count = Number(canvas.dataset.bars) || 5;
        const barW = Number(canvas.dataset.barWidth) || 3;
        const gap = (cssW - count * barW) / Math.max(1, count - 1);
        const energy = this.musicData && this.musicData.isPlaying
            ? Math.max(...this._vizBands.slice(0, 2), 0)
            : 0;
        const now = performance.now();
        if (!this._vizBars || this._vizBars.length !== count) {
            this._vizBars = Array.from({ length: count }, () => ({ value: 0, target: 0 }));
            this._vizNextShuffle = 0;
        }
        // Nouvelles cibles ~9 fois par seconde : le mouvement reste organique, pas mécanique.
        if (now >= (this._vizNextShuffle || 0)) {
            this._vizNextShuffle = now + 110;
            const center = (count - 1) / 2;
            this._vizBars.forEach((bar, i) => {
                const shape = 1 - Math.abs(i - center) / (center + 1) * 0.45; // plus haut au centre
                bar.target = energy * shape * (0.45 + Math.random() * 0.55);
            });
        }

        const colors = this._getVizColors(count);
        for (let i = 0; i < count; i++) {
            const bar = this._vizBars[i];
            // Monte vite, redescend en douceur.
            bar.value += (bar.target - bar.value) * (bar.target > bar.value ? 0.45 : 0.18);
            const barH = Math.max(barW, Math.min(1, bar.value) * cssH);
            const x = i * (barW + gap);
            const y = (cssH - barH) / 2;
            const [r, g, b] = colors[i];
            ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.55)`;
            ctx.shadowBlur = 4 + bar.value * 6;
            ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.75 + bar.value * 0.25})`;
            ctx.beginPath();
            ctx.roundRect(x, y, barW, barH, barW / 2);
            ctx.fill();
        }
        ctx.shadowBlur = 0;

        // Dynamic glow sync with cover color if vizColorMode is 'cover'
        const vizColorMode = this._islandConfig.vizColorMode || 'cover';
        if (vizColorMode === 'cover' && this._coverColors && this._islandConfig.glowEnabled !== false) {
            const primaryHex = rgbToHex(this._coverColors.primary.r, this._coverColors.primary.g, this._coverColors.primary.b);
            const primaryRgbStr = `${this._coverColors.primary.r}, ${this._coverColors.primary.g}, ${this._coverColors.primary.b}`;
            const size = this._islandConfig.glowDensity || 20;
            const island = document.getElementById('dynamic-island');
            if (island) {
                island.style.setProperty('--island-glow-color', primaryHex);
                island.style.setProperty('--island-glow-rgb', primaryRgbStr);
                if (this.musicData && this.musicData.isPlaying) {
                    island.style.boxShadow = '';
                } else {
                    island.style.boxShadow = ThemeService.buildIslandShadow(size, primaryRgbStr, true);
                }
            }
        }
    },
};
