/** Couleurs extraites de la pochette et thème dynamique. */
import { ThemeService } from '../../../services/ThemeService.js';
import { publishCover } from '../../../shared/cover-bus.js';
import { blendHexColors, hexToRgb, rgbToHex } from '../helpers/color.js';
import { getDisplayMediaArt, getRawDisplayMediaArt, isSocialFallbackIcon } from '../helpers/media-art.js';
import { getMusicHistoryKey } from '../helpers/music-search.js';

export const coverThemeMethods = {
    preloadMediaArt(artUrl, onReady) {
        if (!artUrl || this._preloadedMediaArt.has(artUrl)) {
            if (onReady) onReady();
            return;
        }

        if (this._pendingMediaArt.has(artUrl)) return;
        this._pendingMediaArt.add(artUrl);

        const img = new Image();
        if (artUrl.startsWith('http') || artUrl.startsWith('https')) {
            img.crossOrigin = "Anonymous";
        }

        const finish = (loaded) => {
            this._pendingMediaArt.delete(artUrl);
            if (loaded) this._preloadedMediaArt.add(artUrl);
            if (loaded && onReady) onReady();
        };

        img.onload = async () => {
            try {
                if (img.decode) await img.decode();
            } catch (e) {}
            finish(true);
        };
        img.onerror = () => finish(false);
        img.src = artUrl;
    },

    getStableDisplayArt(data) {
        const nextArt = getRawDisplayMediaArt(data);
        if (!nextArt) {
            this._lastStableDisplayArt = "";
            return "";
        }

        if (isSocialFallbackIcon(nextArt) || nextArt.startsWith('data:') || this._preloadedMediaArt.has(nextArt) || !this._lastStableDisplayArt) {
            this._lastStableDisplayArt = nextArt;
            this.preloadMediaArt(nextArt);
            return nextArt;
        }

        const preloadTrackKey = data.trackKey || getMusicHistoryKey(data);
        this.preloadMediaArt(nextArt, () => {
            const activeArt = getRawDisplayMediaArt(this.musicData);
            if (activeArt !== nextArt) return;
            const activeTrackKey = this.musicData ? (this.musicData.trackKey || getMusicHistoryKey(this.musicData)) : "";
            if (preloadTrackKey && activeTrackKey && preloadTrackKey !== activeTrackKey) return;

            this._lastStableDisplayArt = nextArt;
            this.musicData = {
                ...this.musicData,
                displayCover: nextArt,
                previousDisplayCover: "",
                animateCover: false
            };
            this._isNewTrackSignal = false;
            if (this._pendingCoverAnimationTrackKey === activeTrackKey) {
                this._pendingCoverAnimationTrackKey = "";
            }
            if (this._lastRenderedTrack) {
                this._lastRenderedTrack.cover = nextArt;
            }

            if (this.isExpanded && this.mode === 'music') {
                this.renderMusic();
            } else if (this.isExpanded && this.mode === 'control') {
                this.updateControlCenterCover(nextArt);
            } else if (!this.isExpanded) {
                this.renderIdle();
            }

            this.syncGlobalCoverAesthetics();
        });

        return this._lastStableDisplayArt;
    },

    updateControlCenterCover(artUrl) {
        const npCover = document.getElementById('ic-np-cover-img');
        if (!npCover || !artUrl) return;

        if (npCover.tagName === 'IMG') {
            npCover.src = artUrl;
            return;
        }

        const parent = npCover.parentNode;
        if (!parent) return;

        const img = document.createElement('img');
        img.id = 'ic-np-cover-img';
        img.className = 'ic-np-cover';
        img.src = artUrl;
        parent.replaceChild(img, npCover);
    },

    _extractColorsFromCover(coverUrl) {
        if (!coverUrl) {
            this._coverColors = null;
            return;
        }

        const img = new Image();
        if (coverUrl.startsWith('http') || coverUrl.startsWith('https')) {
            img.crossOrigin = "Anonymous";
        }
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = 10;
                canvas.height = 10;
                // Canvas CPU : échantillonnage identique d'une machine à l'autre (et à l'ancienne version).
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(img, 0, 0, 10, 10);
                const imgData = ctx.getImageData(0, 0, 10, 10).data;

                let rSum = 0, gSum = 0, bSum = 0, count = 0;
                let maxVibrancy = -1;
                let vibrantColor = null;

                for (let i = 0; i < imgData.length; i += 4) {
                    const r = imgData[i];
                    const g = imgData[i+1];
                    const b = imgData[i+2];
                    const a = imgData[i+3];

                    if (a < 200) continue; // skip transparent

                    rSum += r;
                    gSum += g;
                    bSum += b;
                    count++;

                    const maxVal = Math.max(r, g, b);
                    const minVal = Math.min(r, g, b);
                    const vibrancy = maxVal - minVal;
                    if (vibrancy > maxVibrancy) {
                        maxVibrancy = vibrancy;
                        vibrantColor = { r, g, b };
                    }
                }

                if (count > 0) {
                    const avgColor = {
                        r: Math.round(rSum / count),
                        g: Math.round(gSum / count),
                        b: Math.round(bSum / count)
                    };

                    const primary = vibrantColor && maxVibrancy > 30 ? vibrantColor : avgColor;
                    
                    let secondary = avgColor;
                    if (primary === avgColor && vibrantColor && maxVibrancy > 20) {
                        secondary = vibrantColor;
                    } else if (primary.r === secondary.r && primary.g === secondary.g && primary.b === secondary.b) {
                        secondary = {
                            r: Math.min(255, primary.r + 50),
                            g: Math.min(255, primary.g + 30),
                            b: Math.max(0, primary.b - 50)
                        };
                    }

                    this._coverColors = { primary, secondary };
                    this.applyCoverTheme();
                } else {
                    this._coverColors = null;
                    this.restorePresetTheme();
                }
            } catch (e) {
                console.error("Failed to extract colors from cover:", e);
                this._coverColors = null;
                this.restorePresetTheme();
            }
            // Le bouton lecture en verre prend la teinte de la nouvelle pochette.
            if (this.hasGlassSurfaces()) this.syncGlassControls();
        };
        img.onerror = () => {
            this._coverColors = null;
            this.restorePresetTheme();
        };
        img.src = coverUrl;
    },

    /**
     * Apply album cover colors as the active theme.
     * Overrides CSS custom properties on :root so every UI element
     * (sliders, badges, glow, progress bars, etc.) instantly syncs
     * to the dominant palette of the current album artwork.
     */
    applyCoverTheme() {
        if (!this._coverColors) return;
        // Check if cover color sync is enabled in settings
        if (localStorage.getItem('liquid_cover_color_sync') === 'false') return;

        const { primary, secondary } = this._coverColors;
        const priHex = rgbToHex(primary.r, primary.g, primary.b);
        const secHex = rgbToHex(secondary.r, secondary.g, secondary.b);
        const priRgbStr = `${primary.r}, ${primary.g}, ${primary.b}`;

        const effectiveArt = getDisplayMediaArt(this.musicData);

        localStorage.setItem('liquid_cover_colors', JSON.stringify({ 
            primary: priHex, 
            secondary: secHex, 
            rgb: priRgbStr,
            cover: effectiveArt
        }));

        const root = document.documentElement;
        root.style.setProperty('--neon-primary', priHex);
        root.style.setProperty('--neon-accent', priHex);
        root.style.setProperty('--neon-primary-rgb', priRgbStr);
        root.style.setProperty('--neon-secondary', secHex);

        // Also sync the glow color on the island element for live feedback
        const island = document.getElementById('dynamic-island');
        if (island && this._islandConfig.glowEnabled !== false) {
            const size = this._islandConfig.glowDensity || 20;
            const glowMode = this._islandConfig.glowColorMode || 'mix';
            const fixedColor = this._islandConfig.glowColor || '#D49460';
            const canUseCover = localStorage.getItem('liquid_cover_color_sync') !== 'false';

            let color = fixedColor;
            if (canUseCover && glowMode === 'cover') {
                color = priHex;
            } else if (canUseCover && glowMode === 'mix') {
                color = blendHexColors(fixedColor, priHex, this._islandConfig.glowBlend ?? 65);
            }

            const rgb = hexToRgb(color);
            const rgbStr = `${rgb.r}, ${rgb.g}, ${rgb.b}`;

            island.style.setProperty('--island-glow-color', color);
            island.style.setProperty('--island-glow-rgb', rgbStr);
            island.style.boxShadow = ThemeService.buildIslandShadow(size, rgbStr, true);
        }

        // Update blurred background layer for instant feedback in any mode
        const bgLayer = document.querySelector('.island-bg-layer');
        if (this.isExpanded && bgLayer) {
            const coverUrl = effectiveArt ? effectiveArt.replace(/\\/g, '/') : "";
            if (coverUrl && coverUrl.length > 0) {
                bgLayer.style.backgroundImage = `url("${coverUrl}")`;
                bgLayer.style.opacity = String(this.getPlayerCoverOpacity());
                bgLayer.style.filter = 'blur(24px) saturate(180%)';
            } else {
                bgLayer.style.backgroundImage = 'none';
                bgLayer.style.opacity = '0';
            }
        }

        // Fond des Réglages (ouverts dans l'Island) : pochette et couleurs du morceau.
        publishCover({ primary: priHex, secondary: secHex, rgb: priRgbStr, cover: effectiveArt });
    },

    /**
     * Restore the user's chosen preset theme colors.
     * Called when playback stops, pauses, or when no album art is available.
     */
    restorePresetTheme() {
        const PRESET_COLORS = {
            copper:    { primary: '#D49460', secondary: '#EDBC89' },
            cyberpunk: { primary: '#00f3ff', secondary: '#bc13fe' },
            sleek:     { primary: '#ffffff', secondary: '#888888' },
            emerald:   { primary: '#10b981', secondary: '#059669' },
            sunset:    { primary: '#ec4899', secondary: '#f97316' },
            glass:     { primary: '#8b5cf6', secondary: '#6366f1' }
        };

        const savedConfig = JSON.parse(localStorage.getItem('island_standalone_config') || '{}');
        const preset = savedConfig.preset || 'copper';
        const colors = PRESET_COLORS[preset] || PRESET_COLORS.copper;

        const rgb = hexToRgb(colors.primary);
        const rgbStr = `${rgb.r}, ${rgb.g}, ${rgb.b}`;

        localStorage.setItem('liquid_cover_colors', JSON.stringify({ primary: colors.primary, secondary: colors.secondary, rgb: rgbStr }));

        const root = document.documentElement;
        root.style.setProperty('--neon-primary', colors.primary);
        root.style.setProperty('--neon-accent', colors.primary);
        root.style.setProperty('--neon-primary-rgb', rgbStr);
        root.style.setProperty('--neon-secondary', colors.secondary);

        // Restore glow to preset color
        const island = document.getElementById('dynamic-island');
        if (island) {
            const glowColor = this._islandConfig.glowColor || colors.primary;
            const size = this._islandConfig.glowDensity || 20;
            const rgb = hexToRgb(glowColor);
            const rgbStr = `${rgb.r}, ${rgb.g}, ${rgb.b}`;

            island.style.setProperty('--island-glow-color', glowColor);
            island.style.setProperty('--island-glow-rgb', rgbStr);

            if (this._islandConfig.glowEnabled !== false) {
                if (this.musicData && this.musicData.isPlaying) {
                    island.style.boxShadow = '';
                } else {
                    island.style.boxShadow = ThemeService.buildIslandShadow(size, rgbStr, true);
                }
            } else {
                island.style.setProperty('--island-glow-opacity', '0');
                island.style.boxShadow = ThemeService.buildIslandShadow(0, '0, 243, 255', false);
            }
        }

        // Restore background layer
        const bgLayer = document.querySelector('.island-bg-layer');
        if (bgLayer) {
            const islandConfig = JSON.parse(localStorage.getItem('liquid_island_config') || '{}');
            if (islandConfig.bgImage) {
                bgLayer.style.backgroundImage = `url('${islandConfig.bgImage.replace(/\\/g, '/')}')`;
                bgLayer.style.opacity = (islandConfig.imgOpacity || 100) / 100;
                bgLayer.style.filter = `blur(${islandConfig.blur || 30}px)`;
            } else {
                bgLayer.style.backgroundImage = 'none';
                bgLayer.style.opacity = '0';
            }
        }

        // Couleurs rétablies : les Réglages suivent aussi.
        publishCover({ primary: colors.primary, secondary: colors.secondary, rgb: rgbStr });
    },

    /** Opacité de la pochette floutée dans l'Island ouverte (réglage « Pochette en fond du lecteur »). */
    getPlayerCoverOpacity() {
        const percent = Number(this._islandConfig?.playerCoverBg);
        return (Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : 50) * 0.009;
    },

    syncGlobalCoverAesthetics() {
        const data = this.musicData;
        const bgLayer = this.el.querySelector('.island-bg-layer');
        const effectiveArt = getDisplayMediaArt(data);
        if (data && effectiveArt && effectiveArt.length > 0) {
            // Apply cover theme colors to root CSS globally
            this.applyCoverTheme();
            
            // Set blurred background cover on the island if expanded
            if (this.isExpanded && bgLayer) {
                const cleanCover = effectiveArt.replace(/\\/g, '/');
                bgLayer.style.backgroundImage = `url("${cleanCover}")`;
                bgLayer.style.opacity = String(this.getPlayerCoverOpacity());
                bgLayer.style.filter = 'blur(24px) saturate(180%)';
            }
        } else {
            // No active media, restore standard theme and default background
            this.restorePresetTheme();
            if (bgLayer) {
                const islandConfig = JSON.parse(localStorage.getItem('liquid_island_config') || '{}');
                if (islandConfig.bgImage) {
                    bgLayer.style.backgroundImage = `url('${islandConfig.bgImage.replace(/\\/g, '/')}')`;
                    bgLayer.style.opacity = (islandConfig.imgOpacity || 100) / 100;
                    bgLayer.style.filter = `blur(${islandConfig.blur || 30}px)`;
                } else {
                    bgLayer.style.backgroundImage = 'none';
                    bgLayer.style.opacity = '0';
                }
            }
        }
    },
};
