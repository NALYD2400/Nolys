import { replay, initReplay } from './store.js';
import { activeCapture, duration, size, queryClips } from './model.js';
import { escapeHtml as e } from '../island/dynamic-island/helpers/format.js';
import { createPanel } from '../library/panel.js';
import { readHotkeys } from '../shared/hotkeys.js';
import { native } from '../shared/ipc.js';
import styles from './styles.css?inline';
import { createThumbnails } from './thumbnails.js';
import { createReplaySelects } from './selects.js';

let sheet;
const icon = name => `<i class="ph-bold ph-${name}" aria-hidden="true"></i>`;
const button = (action, label, glyph, extra = '') => `<button type="button" class="pill-btn${extra === 'primary' ? ' is-accent' : ''}" data-action="${action}"${action === 'dismiss' ? ' aria-label="Fermer le message"' : ''}>${icon(glyph)}<span>${label}</span></button>`;
const iconButton = (action, label, glyph) => `<button type="button" class="mini-btn${action === 'delete' ? ' is-danger' : ''}" data-action="${action}" aria-label="${label}" title="${label}">${icon(glyph)}</button>`;
const labels = { idle: 'Prêt à capturer', starting: 'Préparation de la capture…', buffering: 'Replay actif', stopping: 'Finalisation en cours…', error: 'Capture interrompue' };

