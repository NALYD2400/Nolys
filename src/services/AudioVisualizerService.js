import { ipcRenderer } from '../shared/ipc.js';

/**
 * AudioVisualizerService
 * Reads the native Windows audio meter (WASAPI, via the Rust core) and turns it into
 * responsive visualizer bands, with a simulation fallback if WASAPI is unavailable.
 */

class AudioVisualizerService {
    constructor() {
        this.audioContext = null;
        this.analyser = null;
        this.dataArray = null;
        this.source = null;
        this.stream = null;
        this.isRunning = false;
        this.subscribers = new Set();
        this._animFrame = null;
        this._frameTimer = null;
        this._fallbackMode = false; // If loopback fails, use smart simulation
        this._simPhase = 0;
        this._simBeatTimer = 0;
        this._simBPM = 120;
        this._simAmplitude = 0;
        this._meterPeak = 0;
        this._meterTargetPeak = 0;
        this._meterLeft = 0;
        this._meterRight = 0;
        this._meterLastPoll = 0;
        this._meterPollInFlight = false;
        this.currentMode = null;
        this._isLoopActive = false;
        this._isActive = false;
        this._targetFps = 24;
        this._lastFrame = 0;
        this._ampFrame = null;
        this._ecoMode = localStorage.getItem('liquid_eco_mode') === 'true';
    }

    /**
     * Start audio capture and analysis.
     * Tries to capture system audio (loopback) in Electron.
     * Falls back to a smart music-reactive simulation if unavailable.
     */
    async start() {
        if (this.isRunning || this._ecoMode) return;
        this.isRunning = true;

        const mode = localStorage.getItem('liquid_visualizer_mode') || 'real';
        this.currentMode = mode;
        if (mode === 'simulation') {
            this._fallbackMode = false;
            this._startSimulation();
        } else {
            try {
                await this._startNativeWasapiMeter();
            } catch (err) {
                console.warn('[Visualizer] Native audio meter failed, using simulation mode:', err.message);
                this._fallbackMode = true;
                this._startSimulation();
            }
        }
    }

    async setMode(mode) {
        if (!this.isRunning) return;
        if (this.currentMode === mode) return;
        this.currentMode = mode;

        // Stop current animation frame, stream, context
        this._cancelFrame();
        this._isLoopActive = false;

        if (this.source) {
            try { this.source.disconnect(); } catch (e) { }
            this.source = null;
        }

        if (this.audioContext) {
            try { this.audioContext.close(); } catch (e) { }
            this.audioContext = null;
            this.analyser = null;
        }

        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
        }

