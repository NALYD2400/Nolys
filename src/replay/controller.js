import { replay, initReplay } from './store.js';
import { activeCapture, duration, size } from './model.js';
import { escapeHtml as e } from '../island/dynamic-island/helpers/format.js';
import { createPanel } from '../library/panel.js';
import { readHotkeys } from '../shared/hotkeys.js';
import styles from './styles.css?inline';

let sheet;
const icon = name => `<i class="ph-bold ph-${name}" aria-hidden="true"></i>`;
const button = (action, label, glyph, extra = '') => `<button type="button" class="pill-btn${extra === 'primary' ? ' is-accent' : ''}" data-action="${action}"${action === 'dismiss' ? ' aria-label="Fermer le message"' : ''}>${icon(glyph)}<span>${label}</span></button>`;
const labels = { idle: 'Prêt à capturer', starting: 'Préparation de la capture…', buffering: 'Replay actif', stopping: 'Finalisation en cours…', error: 'Capture interrompue' };

export function mountReplay(host, { onClose, onBack, ready = Promise.resolve(), onFit, onRender = () => {} }) {
    const panel = createPanel(host, `<div class="lib replay-panel" tabindex="-1" aria-label="Replay et enregistrement Nolys"><header class="lib-header"><button type="button" class="round-btn" data-action="back" title="Menu" aria-label="Revenir au menu">${icon('caret-left')}</button><div class="lib-heading"><span>Replay & REC</span><small>Vos derniers instants, à portée de touche</small></div><button type="button" class="round-btn" data-action="folder" title="Dossier des vidéos" aria-label="Ouvrir le dossier des vidéos">${icon('folder-open')}</button><button type="button" class="round-btn" data-action="close" title="Fermer" aria-label="Fermer Replay">${icon('x')}</button></header><nav class="lib-chips replay-tabs" role="tablist" aria-label="Replay et enregistrement">${[['capture', 'Capture'], ['settings', 'Réglages'], ['clips', 'Clips']].map(([id, label]) => `<button type="button" class="chip" id="replay-tab-${id}" role="tab" data-tab="${id}" aria-controls="replay-content">${label}</button>`).join('')}</nav><div id="replay-feedback" role="status" aria-live="polite"></div><div class="lib-list replay-body" id="list"><section id="replay-content" role="tabpanel"></section></div><div class="lib-toast" id="toast" role="status" hidden></div><div class="lib-menu" id="menu" role="menu" hidden></div></div>`, { onFit });
    if (!sheet) { sheet = new CSSStyleSheet(); sheet.replaceSync(styles); }
    panel.root.adoptedStyleSheets = [...panel.root.adoptedStyleSheets, sheet];
    const { root, $, on } = panel;
    let destroyed = false, signature = '', dismissed = '', rendering = false;
    const options = (key, items) => `<select id="replay-${key}" data-setting="${key}">${items.map(([v, text]) => `<option value="${e(String(v))}" ${String(replay.state.draft?.[key]) === String(v) ? 'selected' : ''}>${e(text)}</option>`).join('')}</select>`;
    const row = (key, label, control, help = '') => `<div class="replay-row"><label for="replay-${key}">${label}${help ? `<small>${help}</small>` : ''}</label>${control}</div>`;
    const select = (key, label, items, help) => row(key, label, options(key, items), help);
    const number = (key, label, min, max, help = '') => row(key, label, `<input id="replay-${key}" data-setting="${key}" type="number" min="${min}" max="${max}" value="${replay.state.draft?.[key]}" inputmode="numeric">`, help);
    const check = (key, label, help = '') => row(key, label, `<input id="replay-${key}" data-setting="${key}" type="checkbox" ${replay.state.draft?.[key] ? 'checked' : ''}>`, help);
    const devices = list => [['', 'Par défaut de Windows'], ...list.map(device => [device.id, device.name])];

    function capture() {
        const { draft: c, sources } = replay.state;
        const sourceOptions = [['', 'Écran principal'], ...sources.map(source => [source.id, `${source.kind === 'monitor' ? '' : 'Fenêtre / jeu · '}${source.label}`])];
        if (c.sourceId && !sources.some(source => source.id === c.sourceId)) sourceOptions.push([c.sourceId, 'Source indisponible · choisissez à nouveau']);
        return `<div class="replay-source">${select('sourceId', 'Source à capturer', sourceOptions)}<button type="button" class="round-btn" data-action="refresh" aria-label="Actualiser les écrans, fenêtres et appareils" title="Actualiser">${icon('arrows-clockwise')}</button></div><div class="replay-session"><div class="replay-session-top"><span class="replay-signal" aria-hidden="true"></span><strong id="replay-phase"></strong><span id="replay-rec-time"></span></div><p id="replay-buffer-description"></p><progress id="replay-buffer-progress" max="${c.seconds}" value="0" aria-label="Durée de replay disponible"></progress><div class="replay-buffer-meta"><span id="replay-memory"></span><span>Objectif : ${duration(c.seconds)}</span></div></div><div class="replay-actions">${button('primary', 'Activer le replay', 'arrow-counter-clockwise', 'class="pill-btn is-accent"')}${button('record', 'Enregistrer', 'record')}${button('stop', 'Arrêter la capture', 'stop')}</div><p class="replay-hint" id="replay-hotkey"></p><div class="replay-summary"><span>${icon('monitor')} ${c.height ? `${c.height}p max.` : 'Taille de la source'} · ${c.fps} FPS · ${c.bitrateMbps} Mb/s</span><button type="button" data-tab="settings">Configurer ${icon('caret-right')}</button><p id="replay-pipeline"></p></div><p class="replay-hint">Le replay reste actif quand vous fermez ce panneau. REC utilise le même flux vidéo.</p>`;
    }
    function settings() {
        const { draft: c, inputs, outputs } = replay.state;
        return `<p class="replay-hint">${activeCapture(replay.state.snapshot) ? 'Arrêtez la capture pour modifier ces réglages.' : 'Choisissez un profil, puis ajustez chaque réglage.'}</p><div class="replay-presets" aria-label="Profils de capture">${[['economy', 'Économe', '720p · 30 FPS'], ['balanced', 'Équilibré', '1080p · 60 FPS'], ['quality', 'Qualité', '1440p · 60 FPS']].map(([id, label, detail]) => `<button type="button" data-preset="${id}"><strong>${label}</strong><small>${detail}</small></button>`).join('')}</div><fieldset class="replay-settings"><legend>Vidéo</legend>${select('capture', 'Méthode de capture', [['auto', 'Automatique · DXGI / WGC'], ['desktop', 'Écran · duplication DXGI'], ['wgc', 'Écran ou fenêtre · WGC']])}${select('encoder', 'Encodeur', [['auto', 'GPU automatique · CPU exclu'], ['amd', 'AMD AMF'], ['nvidia', 'NVIDIA NVENC'], ['intel', 'Intel Quick Sync'], ['software', 'CPU · logiciel']])}${select('codec', 'Format vidéo', [['h264', 'H.264 · compatibilité'], ['hevc', 'HEVC · fichier plus compact']])}${select('height', 'Résolution maximale', [[0, 'Taille de la source'], [720, '720p'], [1080, '1080p'], [1440, '1440p'], [2160, '2160p']], 'Proportions conservées, sans agrandissement.')}${select('fps', 'Images par seconde', [15, 24, 30, 60, 90, 120, 144, 165, 240].map(n => [n, `${n} FPS`]), 'Les FPS réellement atteints dépendent de la source et du GPU.')}${number('bitrateMbps', 'Débit vidéo · Mb/s', 2, 150)}${select('preset', 'Priorité de l’encodeur', [['speed', 'Performances'], ['balanced', 'Équilibrée'], ['quality', 'Qualité']])}${check('cursor', 'Inclure le pointeur')}</fieldset><fieldset class="replay-settings"><legend>Replay</legend>${number('seconds', 'Durée à conserver · secondes', 5, 600)}${number('memoryMb', 'Tampon maximal · Mio', 64, 2048, 'Un export peut épingler un second tampon. Les surfaces GPU s’ajoutent à ce budget.')}<p class="replay-hint">Environ ${size(c.bitrateMbps * 1_000_000 / 8 * c.seconds)} de vidéo à ce débit. La limite mémoire peut raccourcir la durée disponible.</p></fieldset><fieldset class="replay-settings"><legend>Audio</legend>${check('systemAudio', 'Enregistrer le son du PC')}${select('outputDevice', 'Sortie à capturer', devices(outputs))}${number('systemVolume', 'Volume du PC · %', 0, 200)}${check('microphone', 'Enregistrer le microphone', 'Le micro est ouvert uniquement pendant une capture activée.')}${select('inputDevice', 'Microphone', devices(inputs))}${number('micVolume', 'Volume du micro · %', 0, 200)}${select('audioKbps', 'Qualité audio', [[96, '96 kb/s'], [128, '128 kb/s'], [192, '192 kb/s'], [256, '256 kb/s'], [320, '320 kb/s']])}${check('separateAudio', 'Pistes PC et micro séparées', 'Certains lecteurs ne jouent qu’une piste à la fois. Désactivez pour entendre les deux en même temps.')}</fieldset><fieldset class="replay-settings"><legend>Sauvegarde</legend><div class="replay-path"><span>${e(c.destination)}</span>${button('pick-folder', 'Choisir', 'folder')}</div><p class="replay-hint">MP4 local. Les originaux et les vidéos existantes ne sont pas remplacés.</p></fieldset><details class="replay-engine"><summary>Moteur vidéo et compatibilité</summary><p class="replay-hint">Service Rust · capture et encodage par FFmpeg. Les jeux sont capturés via leur fenêtre ou leur écran. Plein écran exclusif et contenus protégés dépendent de Windows et du pilote.</p><div class="replay-path"><span>${e(c.enginePath || replay.state.snapshot?.enginePath || 'FFmpeg introuvable')}</span>${button('pick-engine', 'Choisir FFmpeg', 'gear')}</div><p class="replay-hint">Le mode réellement utilisé apparaît dans Capture. Aucun repli CPU automatique.</p></details><div class="replay-settings-save">${button('save-settings', 'Enregistrer les réglages', 'check', 'class="pill-btn is-accent"')}<span id="replay-dirty"></span></div>`;
    }
    function clips() {
        const list = replay.state.snapshot?.clips || [];
        return `${list.length ? `<ul class="replay-clips">${list.map(clip => `<li data-clip="${e(clip.id)}"><span class="replay-clip-icon">${icon(clip.kind === 'replay' ? 'arrow-counter-clockwise' : 'video-camera')}</span><div><strong title="${e(clip.name)}">${e(clip.name)}</strong><small>${clip.kind === 'replay' ? 'Replay' : 'REC'} · ${duration(clip.seconds)} · ${size(clip.bytes)} · ${e(new Date(clip.createdAt * 1000).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}</small></div>${button('play', 'Lire', 'play')}${button('reveal', 'Afficher', 'folder-open')}</li>`).join('')}</ul>` : `<div class="replay-empty">${icon('film-strip')}<h3>Vos clips apparaîtront ici</h3><p>Activez le replay, puis sauvegardez les dernières secondes. Vous pouvez aussi lancer un enregistrement.</p>${button('capture-tab', 'Ouvrir la capture', 'arrow-counter-clockwise')}</div>`}${replay.state.snapshot?.recoveryFiles ? `<div class="replay-recovery"><strong>Fragments à récupérer</strong><p>Une capture interrompue a laissé des fichiers dans le dossier de récupération.</p>${button('recovery', 'Ouvrir les fragments', 'folder-open')}</div>` : ''}`;
    }
    function telemetry() {
        const { snapshot: s, busy, error, dirty, tab } = replay.state;
        if (!s) return;
        const active = activeCapture(s), locked = active || busy;
        root.querySelectorAll('[data-setting], [data-preset], [data-action="pick-engine"], [data-action="pick-folder"]').forEach(el => { el.disabled = locked; });
        const saved = $('[data-action="save-settings"]'); if (saved) saved.disabled = locked || !dirty;
        if ($('#replay-dirty')) $('#replay-dirty').textContent = dirty ? 'Modifications non enregistrées' : 'Réglages enregistrés';
        const problem = error || s.error;
        const feedback = problem ? `<div class="replay-error" role="alert"><span>${e(problem)}</span>${button('dismiss', 'Fermer le message', 'x')}</div>` : s.notice && s.notice !== dismissed ? `<p class="replay-notice">${e(s.notice)}</p>` : '';
        if ($('#replay-feedback').innerHTML !== feedback) $('#replay-feedback').innerHTML = feedback;
        if (tab !== 'capture') return;
        const preparing = s.phase === 'starting' || s.phase === 'stopping';
        $('.replay-session').dataset.phase = s.phase;
        $('.replay-session').classList.toggle('is-recording', s.recording);
        $('#replay-phase').textContent = labels[s.phase] || s.phase;
        $('#replay-rec-time').textContent = s.recording ? `REC ${duration(s.recordingSeconds)}` : '';
        $('#replay-buffer-description').textContent = s.phase === 'buffering' ? `${duration(s.bufferedSeconds)} disponibles à sauvegarder` : s.phase === 'starting' ? 'Vérification de la source, du GPU et des appareils audio.' : s.phase === 'stopping' ? 'Fermeture du flux et sauvegarde des enregistrements.' : 'Choisissez votre source et activez le tampon de replay.';
        $('#replay-buffer-progress').value = Math.min(s.bufferedSeconds, replay.state.draft.seconds);
        $('#replay-memory').textContent = `${size(s.bufferBytes)} / ${replay.state.draft.memoryMb} Mio`;
        const primary = $('[data-action="primary"]');
        primary.innerHTML = icon(s.exporting ? 'circle-notch' : active ? 'floppy-disk' : 'arrow-counter-clockwise') + `<span>${s.exporting ? 'Sauvegarde en cours…' : active ? `Sauvegarder ${duration(s.bufferedSeconds)}` : 'Activer le replay'}</span>`;
        primary.classList.add('is-accent'); primary.disabled = busy || preparing || s.exporting || (active && s.bufferedSeconds < 0.25) || !s.engineAvailable;
        const rec = $('[data-action="record"]'); rec.innerHTML = icon(s.recording ? 'stop' : 'record') + `<span>${s.recording ? 'Terminer REC' : 'Enregistrer'}</span>`; rec.classList.toggle('is-recording', s.recording); rec.disabled = busy || preparing || !s.engineAvailable;
        const stop = $('[data-action="stop"]'); stop.hidden = !active; stop.disabled = busy || s.phase === 'stopping';
        $('[data-action="refresh"]').disabled = busy || active;
        const shortcut = readHotkeys().saveReplay;
        $('#replay-hotkey').textContent = shortcut?.enabled !== false && shortcut?.accelerator ? `${shortcut.accelerator} · sauvegarder sans quitter votre application` : 'Raccourcis configurables dans Réglages → Raccourcis.';
        $('#replay-pipeline').textContent = active && s.encoder ? `${s.width} × ${s.height} · ${s.encoder} · ${s.pipeline}` : !s.engineAvailable ? 'Moteur vidéo manquant : ouvrez Réglages → Moteur vidéo.' : 'MP4 · encodage GPU préféré · aucun réencodage à l’export';
    }
    function render(force = false) {
        if (destroyed || rendering) return;
        rendering = true;
        const { tab, draft, snapshot } = replay.state;
        const next = `${tab}:${tab === 'clips' ? JSON.stringify(snapshot?.clips) + snapshot?.recoveryFiles : ''}`;
        if (force || signature !== next || (!draft && !$('#replay-content').textContent)) {
            signature = next;
            const scroll = $('#list').scrollTop;
            $('#replay-content').innerHTML = draft ? (tab === 'capture' ? capture() : tab === 'settings' ? settings() : clips()) : '<p class="replay-hint">Chargement du module…</p>';
            $('#replay-content').setAttribute('aria-labelledby', `replay-tab-${tab}`);
            root.querySelectorAll('[role="tab"]').forEach(el => { const selected = el.dataset.tab === tab; el.setAttribute('aria-selected', selected); el.tabIndex = selected ? 0 : -1; el.classList.toggle('is-active', selected); });
            $('#list').scrollTop = scroll; onRender();
        }
        telemetry(); rendering = false; panel.fit();
    }
    const unsubscribe = replay.subscribe(() => { if (!signature || !$('#replay-content [data-setting]') && replay.state.tab === 'capture') render(true); else render(); });
    on(root, 'change', event => {
        const input = event.target.closest('[data-setting]'); if (!input) return;
        if (input.type === 'number' && !input.checkValidity()) { input.reportValidity(); return; }
        const value = input.type === 'checkbox' ? input.checked : input.type === 'number' || ['height', 'fps', 'audioKbps'].includes(input.dataset.setting) ? Number(input.value) : input.value;
        replay.update(input.dataset.setting, value);
    });
    on(root, 'click', async event => {
        event.stopPropagation();
        const tab = event.target.closest('[data-tab]');
        if (tab) { replay.state.tab = tab.dataset.tab; render(true); $('#list').scrollTop = 0; return; }
        const preset = event.target.closest('[data-preset]'); if (preset) { replay.preset(preset.dataset.preset); render(true); return; }
        const target = event.target.closest('[data-action]'); if (!target || target.disabled) return;
        const action = target.dataset.action;
        if (action === 'close') return onClose();
        if (action === 'back') return onBack();
        if (action === 'dismiss') { dismissed = replay.state.snapshot?.notice || ''; await replay.action('dismiss'); return; }
        if (action === 'capture-tab') { replay.state.tab = 'capture'; render(true); return; }
        if (action === 'primary') await replay.action(activeCapture(replay.state.snapshot) ? 'save' : 'start');
        else if (action === 'record') await replay.action(replay.state.snapshot?.recording ? 'record-stop' : 'record');
        else if (action === 'stop') await replay.action('stop');
        else if (action === 'refresh') { await replay.loadSources(); render(true); }
        else if (action === 'save-settings') await replay.save();
        else if (action === 'pick-folder' || action === 'pick-engine') { await replay.pick(action === 'pick-folder' ? 'folder' : 'engine'); render(true); }
        else if (action === 'folder') await replay.reveal();
        else if (action === 'recovery') await replay.reveal(null, true);
        else if (action === 'reveal') await replay.reveal(target.closest('[data-clip]').dataset.clip);
        else if (action === 'play') await replay.play(target.closest('[data-clip]').dataset.clip);
    });
    on(root, 'keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
        if (event.target.matches('[role="tab"]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const tabs = [...root.querySelectorAll('[role="tab"]')], index = tabs.indexOf(event.target);
            tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length].click();
            root.querySelector('[role="tab"][aria-selected="true"]').focus();
        }
    });
    ready.then(async () => { if (destroyed) return; await initReplay(); if (destroyed) return; render(true); panel.startIntro(); panel.focus(); await replay.loadSources(); if (!destroyed) render(true); });
    render();
    return { get busy() { return replay.state.busy; }, notify: text => panel.toast(text), destroy() { destroyed = true; unsubscribe(); panel.destroy(); } };
}