export function mountReplay(host, { onClose, onBack, ready = Promise.resolve(), onRender = () => {}, onPlaybackChange = () => {} }) {
    const panel = createPanel(host, `<div class="lib replay-panel" tabindex="-1" aria-label="Replay et enregistrement Nolys"><header class="lib-header"><button type="button" class="round-btn" data-action="back" title="Menu" aria-label="Revenir au menu">${icon('caret-left')}</button><div class="lib-heading"><span>Replay & REC</span></div><button type="button" class="round-btn" data-action="folder" title="Dossier des vidéos" aria-label="Ouvrir le dossier des vidéos">${icon('folder-open')}</button><button type="button" class="round-btn" data-action="close" title="Fermer" aria-label="Fermer Replay">${icon('x')}</button></header><nav class="lib-chips replay-tabs" role="tablist" aria-label="Replay et enregistrement">${[['capture', 'Capture'], ['settings', 'Réglages'], ['clips', 'Clips']].map(([id, label]) => `<button type="button" class="chip" id="replay-tab-${id}" role="tab" data-tab="${id}" aria-controls="replay-content">${label}</button>`).join('')}</nav><div id="replay-feedback" role="status" aria-live="polite"></div><div class="lib-list replay-body" id="list"><section id="replay-content" role="tabpanel"></section></div><div class="lib-toast" id="toast" role="status" hidden></div><div class="lib-menu" id="menu" role="menu" hidden></div></div>`);
    if (!sheet) { sheet = new CSSStyleSheet(); sheet.replaceSync(styles); }
    panel.root.adoptedStyleSheets = [...panel.root.adoptedStyleSheets, sheet];
    const { root, $, on } = panel;
    const thumbnails = createThumbnails(root, on);
    const selects = createReplaySelects(root, on);
    let destroyed = false, signature = '', rendering = false, shownTab = null;
    let selectedClip = null, mediaSource = '', loadingClip = null, playbackRequest = 0, clipListScroll = 0;
    let renameId = null, renameDraft = '';
    const query = { search: '', kind: '', sort: 'newest', page: 0 };
    const selection = new Set();
    let pendingDelete = [], recoveryFiles = [], cacheUsage = null;
    let clipsReference = null, clipsGeneration = 0, clipPage = null;
    const pageClips = () => {
        const clips = replay.state.snapshot?.clips;
        const key = JSON.stringify(query);
        if (!clipPage || clipPage.clips !== clips || clipPage.key !== key) {
            clipPage = { clips, key, result: queryClips(clips || [], query) };
        }
        return clipPage.result;
    };
    const text = (selector, value) => {
        const element = $(selector);
        if (element && element.textContent !== value) element.textContent = value;
    };
    async function maintenance() {
        const [files, usage] = await Promise.all([replay.inspect('replay_recovery_list'), replay.inspect('replay_cache', { clear: false })]);
        if (destroyed) return;
        recoveryFiles = files || []; cacheUsage = usage; render(true);
    }
    const focusRename = id => root.querySelector(`[data-clip="${CSS.escape(id)}"] [data-action="rename"]`)?.focus({ preventScroll: true });
    function cancelRename() {
        const id = renameId; renameId = null; renameDraft = ''; render(true); if (id) focusRename(id);
    }
    const stopVideo = () => { const video = $('#replay-video'); if (video) { video.pause(); video.removeAttribute('src'); video.load(); } };
    function returnToClips() {
        const id = selectedClip?.id;
        ++playbackRequest; loadingClip = null; selectedClip = null;
        stopVideo(); onPlaybackChange(false); replay.state.tab = 'clips'; render(true);
        $('#list').scrollTop = clipListScroll;
        const target = id && root.querySelector(`[data-clip="${CSS.escape(id)}"] [data-action="play"]`);
        (target || $('#replay-tab-clips')).focus({ preventScroll: true });
    }
    async function openClip(id) {
        const clip = replay.state.snapshot?.clips.find(clip => clip.id === id);
        if (!clip) return;
        const request = ++playbackRequest;
        clipListScroll = $('#list').scrollTop;
        loadingClip = id; render(true);
        const path = await replay.play(id);
        if (destroyed || request !== playbackRequest) return;
        loadingClip = null;
        if (!path) { render(true); return; }
        selectedClip = clip; mediaSource = native.fileSrc(path);
        onPlaybackChange(true); render(true);
        $('#replay-video')?.focus({ preventScroll: true });
        $('#replay-video')?.play().catch(() => { /* Native controls allow manual playback if autoplay is blocked. */ });
    }
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
        return `<div class="replay-source">${select('sourceId', 'Source à capturer', sourceOptions)}<button type="button" class="round-btn" data-action="refresh" aria-label="Actualiser les écrans, fenêtres et appareils" title="Actualiser">${icon('arrows-clockwise')}</button></div>
            <div class="replay-session">
                <div class="replay-session-top"><span class="replay-signal" aria-hidden="true"></span><strong id="replay-phase"></strong><span id="replay-rec-time"></span></div>
                <div class="replay-timing"><strong id="replay-buffer-time">00:00</strong><p id="replay-buffer-description"></p></div>
            </div>
            <div class="replay-actions">${button('primary', 'Activer le replay', 'arrow-counter-clockwise', 'primary')}${button('record', 'Enregistrer', 'record')}<button type="button" class="round-btn" data-action="stop" aria-label="Arrêter la capture" title="Arrêter la capture">${icon('stop')}</button></div>`;
    }
    function settings() {
        const { draft: c, inputs, outputs } = replay.state;
        return `<p class="replay-hint">${activeCapture(replay.state.snapshot) ? 'Arrêtez la capture pour modifier ces réglages.' : 'Choisissez un profil, puis ajustez chaque réglage.'}</p><div class="replay-presets" aria-label="Profils de capture">${[['economy', 'Économe', '720p · 30 FPS'], ['balanced', 'Équilibré', '1080p · 60 FPS'], ['quality', 'Qualité', '1440p · 60 FPS']].map(([id, label, detail]) => `<button type="button" data-preset="${id}"><strong>${label}</strong><small>${detail}</small></button>`).join('')}</div><fieldset class="replay-settings"><legend>Vidéo</legend>${select('capture', 'Méthode de capture', [['auto', 'Automatique · DXGI / WGC'], ['desktop', 'Écran · duplication DXGI'], ['wgc', 'Écran ou fenêtre · WGC']])}${select('encoder', 'Encodeur', [['auto', 'GPU automatique · CPU exclu'], ['amd', 'AMD AMF'], ['nvidia', 'NVIDIA NVENC'], ['intel', 'Intel Quick Sync'], ['software', 'CPU · logiciel']])}${select('codec', 'Format vidéo', [['h264', 'H.264 · compatibilité'], ['hevc', 'HEVC · fichier plus compact']])}${select('height', 'Résolution maximale', [[0, 'Taille de la source'], [720, '720p'], [1080, '1080p'], [1440, '1440p'], [2160, '2160p']], 'Proportions conservées, sans agrandissement.')}${select('fps', 'Images par seconde', [15, 24, 30, 60, 90, 120, 144, 165, 240].map(n => [n, `${n} FPS`]), 'Les FPS réellement atteints dépendent de la source et du GPU.')}${number('bitrateMbps', 'Débit vidéo · Mb/s', 2, 150)}${select('preset', 'Priorité de l’encodeur', [['speed', 'Performances'], ['balanced', 'Équilibrée'], ['quality', 'Qualité']])}${check('cursor', 'Inclure le pointeur')}</fieldset><fieldset class="replay-settings"><legend>Replay</legend>${number('seconds', 'Durée à conserver · secondes', 5, 600)}${number('memoryMb', 'Tampon maximal · Mio', 64, 2048, 'Un export peut épingler un second tampon. Les surfaces GPU s’ajoutent à ce budget.')}<p class="replay-hint">Environ ${size(c.bitrateMbps * 1_000_000 / 8 * c.seconds)} de vidéo à ce débit. La limite mémoire peut raccourcir la durée disponible.</p></fieldset><fieldset class="replay-settings"><legend>Audio</legend>${check('systemAudio', 'Enregistrer le son du PC')}${select('outputDevice', 'Sortie à capturer', devices(outputs))}${number('systemVolume', 'Volume du PC · %', 0, 200)}${check('microphone', 'Enregistrer le microphone', 'Le micro est ouvert uniquement pendant une capture activée.')}${select('inputDevice', 'Microphone', devices(inputs))}${number('micVolume', 'Volume du micro · %', 0, 200)}${select('audioKbps', 'Qualité audio', [[96, '96 kb/s'], [128, '128 kb/s'], [192, '192 kb/s'], [256, '256 kb/s'], [320, '320 kb/s']])}${check('separateAudio', 'Pistes PC et micro séparées', 'Certains lecteurs ne jouent qu’une piste à la fois. Désactivez pour entendre les deux en même temps.')}</fieldset><fieldset class="replay-settings"><legend>Sauvegarde</legend><div class="replay-path"><span>${e(c.destination)}</span>${button('pick-folder', 'Choisir', 'folder')}</div><p class="replay-hint">MP4 local. Les originaux et les vidéos existantes ne sont pas remplacés.</p></fieldset><fieldset class="replay-settings"><legend>Stockage et récupération</legend><p class="replay-hint">Consultez le cache des aperçus et recherchez les fragments à récupérer dans l’onglet Clips.</p>${button('maintenance', 'Actualiser le stockage', 'arrows-clockwise')}${cacheUsage ? `<p class="replay-hint">Cache des aperçus : ${size(cacheUsage.bytes)} / ${size(cacheUsage.limitBytes)} · ${cacheUsage.files} image(s).</p>` : ''}</fieldset><details class="replay-engine"><summary>Moteur vidéo et compatibilité</summary><p class="replay-hint">Service Rust · capture et encodage par FFmpeg. Les jeux sont capturés via leur fenêtre ou leur écran. Plein écran exclusif et contenus protégés dépendent de Windows et du pilote.</p><div class="replay-path"><span>${e(c.enginePath || replay.state.snapshot?.enginePath || 'FFmpeg introuvable')}</span>${button('pick-engine', 'Choisir FFmpeg', 'gear')}</div><dl class="replay-diagnostics"><div><dt>Capture en cours</dt><dd id="replay-pipeline"></dd></div><div><dt>Tampon utilisé</dt><dd id="replay-memory"></dd></div></dl><p class="replay-hint">Aucun repli CPU automatique.</p></details><div class="replay-settings-save">${button('save-settings', 'Enregistrer les réglages', 'check', 'class="pill-btn is-accent"')}<span id="replay-dirty"></span></div>`;
    }
    function clips() {
        const present = new Set((replay.state.snapshot?.clips || []).map(c => c.id));
        for (const id of selection) if (!present.has(id)) selection.delete(id);
        const page = pageClips(), list = page.clips; query.page = page.page;
        const controls = `<div class="replay-toolbar"><input type="search" id="replay-search" aria-label="Rechercher un clip" placeholder="Rechercher un clip" value="${e(query.search)}"><select data-query="kind" aria-label="Type de clip">${[['', 'Tous les types'], ['replay', 'Replay'], ['recording', 'REC'], ['imported', 'Importés']].map(([v, label]) => `<option value="${v}" ${query.kind === v ? 'selected' : ''}>${label}</option>`).join('')}</select><select data-query="sort" aria-label="Trier les clips">${[['newest', 'Plus récents'], ['oldest', 'Plus anciens'], ['name', 'Nom'], ['size', 'Taille']].map(([v, label]) => `<option value="${v}" ${query.sort === v ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div class="replay-toolbar replay-selection-toolbar" role="group" aria-label="Gestion des clips">${iconButton('reindex', 'Réindexer le dossier', 'arrows-clockwise')}${button('select-page', 'Sélectionner la page', 'checks')}${selection.size ? button('delete-selected', `Corbeille · ${selection.size}`, 'trash') + iconButton('clear-selection', 'Désélectionner', 'x') : ''}<span class="replay-clip-count">${page.total} clip${page.total === 1 ? '' : 's'}</span></div>${pendingDelete.length ? `<div class="replay-confirm" role="group" aria-label="Confirmer la suppression"><p>Placer ${pendingDelete.length} clip(s) dans la Corbeille Windows ?</p>${button('confirm-delete', 'Confirmer la mise à la corbeille', 'trash')}${button('cancel-delete', 'Annuler', 'x')}</div>` : ''}`;
        return controls + `${list.length ? `<ul class="replay-clips">${list.map(clip => {
            const editing = renameId === clip.id;
            const title = editing ? `<form class="replay-rename"><input id="replay-rename-name" aria-label="Nouveau nom du clip" value="${e(renameDraft)}" maxlength="120" required autocomplete="off" spellcheck="false"><span>.mp4</span><button type="submit" class="round-btn is-accent" aria-label="Valider le nouveau nom" title="Valider">${icon('check')}</button><button type="button" class="round-btn" data-action="cancel-rename" aria-label="Annuler le renommage" title="Annuler">${icon('x')}</button></form>` : `<div class="replay-clip-title"><strong title="${e(clip.name)}">${e(clip.name)}</strong><button type="button" class="mini-btn" data-action="rename" title="Renommer le clip" aria-label="Renommer le clip">${icon('pencil-simple')}</button></div>`;
            return `<li data-clip="${e(clip.id)}"><button type="button" class="replay-thumbnail" data-action="play" aria-label="Lire ${e(clip.name)}" title="Lire ${e(clip.name)}">${icon('play')}<img data-thumbnail="${e(JSON.stringify([clip.id, clip.path, clip.name, clip.bytes, clip.createdAt]))}" alt="" width="320" height="180" decoding="async"></button><div class="replay-clip-details">${title}<small>${clip.kind === 'replay' ? 'Replay' : clip.kind === 'imported' ? 'Importé' : 'REC'} · ${clip.seconds ? duration(clip.seconds) : 'Durée à la lecture'} · ${size(clip.bytes)} · ${e(new Date(clip.createdAt * 1000).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }))}</small>${editing ? '' : `<div class="replay-clip-actions"><label class="replay-clip-select" title="Sélectionner ${e(clip.name)}"><input type="checkbox" data-select="${e(clip.id)}" aria-label="Sélectionner ${e(clip.name)}" ${selection.has(clip.id) ? 'checked' : ''}></label>${button('play', loadingClip === clip.id ? 'Chargement…' : 'Lire', 'play')}${iconButton('reveal', 'Afficher', 'folder-open')}${iconButton('relocate', 'Retrouver', 'magnifying-glass')}${iconButton('delete', 'Supprimer', 'trash')}</div>`}</div></li>`;
        }).join('')}</ul>` : `<div class="replay-empty">${icon('film-strip')}<h3>${query.search || query.kind ? 'Aucun clip correspondant' : 'Vos clips apparaîtront ici'}</h3><p>Activez le replay, puis sauvegardez les dernières secondes. Vous pouvez aussi lancer un enregistrement.</p>${button('capture-tab', 'Ouvrir la capture', 'arrow-counter-clockwise')}</div>`}${page.pages > 1 ? `<nav class="replay-pagination" aria-label="Pages des clips">${iconButton('previous-page', 'Page précédente', 'caret-left')}<span role="status" aria-live="polite" aria-atomic="true" aria-label="Page ${page.page + 1} sur ${page.pages}">${page.page + 1} / ${page.pages}</span>${iconButton('next-page', 'Page suivante', 'caret-right')}</nav>` : ''}${recoveryFiles.length || replay.state.snapshot?.recoveryFiles ? `<div class="replay-recovery"><strong>Fragments à récupérer</strong><p>Récupérez une copie lisible des images complètes. Les fragments d’origine sont conservés, y compris après réussite.</p>${button('recovery', 'Ouvrir les fragments', 'folder-open')}${recoveryFiles.map(file => `<div class="replay-recovery-file"><span>${e(file.id)} · ${size(file.bytes)}</span><button type="button" class="pill-btn" data-action="recover" data-recovery="${e(file.id)}">Récupérer une copie</button></div>`).join('')}</div>` : ''}`;
    }
    function telemetry() {
        const { snapshot: s, busy, error, dirty, tab } = replay.state;
        if (!s) return;
        const active = activeCapture(s), locked = active || busy;
        for (const action of ['reindex', 'relocate', 'recover', 'confirm-delete']) root.querySelectorAll(`[data-action="${action}"]`).forEach(el => { el.disabled = busy || (action === 'recover' && active); });
        if ($('[data-action="previous-page"]')) $('[data-action="previous-page"]').disabled = query.page === 0;
        if ($('[data-action="next-page"]')) $('[data-action="next-page"]').disabled = query.page >= pageClips().pages - 1;
        root.querySelectorAll('[data-setting], [data-preset], [data-action="pick-engine"], [data-action="pick-folder"]').forEach(el => { el.disabled = locked; });
        const saved = $('[data-action="save-settings"]'); if (saved) saved.disabled = locked || !dirty;
        text('#replay-dirty', dirty ? 'Modifications non enregistrées' : 'Réglages enregistrés');
        const problem = error || s.error;
        const feedback = problem ? `<div class="replay-error" role="alert"><span>${e(problem)}</span>${button('dismiss', 'Fermer le message', 'x')}</div>` : '';
        if ($('#replay-feedback').innerHTML !== feedback) $('#replay-feedback').innerHTML = feedback;
        root.querySelectorAll('.replay-clips [data-action]:not([data-action="cancel-rename"])').forEach(el => { el.disabled = busy || Boolean(loadingClip) || Boolean(renameId); });
        root.querySelectorAll('.replay-rename input, .replay-rename button').forEach(el => { el.disabled = busy; });
        text('#replay-memory', `${size(s.bufferBytes)} / ${replay.state.draft.memoryMb} Mio`);
        text('#replay-pipeline', active && s.encoder ? `${s.width} × ${s.height} · ${s.encoder} · ${s.pipeline}` : !s.engineAvailable ? 'Moteur vidéo introuvable' : 'Aucune capture en cours');
        if (tab !== 'capture' || selectedClip) return;
        const preparing = s.phase === 'starting' || s.phase === 'stopping';
        $('.replay-session').dataset.phase = s.phase;
        $('.replay-session').classList.toggle('is-recording', s.recording);
        text('#replay-phase', labels[s.phase] || s.phase);
        text('#replay-rec-time', s.recording ? `REC ${duration(s.recordingSeconds)}` : '');
        text('#replay-buffer-time', duration(s.bufferedSeconds));
        text('#replay-buffer-description', !s.engineAvailable ? 'Moteur vidéo manquant · ouvrez Réglages' : s.phase === 'starting' ? 'Préparation de la source et des appareils' : s.phase === 'stopping' ? 'Finalisation des vidéos' : `Disponibles sur ${duration(replay.state.draft.seconds)}`);
        const primary = $('[data-action="primary"]');
        const primaryLabel = icon(s.exporting ? 'circle-notch' : active ? 'floppy-disk' : 'arrow-counter-clockwise') + `<span>${s.exporting ? 'Sauvegarde…' : active ? 'Sauvegarder' : 'Activer le replay'}</span>`;
        if (primary.innerHTML !== primaryLabel) primary.innerHTML = primaryLabel;
        primary.classList.add('is-accent'); primary.disabled = busy || preparing || s.exporting || (active && s.bufferedSeconds < 0.25) || !s.engineAvailable;
        const rec = $('[data-action="record"]');
        const recordLabel = icon(s.recording ? 'stop' : 'record') + `<span>${s.recording ? 'Terminer REC' : 'Enregistrer'}</span>`;
        if (rec.innerHTML !== recordLabel) rec.innerHTML = recordLabel;
        rec.classList.toggle('is-recording', s.recording); rec.disabled = busy || preparing || !s.engineAvailable;
        const stop = $('[data-action="stop"]'); stop.hidden = !active; stop.disabled = busy || s.phase === 'stopping';
        $('[data-action="refresh"]').disabled = busy || active;
        const shortcut = readHotkeys().saveReplay;
        primary.title = active && shortcut?.enabled !== false && shortcut?.accelerator ? `Sauvegarder le replay · ${shortcut.accelerator}` : active ? 'Sauvegarder les dernières secondes' : 'Activer le tampon de replay';
    }
    function render(force = false) {
        if (destroyed || rendering) return;
        rendering = true;
        const { tab, draft, snapshot } = replay.state;
        if (snapshot?.clips !== clipsReference) { clipsReference = snapshot?.clips; ++clipsGeneration; }
        const next = `${tab}:${selectedClip?.id || loadingClip || ''}:${tab === 'clips' ? `${clipsGeneration}:${snapshot?.recoveryFiles}` : ''}`;
        const preserveVideo = selectedClip && $('#replay-video')?.dataset.clip === selectedClip.id;
        const preserveEditor = renameId && $('#replay-rename-name');
        $('.replay-panel').classList.toggle('is-playing', Boolean(selectedClip));
        $('.replay-panel').classList.toggle('is-clips', tab === 'clips' && !selectedClip);
        $('.replay-tabs').hidden = Boolean(selectedClip);
        text('.lib-heading > span', selectedClip?.name || 'Replay & REC');
        $('.lib-heading').title = selectedClip?.name || '';
        $('[data-action="back"]').setAttribute('aria-label', selectedClip ? 'Revenir aux clips' : 'Revenir au menu');
        $('[data-action="back"]').title = selectedClip ? 'Revenir aux clips' : 'Menu';
        if (!preserveVideo && !preserveEditor && (force || signature !== next || (!draft && !$('#replay-content').textContent))) {
            signature = next;
            const scroll = $('#list').scrollTop;
            $('#replay-content').innerHTML = selectedClip ? `<div class="replay-player"><video id="replay-video" data-clip="${e(selectedClip.id)}" src="${e(mediaSource)}" controls playsinline preload="metadata" aria-label="Lecture de ${e(selectedClip.name)}"></video><div class="replay-player-error" id="replay-player-error" hidden role="alert"><p>Ce clip ne peut pas être lu ici. Le format peut nécessiter un codec Windows.</p>${button('external', 'Ouvrir dans un autre lecteur', 'arrow-square-out')}</div></div>` : draft ? (tab === 'capture' ? capture() : tab === 'settings' ? settings() : clips()) : '<p class="replay-hint">Chargement du module…</p>';
            $('#replay-content').setAttribute('aria-labelledby', `replay-tab-${tab}`);
            if (shownTab && shownTab !== tab) panel.tabIn($('#replay-content'));
            shownTab = tab;
            root.querySelectorAll('[role="tab"]').forEach(el => { const selected = el.dataset.tab === tab; el.setAttribute('aria-selected', selected); el.tabIndex = selected ? 0 : -1; el.classList.toggle('is-active', selected); });
            $('#list').scrollTop = scroll; thumbnails.refresh(); onRender();
        }
        selects.refresh(); telemetry(); selects.sync(); rendering = false;
    }
    const unsubscribe = replay.subscribe(() => { if (!signature || !$('#replay-content [data-setting]') && replay.state.tab === 'capture') render(true); else render(); });
    on(root, 'input', event => {
        if (event.target.id === 'replay-rename-name') renameDraft = event.target.value;
        if (event.target.id === 'replay-search') {
            const position = event.target.selectionStart; query.search = event.target.value; query.page = 0; render(true);
            $('#replay-search')?.focus({ preventScroll: true }); try { $('#replay-search')?.setSelectionRange(position, position); } catch { /* Search inputs may not expose a selection API. */ }
        }
    });
    on(root, 'submit', async event => {
        if (!event.target.matches('.replay-rename')) return;
        event.preventDefault(); event.stopPropagation();
        if (!renameId || replay.state.busy) return;
        const id = renameId;
        const renamed = await replay.renameClip(id, renameDraft);
        if (destroyed) return;
        if (renamed) { renameId = null; renameDraft = ''; render(true); focusRename(id); }
        else { $('#replay-rename-name')?.focus({ preventScroll: true }); }
    });
    on(root, 'change', event => {
        if (event.target.matches('[data-select]')) { event.target.checked ? selection.add(event.target.dataset.select) : selection.delete(event.target.dataset.select); pendingDelete = []; render(true); return; }
        if (event.target.matches('[data-query]')) { query[event.target.dataset.query] = event.target.value; query.page = 0; render(true); return; }
        const input = event.target.closest('[data-setting]'); if (!input) return;
        if (input.type === 'number' && !input.checkValidity()) { input.reportValidity(); return; }
        const value = input.type === 'checkbox' ? input.checked : input.type === 'number' || ['height', 'fps', 'audioKbps'].includes(input.dataset.setting) ? Number(input.value) : input.value;
        replay.update(input.dataset.setting, value);
    });
    on(root, 'click', async event => {
        event.stopPropagation();
        const tab = event.target.closest('[data-tab]');
        if (tab) { if (replay.state.busy) return; renameId = null; ++playbackRequest; loadingClip = null; replay.state.tab = tab.dataset.tab; render(true); $('#list').scrollTop = 0; if (['clips', 'settings'].includes(tab.dataset.tab)) await maintenance(); return; }
        const preset = event.target.closest('[data-preset]'); if (preset) { replay.preset(preset.dataset.preset); render(true); return; }
        const target = event.target.closest('[data-action]'); if (!target || target.disabled) return;
        const action = target.dataset.action;
        if (action === 'close') return onClose();
        if (action === 'back') return selectedClip ? returnToClips() : onBack();
        if (action === 'cancel-rename') return cancelRename();
        if (action === 'rename') {
            const clip = replay.state.snapshot?.clips.find(clip => clip.id === target.closest('[data-clip]').dataset.clip);
            if (!clip) return;
            renameId = clip.id; renameDraft = clip.name.replace(/\.mp4$/i, ''); render(true);
            $('#replay-rename-name')?.focus({ preventScroll: true }); $('#replay-rename-name')?.select(); return;
        }
        if (action === 'dismiss') { await replay.action('dismiss'); return; }
        if (action === 'capture-tab') { replay.state.tab = 'capture'; render(true); return; }
        if (action === 'previous-page' || action === 'next-page') { query.page += action === 'previous-page' ? -1 : 1; render(true); $('#list').scrollTop = 0;
            const current = $(`[data-action="${action}"]`);
            (current && !current.disabled ? current : $('.replay-pagination button:not(:disabled)') || $('#replay-tab-clips')).focus({ preventScroll: true }); return; }
        if (action === 'select-page') { for (const clip of pageClips().clips) selection.add(clip.id); render(true); return; }
        if (action === 'clear-selection') { selection.clear(); pendingDelete = []; render(true); return; }
        if (action === 'delete-selected' || action === 'delete') {
            pendingDelete = action === 'delete' ? [target.closest('[data-clip]').dataset.clip] : [...selection];
            render(true); $('[data-action="cancel-delete"]')?.focus(); return;
        }
        if (action === 'cancel-delete') { pendingDelete = []; render(true); return; }
        if (action === 'confirm-delete') {
            const ids = pendingDelete; pendingDelete = [];
            await replay.deleteClips(ids);
            const remaining = new Set(replay.state.snapshot?.clips.map(c => c.id));
            for (const id of selection) if (!remaining.has(id)) selection.delete(id);
            if (!destroyed) { render(true); (root.querySelector('[data-action="play"]') || $('#replay-tab-clips'))?.focus({ preventScroll: true }); } return;
        }
        if (action === 'maintenance') { await maintenance(); return; }
        if (action === 'reindex') { await replay.mutate('replay_reindex'); if (!destroyed) { render(true); panel.toast(replay.state.snapshot?.notice || 'Réindexation terminée'); } return; }
        if (action === 'relocate') { await replay.mutate('replay_relocate', { id: target.closest('[data-clip]').dataset.clip }); return; }
        if (action === 'recover') { await replay.mutate('replay_recover', { id: target.dataset.recovery }); if (!destroyed) { panel.toast(replay.state.snapshot?.notice || 'Récupération terminée'); await maintenance(); } return; }
        if (action === 'primary') await replay.action(activeCapture(replay.state.snapshot) ? 'save' : 'start');
        else if (action === 'record') await replay.action(replay.state.snapshot?.recording ? 'record-stop' : 'record');
        else if (action === 'stop') await replay.action('stop');
        else if (action === 'refresh') { await replay.loadSources(); render(true); }
        else if (action === 'save-settings') await replay.save();
        else if (action === 'pick-folder' || action === 'pick-engine') { await replay.pick(action === 'pick-folder' ? 'folder' : 'engine'); render(true); }
        else if (action === 'folder') await replay.reveal();
        else if (action === 'recovery') await replay.reveal(null, true);
        else if (action === 'reveal') await replay.reveal(target.closest('[data-clip]').dataset.clip);
        else if (action === 'play') await openClip(target.closest('[data-clip]').dataset.clip);
        else if (action === 'external' && selectedClip) await replay.openExternal(selectedClip.id);
    });
    on(root, 'keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (pendingDelete.length) { pendingDelete = []; render(true); } else if (renameId) { if (!replay.state.busy) cancelRename(); } else selectedClip ? returnToClips() : onClose(); }
        if (event.target.matches('[role="tab"]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const tabs = [...root.querySelectorAll('[role="tab"]')], index = tabs.indexOf(event.target);
            tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length].click();
            root.querySelector('[role="tab"][aria-selected="true"]').focus();
        }
    });
    on(root, 'error', event => { if (event.target.id === 'replay-video' && selectedClip) { $('#replay-player-error').hidden = false; onPlaybackChange(true); } }, { capture: true });
    on(window, 'resize', () => { if (selectedClip) onPlaybackChange(true); });
    ready.then(async () => { if (destroyed) return; await initReplay(); if (destroyed) return; render(true); panel.startIntro(); panel.focus(); await replay.loadSources(); if (!destroyed) render(true); });
    render();
    return { get busy() { return replay.state.busy; }, notify: text => panel.toast(text), destroy() { destroyed = true; ++playbackRequest; selectedClip = null; stopVideo(); onPlaybackChange(false); thumbnails.destroy(); selects.destroy(); unsubscribe(); panel.destroy(); } };
}