        if (mode === 'simulation') {
            console.log('[Visualizer] Switching to Simulation Mode...');
            this._fallbackMode = false;
            this._startSimulation();
        } else {
            console.log('[Visualizer] Switching to Real Native WASAPI Meter Mode...');
            this._fallbackMode = false;
            try {
                await this._startNativeWasapiMeter();
            } catch (err) {
                console.warn('[Visualizer] Native audio meter failed on mode switch, using simulation mode:', err.message);
                this._fallbackMode = true;
                this._startSimulation();
            }
        }
    }

    _startLoopIfNeeded() {
        if (this._ecoMode || !this._isActive || this.subscribers.size === 0) return;
        if (this._isLoopActive) return;
        this._isLoopActive = true;
        if (this.currentMode === 'simulation' || this._fallbackMode) {
            this._simTick();
        } else if (this.currentMode === 'real' && !this.analyser) {
            this._meterTick();
        } else {
            this._tick();
        }
    }

    async _startNativeWasapiMeter() {
        const meter = await ipcRenderer.invoke('get-audio-meter');
        this._meterTargetPeak = this._clamp01(Number(meter?.peak || 0));
        this._meterLeft = this._clamp01(Number(meter?.left ?? meter?.peak ?? 0));
        this._meterRight = this._clamp01(Number(meter?.right ?? meter?.peak ?? 0));
        this._meterPeak = this._meterTargetPeak;
        this._meterLastPoll = 0;
        this._fallbackMode = false;
        console.log('[Visualizer] Native WASAPI audio meter started successfully!');
        this._startLoopIfNeeded();
    }

    setActive(isActive) {
        const nextActive = Boolean(isActive) && !this._ecoMode;
        if (this._isActive === nextActive) return;

        this._isActive = nextActive;

        if (!nextActive) {
            this._cancelFrame();
            this._isLoopActive = false;
            return;
        }

        if (this.isRunning) {
            this._startLoopIfNeeded();
        }
    }

    _meterTick(timestamp = 0) {
        if (!this.isRunning || !this._isActive || this.currentMode !== 'real' || this._fallbackMode) {
            this._isLoopActive = false;
            return;
        }

        this._requestFrame((nextTimestamp) => this._meterTick(nextTimestamp));
        if (!this._shouldRenderFrame(timestamp)) return;

        const now = performance.now();
        if (!this._meterPollInFlight && now - this._meterLastPoll > 80) {
            this._meterLastPoll = now;
            this._meterPollInFlight = true;
            try {
                ipcRenderer.invoke('get-audio-meter').then((meter) => {
                    this._meterTargetPeak = this._clamp01(Number(meter?.peak || 0));
                    this._meterLeft = this._clamp01(Number(meter?.left ?? meter?.peak ?? 0));
                    this._meterRight = this._clamp01(Number(meter?.right ?? meter?.peak ?? 0));
                }).catch(() => {
                    this._meterTargetPeak = 0;
                    this._meterLeft = 0;
                    this._meterRight = 0;
                }).finally(() => {
                    this._meterPollInFlight = false;
                });
            } catch {
                this._meterPollInFlight = false;
            }
        }

        this._meterPeak += (this._meterTargetPeak - this._meterPeak) * 0.34;

        // Gain automatique : le niveau est rapporté au maximum des dernières secondes, pour
        // que les barres bougent autant à faible volume (Windows, lecteur ou morceau calme)
        // qu'à fort volume. En dessous de -54 dB, c'est du silence : rien n'est amplifié.
        this._agcRef = Math.max(this._meterPeak, (this._agcRef || 0.25) * 0.996, 0.02);
        const normalized = this._meterTargetPeak < 0.002 ? 0 : this._meterPeak / this._agcRef;
        const sensitivity = parseFloat(localStorage.getItem('liquid_visualizer_sensitivity') || '2.5');
        // La sensibilité garde son rôle (2,5 = réglage par défaut = niveau normalisé tel quel).
        const peak = this._clamp01(normalized * 0.85 * Math.sqrt(sensitivity / 2.5));
        const stereoWidth = Math.abs(this._meterLeft - this._meterRight);
        const t = now / 1000;

        const bands = peak <= 0.004
            ? [0, 0, 0, 0, 0]
            : [
                this._clamp01(peak * (0.95 + Math.sin(t * 8.1) * 0.05)),
                this._clamp01(peak * (0.72 + stereoWidth * 0.25 + Math.sin(t * 5.3 + 0.7) * 0.08)),
                this._clamp01(peak * (0.58 + Math.sin(t * 6.7 + 1.4) * 0.1)),
                this._clamp01(peak * (0.42 + stereoWidth * 0.2 + Math.sin(t * 9.2 + 2.1) * 0.08)),
                this._clamp01(peak * (0.28 + Math.sin(t * 12.5 + 2.8) * 0.06))
            ];

        this._notify({ bands, raw: null, isSimulation: false, source: 'native-wasapi-meter' });
    }

    _startSimulation() {
        // Smart simulation: creates musical-looking bars that sync with the beat
        this._simPhase = 0;
        this._simBeatTimer = 0;
        this._simAmplitude = 0.85;
        this._startLoopIfNeeded();
    }

    _tick(timestamp = 0) {
        if (!this.isRunning || !this._isActive || !this.analyser || this.currentMode !== 'real') {
            this._isLoopActive = false;
            return;
        }

        this._requestFrame((nextTimestamp) => this._tick(nextTimestamp));
        if (!this._shouldRenderFrame(timestamp)) return;

        this.analyser.getByteFrequencyData(this.dataArray);

        // Extract key frequency bands (bass, mid, treble)
        const bufLen = this.dataArray.length;
        const bass = this._average(this.dataArray, 0, Math.floor(bufLen * 0.1));
        const lowMid = this._average(this.dataArray, Math.floor(bufLen * 0.1), Math.floor(bufLen * 0.25));
        const mid = this._average(this.dataArray, Math.floor(bufLen * 0.25), Math.floor(bufLen * 0.5));
        const highMid = this._average(this.dataArray, Math.floor(bufLen * 0.5), Math.floor(bufLen * 0.75));
        const treble = this._average(this.dataArray, Math.floor(bufLen * 0.75), bufLen);

        // Retrieve visualizer sensitivity from localStorage (default 2.5)
        const sensitivity = parseFloat(localStorage.getItem('liquid_visualizer_sensitivity') || '2.5');

        this._notify({
            bands: [bass, lowMid, mid, highMid, treble].map(v => Math.min(1.0, (v / 255) * sensitivity)),
            raw: this.dataArray,
            isSimulation: false
        });

    }

    _simTick(timestamp = 0) {
        if (!this.isRunning || !this._isActive || (this.currentMode !== 'simulation' && !this._fallbackMode)) {
            this._isLoopActive = false;
            return;
        }

        if (this._simAmplitude <= 0) {
            // Smooth fade out: notify zero levels and stop requestAnimationFrame
            this._notify({ bands: [0, 0, 0, 0, 0], raw: null, isSimulation: true });
            this._isLoopActive = false;
            this._animFrame = null;
            return;
        }

        this._requestFrame((nextTimestamp) => this._simTick(nextTimestamp));
        if (!this._shouldRenderFrame(timestamp)) return;

        const t = performance.now() / 1000;
        const bps = this._simBPM / 60;

        // Create organic movement based on sine waves at musical frequencies
        const beat = Math.abs(Math.sin(t * bps * Math.PI)); // 0-1 beat pulse
        const beatSharp = Math.pow(beat, 3); // Sharper beat attack

        // Five frequency bands with musical characteristics
        const bands = [
            // Bass: strong beat punch
            Math.min(1, beatSharp * 0.9 + Math.abs(Math.sin(t * bps * Math.PI * 0.5)) * 0.3 + Math.random() * 0.08),
            // Low mid: medium beat response
            Math.min(1, Math.abs(Math.sin(t * bps * Math.PI + 0.3)) * 0.7 + Math.abs(Math.sin(t * 2.3)) * 0.2 + Math.random() * 0.07),
            // Mid: melodic variation
            Math.min(1, Math.abs(Math.sin(t * bps * Math.PI * 1.5 + 0.7)) * 0.6 + Math.abs(Math.sin(t * 3.7)) * 0.25 + Math.random() * 0.06),
            // High mid: harmony
            Math.min(1, Math.abs(Math.sin(t * bps * Math.PI * 2 + 1.2)) * 0.5 + Math.abs(Math.sin(t * 5.1)) * 0.2 + Math.random() * 0.05),
            // Treble: sparkle
            Math.min(1, Math.abs(Math.sin(t * bps * Math.PI * 3 + 1.8)) * 0.35 + Math.random() * 0.15)
        ].map(v => v * this._simAmplitude);

        this._notify({ bands, raw: null, isSimulation: true });
    }

    /**
     * Planifie l'image suivante au rythme du visualiseur (24 i/s) au lieu de
     * celui de l'écran : un requestAnimationFrame continu réveillerait la page
     * jusqu'à 360 fois par seconde sur un écran 360 Hz pour rien.
     */
    _requestFrame(callback) {
        const frameInterval = 1000 / this._targetFps;
        const wait = Math.max(0, this._lastFrame + frameInterval - performance.now() - 4);
        this._frameTimer = setTimeout(() => {
            this._frameTimer = null;
            this._animFrame = requestAnimationFrame(callback);
        }, wait);
    }

    _cancelFrame() {
        if (this._frameTimer) {
            clearTimeout(this._frameTimer);
            this._frameTimer = null;
        }
        if (this._animFrame) {
            cancelAnimationFrame(this._animFrame);
            this._animFrame = null;
        }
    }

    _shouldRenderFrame(timestamp = 0) {
        const frameInterval = 1000 / this._targetFps;
        if (timestamp - this._lastFrame < frameInterval) return false;
        this._lastFrame = timestamp - ((timestamp - this._lastFrame) % frameInterval);
        return true;
    }

    _average(arr, start, end) {
        let sum = 0;
        for (let i = start; i < end; i++) sum += arr[i];
        return sum / Math.max(1, end - start);
    }

    _clamp01(value) {
        if (!Number.isFinite(value)) return 0;
        return Math.max(0, Math.min(1, value));
    }

    _notify(data) {
        this.subscribers.forEach(cb => {
            try { cb(data); } catch (e) { /* ignore */ }
        });
    }

    /**
     * Subscribe to audio data. Returns unsubscribe function.
     * @param {Function} callback - Called with {bands: number[], raw: Uint8Array, isSimulation: boolean}
     */
    subscribe(callback) {
        this.subscribers.add(callback);
        if (this._isActive) {
            this._startLoopIfNeeded();
        }
        return () => this.subscribers.delete(callback);
    }

    /**
     * Update the playback state (used to modulate simulation amplitude).
     * @param {boolean} isPlaying
     * @param {number} bpm - Estimated BPM (optional)
     */
    setPlaybackState(isPlaying, bpm = 120) {
        this._simBPM = bpm;
        const targetAmplitude = isPlaying ? 0.85 : 0;

        if (!this._isActive) {
            this._simAmplitude = targetAmplitude;
            return;
        }

        if (isPlaying) {
            this._startLoopIfNeeded();
        }

        // Smooth amplitude transition
        const step = () => {
            const diff = targetAmplitude - this._simAmplitude;
            if (Math.abs(diff) < 0.01) {
                this._simAmplitude = targetAmplitude;
                this._ampFrame = null;
                return;
            }
            this._simAmplitude += diff * 0.08;
            
            if (isPlaying) {
                this._startLoopIfNeeded();
            }
            
            this._ampFrame = requestAnimationFrame(step);
        };
        if (!this._ampFrame) step();
    }

    setEcoMode(enabled) {
        this._ecoMode = Boolean(enabled);
        if (this._ecoMode) {
            this.setActive(false);
            this.stop();
        }
    }

    stop() {
        this.isRunning = false;

        this._cancelFrame();
        if (this._ampFrame) {
            cancelAnimationFrame(this._ampFrame);
            this._ampFrame = null;
        }
        this._isLoopActive = false;

        if (this.source) {
            try { this.source.disconnect(); } catch (e) { }
            this.source = null;
        }

        if (this.audioContext) {
            try { this.audioContext.close(); } catch (e) { }
            this.audioContext = null;
            this.analyser = null;
        }

        if (this.stream) {
            this.stream.getTracks().forEach(t => t.stop());
            this.stream = null;
        }
        this._lastFrame = 0;
    }
}

// Singleton
export const visualizerService = new AudioVisualizerService();
