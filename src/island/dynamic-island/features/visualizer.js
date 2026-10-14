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
        } else if (mode === 'cyberpunk') {
            from = { r: 0, g: 229, b: 255 };
            to = { r: 188, g: 19, b: 254 };
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

    /** Nombre de barres choisi dans les réglages (3 à 9). */
    getVizBarCount() {
        const count = Math.round(Number(this._islandConfig.vizBars) || 5);
        return Math.max(3, Math.min(9, count));
    },

    /** Largeur du visualiseur selon le style et le nombre de barres (les points ont besoin d'air). */
    getVizWidth(barW) {
        const count = this.getVizBarCount();
        if (this._islandConfig.vizStyle === 'dots') return count * 8 - 2;
        if (this._islandConfig.vizStyle === 'wave') return count * 6;
        return count * barW + (count - 1) * 2.5;
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

        // Barres animées : chacune vise une hauteur tirée au hasard autour du niveau, à son rythme.
        const count = Number(canvas.dataset.bars) || 5;
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
        for (const bar of this._vizBars) {
            // Monte vite, redescend en douceur.
            bar.value += (bar.target - bar.value) * (bar.target > bar.value ? 0.45 : 0.18);
        }

        const style = this._islandConfig.vizStyle || 'capsules';
        const glow = this._islandConfig.vizGlow !== false;
        const colors = this._getVizColors(count);
        const rgba = (i, alpha) => `rgba(${colors[i][0]}, ${colors[i][1]}, ${colors[i][2]}, ${alpha})`;
        const barW = Number(canvas.dataset.barWidth) || 3;
        const step = count > 1 ? (cssW - barW) / (count - 1) : 0;

        if (style === 'wave') {
            // Onde façon Siri : une ligne qui ondule de haut en bas, plus une seconde en
            // miroir, plus discrète. Les extrémités restent au centre.
            const mid = cssH / 2;
            const amps = this._vizBars.map((bar) => Math.max(0.06, Math.min(1, bar.value)) * (mid - 1.5));
            const xs = this._vizBars.map((_, i) => ((i + 1) / (count + 1)) * cssW);
            const trace = (flip) => {
                ctx.beginPath();
                ctx.moveTo(0, mid);
                let px = 0;
                let py = mid;
                xs.forEach((x, i) => {
                    const y = mid + (i % 2 ? -1 : 1) * flip * amps[i];
                    const cx = (px + x) / 2;
                    ctx.bezierCurveTo(cx, py, cx, y, x, y);
                    px = x;
                    py = y;
                });
                const cx = (px + cssW) / 2;
                ctx.bezierCurveTo(cx, py, cx, mid, cssW, mid);
            };
            const gradient = ctx.createLinearGradient(0, 0, cssW, 0);
            gradient.addColorStop(0, rgba(0, 0.95));
            gradient.addColorStop(1, rgba(count - 1, 0.95));
            ctx.strokeStyle = gradient;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            if (glow) {
                ctx.shadowColor = rgba(Math.floor(count / 2), 0.7);
                ctx.shadowBlur = 6;
            }
            ctx.globalAlpha = 0.4;
            ctx.lineWidth = 1.2;
            trace(-0.6);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.lineWidth = 2;
            trace(1);
            ctx.stroke();
        } else {
            for (let i = 0; i < count; i++) {
                const value = Math.min(1, this._vizBars[i].value);
                const x = i * step;
                if (glow) {
                    ctx.shadowColor = rgba(i, 0.55);
                    ctx.shadowBlur = 4 + value * 6;
                }
                ctx.fillStyle = rgba(i, 0.75 + value * 0.25);
                ctx.beginPath();
                if (style === 'dots') {
                    // Points qui gonflent avec le son, sans déborder du cadre.
                    const maxRadius = Math.min(cssH, cssW / count) / 2 - 0.5;
                    const minRadius = Math.min(1.5, maxRadius);
                    const cx = maxRadius + (count > 1 ? i * (cssW - 2 * maxRadius) / (count - 1) : 0);
                    ctx.arc(cx, cssH / 2, minRadius + value * (maxRadius - minRadius), 0, Math.PI * 2);
                } else if (style === 'bars') {
                    // Égaliseur classique : les barres montent depuis le bas.
                    const barH = Math.max(barW, value * cssH);
                    ctx.roundRect(x, cssH - barH, barW, barH, [barW / 2, barW / 2, 1, 1]);
                } else {
                    // Gélules centrées façon Apple.
                    const barH = Math.max(barW, value * cssH);
                    ctx.roundRect(x, (cssH - barH) / 2, barW, barH, barW / 2);
                }
                ctx.fill();
            }
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
                // Halo déjà posé tel quel (et personne n'y a touché depuis) : on ne réécrit pas le
                // style 24 fois par seconde, ce qui recalculait le style et réveillait à chaque
                // image l'observateur de la bulle d'activité.
                const playing = Boolean(this.musicData && this.musicData.isPlaying);
                const glowKey = `${primaryRgbStr}|${size}|${playing}`;
                const glow = this._vizGlowApplied;
                if (glow && glow.key === glowKey
                    && island.style.getPropertyValue('--island-glow-rgb') === primaryRgbStr
                    && island.style.boxShadow === glow.shadow) return;
                island.style.setProperty('--island-glow-color', primaryHex);
                island.style.setProperty('--island-glow-rgb', primaryRgbStr);
                if (playing) {
                    island.style.boxShadow = '';
                } else {
                    island.style.boxShadow = ThemeService.buildIslandShadow(size, primaryRgbStr, true);
                }
                this._vizGlowApplied = { key: glowKey, shadow: island.style.boxShadow };
            }
        }
    },
};
