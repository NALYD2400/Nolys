/** Interface des horloges ; les mises à jour temporelles gardent les champs et le focus. */
import { TimerState, TIMER_STATE_KEY, MAX_TIMERS, parseTimerInput, formatTimerPreset, createTimerState, validateTimerState } from '../features/timer-state.js';
import { SoundService } from '../../../services/SoundService.js';
import { escapeHtml } from '../helpers/format.js';
import { readJSON } from '../../../shared/safe-storage.js';

const PRESETS_KEY = 'liquid_timer_presets';
const DEFAULT_PRESETS = [60, 300, 600, 1500];
const pad = number => String(number).padStart(2, '0');
const displayTime = total => total >= 3600
    ? `${Math.floor(total / 3600)}:${pad(Math.floor(total / 60) % 60)}:${pad(total % 60)}`
    : `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;

export const timerView = {
    parseTimerDuration: parseTimerInput,
    initTimerState() {
        const snapshot = readJSON(TIMER_STATE_KEY, createTimerState(), validateTimerState);
        this._timers = new TimerState(snapshot);
        Object.defineProperties(this, {
            timerMode: { configurable: true, get: () => this._timers.state.mode },
            timerValue: { configurable: true, get: () => this._timers.value },
            timerPreset: { configurable: true, get: () => this._timers.selected.presetMs / 1000 },
            isTimerRunning: { configurable: true, get: () => this._timers.running },
        });
        this._timerPresets = [...DEFAULT_PRESETS];
        try {
            const saved = JSON.parse(localStorage.getItem(PRESETS_KEY) || 'null');
            if (Array.isArray(saved) && saved.length === 4 && saved.every(n => Number.isInteger(n) && n > 0 && n <= 99 * 3600)) this._timerPresets = saved;
        } catch { /* durées par défaut */ }
        // Au retour de veille ou au rechargement de la WebView, rattraper sans attendre un rappel.
        this._timerResume = () => this.tickTimers();
        window.addEventListener('focus', this._timerResume);
        document.addEventListener('visibilitychange', this._timerResume);
        window.addEventListener('nolys-preferences-restored', () => {
            this._timers = new TimerState(readJSON(TIMER_STATE_KEY, createTimerState(), validateTimerState));
            this._timerPresets = readJSON(PRESETS_KEY, DEFAULT_PRESETS, value => Array.isArray(value) && value.length === 4
                && value.every(n => Number.isInteger(n) && n > 0 && n <= 99 * 3600));
            this.tickTimers();
            if (this.isExpanded && this.mode === 'timer') this.renderTimer();
        });
    },

    persistTimers() {
        try {
            localStorage.setItem(TIMER_STATE_KEY, JSON.stringify(this._timers.state));
            this._timerSaveFailed = false;
        } catch { this._timerSaveFailed = true; }
    },

    tickTimers() {
        if (!this._timers) return;
        const due = this._timers.tick();
        if (due.length) {
            this.persistTimers();
            this.onCountdownDone(due);
        }
        if (this.isExpanded && this.mode === 'timer') this.updateTimerDisplay();
        this.syncCompactActivity?.();
        this.syncTimerSatellite();
    },

    syncTimerSize() {
        // La destination du morph doit exister même quand le contenu est vidé à l'ouverture.
        this.el.dataset.timerMode = this.timerMode;
        this.el.toggleAttribute('data-timer-settings-open', this.timerMode === 'countdown' && Boolean(this._timerSettingsOpen));
    },

    renderTimer() {
        if (!this.isExpanded || this.mode !== 'timer') { this.syncTimerSatellite(); return; }
        this.syncTimerSize();
        const countdown = this.timerMode === 'countdown';
        const timer = this._timers.selected;
        this.content.innerHTML = `
            <div class="island-timer-container" data-mode="${this.timerMode}">
                <div class="island-timer-header">
                    <div class="timer-mode" role="group" aria-label="Mode">
                        <button type="button" data-timer-action="stopwatch" aria-pressed="${!countdown}" class="${countdown ? '' : 'on'}">Chrono</button>
                        <button type="button" data-timer-action="countdown" aria-pressed="${countdown}" class="${countdown ? 'on' : ''}">Minuteurs</button>
                    </div>
                    <button type="button" class="island-action-btn menu-btn" data-island-action="setMode" data-arg="menu" title="Menu des modules" aria-label="Menu des modules"><i class="ph ph-squares-four"></i></button>
                </div>
                ${countdown ? `<div class="timer-management">
                    <div class="timer-selector-row">
                        <select class="timer-select" aria-label="Minuteur sélectionné">${this._timers.state.timers.map(item => `<option value="${item.id}" ${item.id === timer.id ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}</select>
                        <button type="button" class="timer-small-btn" data-timer-action="add" aria-label="Ajouter un minuteur" title="Ajouter un minuteur" ${this._timers.state.timers.length >= MAX_TIMERS ? 'disabled' : ''}><i class="ph ph-plus"></i></button>
                    </div>
                </div>` : ''}
                <div class="timer-stage">
                    <div class="timer-status"></div>
                    <div class="timer-readout" role="timer" aria-label="Temps"></div>
                    <div class="timer-controls">
                        <button type="button" class="timer-control-btn" data-timer-action="reset" aria-label="Réinitialiser" title="Réinitialiser"><i class="ph-bold ph-arrow-counter-clockwise"></i></button>
                        <button type="button" class="timer-control-btn primary" data-timer-action="toggle"><i class="ph-fill ph-play"></i></button>
                    </div>
                </div>
                ${countdown ? `
                <div class="timer-presets" aria-label="Durées rapides">${this._timerPresets.map((seconds, index) => `<button type="button" class="timer-preset ${this.timerPreset === seconds ? 'on' : ''}" data-preset="${index}" title="${formatTimerPreset(seconds)} — F2 ou clic droit pour modifier">${formatTimerPreset(seconds)}</button>`).join('')}</div>
                <details class="timer-settings" ${this._timerSettingsOpen ? 'open' : ''}>
                    <summary><i class="ph ph-sliders-horizontal" aria-hidden="true"></i> Modifier le minuteur<i class="ph ph-caret-down timer-settings-caret" aria-hidden="true"></i></summary>
                    <div class="timer-settings-fields">
                        <label class="timer-field">Nom<input class="timer-name-input" maxlength="40" value="${escapeHtml(timer.name)}" aria-label="Nom du minuteur" placeholder="Nom du minuteur"></label>
                        <label class="timer-field">Durée<div class="timer-duration-row"><input class="timer-duration-input" value="${displayTime(timer.presetMs / 1000)}" aria-label="Durée personnalisée" placeholder="25 · 1h30 · 1:30:00"><button type="button" class="timer-small-btn" data-timer-action="duration">Appliquer</button></div></label>
                        <div class="timer-settings-footer"><span class="timer-policy">Continue en veille et après fermeture.<br>Alarme au retour.</span><button type="button" class="timer-small-btn" data-timer-action="remove" aria-label="Retirer le minuteur arrêté" title="Retirer le minuteur arrêté" ${this._timers.state.timers.length === 1 || timer.deadline !== null ? 'disabled' : ''}><i class="ph ph-trash" aria-hidden="true"></i></button></div>
                    </div>
                </details>` : ''}
                <div class="timer-message" role="status"></div>
            </div>`;
        const root = this.content.querySelector('.island-timer-container');
        root.querySelector('.timer-settings')?.addEventListener('toggle', event => {
            this._timerSettingsOpen = event.target.open;
            this.syncTimerSize();
        });
        root.addEventListener('click', event => {
            // Le menu est traité par la délégation de .island-content.
            if (event.target.closest('[data-island-action]')) return;
            event.stopPropagation();
            const preset = event.target.closest('[data-preset]');
            const button = event.target.closest('[data-timer-action]');
            if (!preset && !button) return;
            if (preset) { this.setTimerPreset(this._timerPresets[Number(preset.dataset.preset)]); return; }
            const action = button.dataset.timerAction;
            if (action === 'stopwatch' || action === 'countdown') this.setTimerMode(action);
            else if (action === 'toggle') this.toggleTimer();
            else if (action === 'reset') this.resetTimer();
            else if (action === 'add') { this._timers.add(); this._timerSettingsOpen = true; this.persistTimers(); this.renderTimer(); this.content.querySelector('.timer-name-input')?.focus(); }
            else if (action === 'remove') { this._timers.remove(); this.persistTimers(); this.renderTimer(); this.content.querySelector('.timer-select')?.focus(); }
            else if (action === 'duration') this.applyTimerDuration();
        });
        root.addEventListener('contextmenu', event => {
            const button = event.target.closest('[data-preset]');
            if (!button) return;
            event.preventDefault(); event.stopPropagation(); this.editTimerPreset(Number(button.dataset.preset));
        });
        root.addEventListener('keydown', event => {
            const preset = event.target.closest('[data-preset]');
            // Laisser le raccourci du menu global remonter, sauf sur un préréglage éditable.
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10' && !preset)) return;
            event.stopPropagation();
            if (preset && (event.key === 'F2' || (event.shiftKey && event.key === 'F10'))) {
                event.preventDefault(); this.editTimerPreset(Number(preset.dataset.preset));
            } else if (event.target.matches('.timer-duration-input') && event.key === 'Enter') {
                event.preventDefault(); this.applyTimerDuration();
            } else if (event.target.matches('.timer-name-input') && event.key === 'Enter') {
                event.preventDefault(); event.target.blur();
            }
        });
        root.querySelector('.timer-select')?.addEventListener('change', event => {
            this._timers.select(event.target.value); this.persistTimers(); this.renderTimer(); this.content.querySelector('.timer-select')?.focus();
        });
        root.querySelector('.timer-name-input')?.addEventListener('change', event => {
            this._timers.rename(event.target.value);
            event.target.value = this._timers.selected.name;
            root.querySelector('.timer-select').selectedOptions[0].textContent = this._timers.selected.name;
            this.persistTimers();
        });
        // Un clic dans un champ ne doit pas replier la pilule.
        root.querySelectorAll('input, select').forEach(input => input.addEventListener('click', event => event.stopPropagation()));
        this.updateTimerDisplay();
        this.syncTimerSatellite();
    },

    updateTimerDisplay() {
        const root = this.content.querySelector('.island-timer-container');
        if (!root) return;
        const timer = this._timers.selected;
        root.querySelector('.timer-readout').textContent = displayTime(this.timerValue);
        root.querySelector('.timer-status').textContent = this.isTimerRunning ? 'En cours' : this.timerMode === 'countdown'
            ? timer.completed ? 'Terminé' : timer.remainingMs === timer.presetMs ? 'Prêt' : 'En pause'
            : this.timerValue > 0 ? 'En pause' : 'Prêt';
        const toggle = root.querySelector('[data-timer-action="toggle"]');
        const label = this.isTimerRunning ? 'Pause' : 'Démarrer';
        toggle.title = label; toggle.setAttribute('aria-label', label);
        toggle.classList.toggle('is-running', this.isTimerRunning);
        toggle.firstElementChild.className = `ph-fill ${this.isTimerRunning ? 'ph-pause' : 'ph-play'}`;
        const remove = root.querySelector('[data-timer-action="remove"]');
        if (remove) remove.disabled = this._timers.state.timers.length === 1 || timer.deadline !== null;
        if (this._timerSaveFailed) root.querySelector('.timer-message').textContent = 'État non enregistré : stockage indisponible.';
    },

    setTimerMode(mode) {
        if (this._timers.setMode(mode)) { this.persistTimers(); this.renderTimer(); this.content.querySelector(`[data-timer-action="${mode}"]`)?.focus(); }
    },
    setTimerPreset(seconds) {
        if (!this._timers.setDuration(seconds)) return;
        this.persistTimers(); this.renderTimer();
        this.content.querySelector(`[data-preset="${this._timerPresets.indexOf(seconds)}"]`)?.focus();
    },
    applyTimerDuration() {
        const input = this.content.querySelector('.timer-duration-input');
        const seconds = this.parseTimerDuration(input.value);
        if (seconds === null) {
            input.setAttribute('aria-invalid', 'true');
            this.content.querySelector('.timer-message').textContent = 'Durée invalide : 25 (minutes), 1h30 ou 1:30:00, jusqu’à 99 h.';
            input.focus(); return;
        }
        this.setTimerPreset(seconds);
        this.content.querySelector('.timer-duration-input')?.focus();
    },
    toggleTimer() { this.tickTimers(); this._timers.toggle(); this.persistTimers(); this.updateTimerDisplay(); this.syncTimerSatellite(); },
    resetTimer() { this._timers.reset(); this.persistTimers(); this.updateTimerDisplay(); this.syncTimerSatellite(); },

    editTimerPreset(index) {
        if (!Number.isInteger(index) || index < 0 || index >= this._timerPresets.length) return;
        const button = this.content.querySelector(`[data-preset="${index}"]`);
        if (!button || button.querySelector('input')) return;
        const input = document.createElement('input');
        input.className = 'timer-preset-input'; input.value = displayTime(this._timerPresets[index]);
        input.setAttribute('aria-label', 'Nouvelle durée rapide');
        button.replaceWith(input); input.focus(); input.select();
        let done = false;
        const finish = (save, restoreFocus = true) => {
            if (done) return;
            const seconds = save ? this.parseTimerDuration(input.value) : null;
            if (save && seconds === null) { input.setAttribute('aria-invalid', 'true'); return; }
            done = true;
            if (save) {
                this._timerPresets[index] = seconds;
                try { localStorage.setItem(PRESETS_KEY, JSON.stringify(this._timerPresets)); } catch { this._timerSaveFailed = true; }
            }
            button.textContent = formatTimerPreset(this._timerPresets[index]);
            button.title = `${formatTimerPreset(this._timerPresets[index])} — F2 ou clic droit pour modifier`;
            button.classList.toggle('on', this.timerPreset === this._timerPresets[index]);
            input.replaceWith(button);
            if (restoreFocus) button.focus();
            this.updateTimerDisplay();
        };
        input.addEventListener('keydown', event => {
            event.stopPropagation();
            if (event.key === 'Enter') { event.preventDefault(); finish(true); }
            if (event.key === 'Escape') { event.preventDefault(); finish(false); }
        });
        input.addEventListener('blur', () => finish(false, false));
        input.addEventListener('click', event => event.stopPropagation());
    },

    initTimerSatellite() {
        this._timerSatellite = document.getElementById('island-timer-satellite');
        this._timerSatellite?.addEventListener('click', event => {
            event.stopPropagation();
            const active = this._timers.satellite;
            if (active?.id) this._timers.select(active.id); else if (active) this._timers.setMode('stopwatch');
            this.persistTimers(); this.openExpandedMode('timer');
        });
        this.positionMicSatellite(); this.syncSatelliteTheme(); this.syncTimerSatellite();
    },
    syncTimerSatellite() {
        const bubble = this._timerSatellite;
        if (!bubble) return;
        const active = this._timers.satellite;
        const total = active?.value || 0;
        const wide = total >= 60, hours = total >= 3600;
        const label = total < 60 ? String(total) : displayTime(total).replace(/^0(?=\d:)/, '');
        const value = bubble.querySelector('.satellite-timer-value');
        if (value) value.textContent = label;
        bubble.classList.toggle('is-wide', wide); bubble.classList.toggle('is-hours', hours);
        bubble.classList.toggle('is-stopwatch', active?.mode !== 'countdown');
        const visible = Boolean(active) && !this.isExpanded && this._compactActivityKind !== 'timer';
        bubble.classList.toggle('is-visible', visible);
        bubble.tabIndex = visible ? 0 : -1;
        bubble.setAttribute('aria-hidden', String(!visible));
        bubble.style.setProperty('--timer-pct', String(active?.preset ? Math.min(100, Math.round(total / active.preset * 100)) : 100));
        const title = active ? `${active.name} : ${displayTime(total)}${active.count > 1 ? ` (${active.count} minuteurs en cours)` : ''}. Cliquer pour ouvrir.` : 'Ouvrir les horloges';
        bubble.title = title; bubble.setAttribute('aria-label', title);
        this.positionMicSatellite?.();
    },
    onCountdownDone(timers) {
        try { SoundService.play('success'); } catch { /* audio indisponible : l'annonce visuelle reste */ }
        this.showIslandFeedback(`${timers.map(timer => timer.name).join(', ')} : terminé`, 'ph-timer');
    },
};
