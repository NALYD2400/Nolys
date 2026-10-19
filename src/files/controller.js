import { files, subscribe, notify, pick, start, act, copy, dragOut } from './store.js';
import { escapeHtml as e } from '../island/dynamic-island/helpers/format.js';
import { createPanel } from '../library/panel.js';
import styles from './styles.css?inline';

const active = new Set(['queued', 'running', 'cancelling']);
const labels = { queued: 'En attente', running: 'En cours', cancelling: 'Annulation en cours', done: 'Terminé', partial: 'Résultat partiel', failed: 'Échec', cancelled: 'Annulé', interrupted: 'Interrompu' };
const icons = { image: 'image', pdf: 'file-pdf', audio: 'music-note', video: 'film-strip', folder: 'folder', file: 'file' };
const bytes = value => {
    const unit = value >= 1024 ** 3 ? 3 : value >= 1024 ** 2 ? 2 : 1;
    return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value / 1024 ** unit)} ${['', 'Ko', 'Mo', 'Go'][unit]}`;
};
const button = (action, text, icon, extra = '') => `<button type="button" class="pill-btn" data-action="${action}" ${extra}><i class="ph-bold ph-${icon}" aria-hidden="true"></i><span>${text}</span></button>`;
let fileSheet;

function selection() {
    if (!files.inputs.length) return `<div class="files-empty"><i class="ph ph-tray-arrow-down" aria-hidden="true"></i><h3>Vos fichiers, à portée de geste</h3><p>Déposez-les sur l’Island pour les convertir, les redimensionner ou les retrouver ici.</p>${button('pick', 'Choisir des fichiers', 'plus', files.busy ? 'disabled' : '')}</div>`;
    const total = files.inputs.reduce((sum, input) => sum + input.size, 0);
    return `<div class="files-selection"><div class="files-selection-heading"><strong>${files.inputs.length === 1 ? e(files.inputs[0].name) : `${files.inputs.length} fichiers sélectionnés`}</strong><span>${bytes(total)}</span></div><ul class="files-inputs" aria-label="Fichiers sélectionnés">${files.inputs.slice(0, 5).map(input => `<li><i class="ph ph-${icons[input.kind] || 'file'}" aria-hidden="true"></i><span title="${e(input.name)}">${e(input.name)}</span><small>${input.directory ? 'Dossier' : bytes(input.size)}</small></li>`).join('')}${files.inputs.length > 5 ? `<li class="files-more">Et ${files.inputs.length - 5} autres fichiers</li>` : ''}</ul></div>`;
}

function tools() {
    if (!files.inputs.length) return '';
    const convertible = files.inputs.every(input => !input.directory && ['jpg', 'jpeg', 'png', 'webp', 'bmp'].includes(input.extension));
    if (!convertible) files.tab = 'actions';
    const disabled = files.busy || !convertible ? 'disabled' : '';
    const content = files.tab === 'actions' ? `<div class="files-actions">${button('copy-inputs', 'Copier les fichiers', 'copy', files.busy ? 'disabled' : '')}${button('export', 'Créer une copie dans Exports', 'folder-plus', files.busy || files.inputs.some(i => i.directory) ? 'disabled' : '')}${button('reveal-input', 'Afficher dans l’Explorateur', 'folder-open')}</div>` : `
        ${!convertible ? '<p class="files-explanation">Cette sélection contient des fichiers qui ne sont pas compatibles avec les outils image. Les actions de gestion restent disponibles.</p>' : ''}
        <div class="files-form-row"><label for="files-format">Format de sortie</label><select id="files-format" data-option="format" ${disabled}>${[['png', 'PNG · transparence'], ['jpg', 'JPG · qualité réglable'], ['webp', 'WebP · sans perte'], ['bmp', 'BMP']].map(([value, text]) => `<option value="${value}" ${files.format === value ? 'selected' : ''}>${text}</option>`).join('')}</select></div>
        ${files.format === 'jpg' ? `<div class="files-form-row"><label for="files-quality">Qualité JPG</label><div class="files-quality"><input id="files-quality" data-option="quality" type="range" min="30" max="100" value="${files.quality}" ${disabled}><output for="files-quality">${files.quality} %</output></div></div><div class="files-form-row"><label for="files-background">Si l’image est transparente</label><select id="files-background" data-option="background" ${disabled}><option value="" ${!files.background ? 'selected' : ''}>Me demander avant de retirer la transparence</option><option value="#ffffff" ${files.background === '#ffffff' ? 'selected' : ''}>Fond blanc</option><option value="#000000" ${files.background === '#000000' ? 'selected' : ''}>Fond noir</option></select></div>` : ''}
        ${files.tab === 'tools' ? `<div class="files-form-row"><label for="files-size">Grand côté maximal</label><select id="files-size" data-option="maxEdge" ${disabled}>${[640, 1280, 1920, 2560, 3840].map(size => `<option value="${size}" ${files.maxEdge === size ? 'selected' : ''}>${new Intl.NumberFormat('fr-FR').format(size)} px</option>`).join('')}</select></div><div class="files-actions">${button('resize', 'Redimensionner', 'resize', disabled)}${button('compress', 'Compresser en JPG', 'arrows-in', `${disabled} ${files.format !== 'jpg' ? 'disabled title="Choisissez JPG pour régler la qualité"' : ''}`)}</div><p class="files-explanation">Proportions conservées, sans agrandissement. La compression JPG modifie la qualité ; le gain réel apparaît dans le résultat.</p>` : `${button('convert', `Convertir en ${files.format.toUpperCase()}`, 'arrows-left-right', `data-primary ${disabled}`)}<p class="files-explanation">Nouvelle copie, original conservé. Métadonnées personnelles retirées ; orientation et profil couleur préservés si compatibles.</p>`}`;
    const tabs = convertible ? [['convert', 'Convertir'], ['tools', 'Outils'], ['actions', 'Actions']] : [['actions', 'Actions']];
    return `<div class="lib-chips files-tabs" role="tablist" aria-label="Actions sur les fichiers">${tabs.map(([tab, name]) => `<button type="button" class="chip ${files.tab === tab ? 'is-active' : ''}" role="tab" aria-selected="${files.tab === tab}" tabindex="${files.tab === tab ? 0 : -1}" aria-controls="files-action-panel" data-tab="${tab}" id="files-tab-${tab}">${name}</button>`).join('')}</div><section id="files-action-panel" role="tabpanel" aria-labelledby="files-tab-${files.tab}">${content}${!convertible ? '<p class="files-explanation">Les transformations sont disponibles pour les images JPG, PNG, WebP et BMP. Pour cette sélection, vous pouvez copier les fichiers ou les retrouver dans l’Explorateur.</p>' : ''}</section>`;
}

function history() {
    if (!files.jobs.length) return '';
    return `<section class="files-history" aria-label="Traitements et résultats"><h3>Activité récente</h3>${[...files.jobs].reverse().map(job => {
        const busy = active.has(job.status);
        const done = job.outputs.length;
        return `<article class="files-job" data-job="${e(job.id)}"><div class="files-job-heading"><i class="ph ph-${busy ? 'circle-notch files-spinning' : done ? 'check-circle' : 'warning-circle'}" aria-hidden="true"></i><strong>${labels[job.status] || e(job.status)}</strong><span>${job.completed} / ${job.total}</span>${button(busy ? 'cancel' : 'forget', busy ? 'Annuler' : 'Retirer', busy ? 'x' : 'minus', job.status === 'cancelling' ? 'disabled' : '')}</div>${busy ? `<progress max="${job.total}" value="${job.completed}" aria-label="Fichiers traités"></progress>` : ''}${job.items.map(item => {
            const output = job.outputs.find(output => output.id === item.outputId);
            const gain = item.sizeBefore > 0 && output ? Math.round((1 - output.size / item.sizeBefore) * 100) : 0;
            return `<div class="files-result"><div><strong title="${e(output?.name || item.name)}">${e(output?.name || item.name)}</strong><span>${output ? `${bytes(item.sizeBefore)} → ${bytes(output.size)}${gain > 0 ? ` · ${gain} % plus léger` : gain < 0 ? ' · fichier plus volumineux' : ''}` : e(item.error || labels[item.status] || 'En attente')}</span></div>${output ? `<div class="files-result-actions" data-output="${e(output.id)}">${button('reveal-output', 'Afficher', 'folder-open')}${button('copy-output', 'Copier', 'copy')}${button('drag-output', 'Glisser', 'hand-grabbing', 'title="Maintenez et glissez le fichier vers une autre application"')}</div>` : ''}</div>`;
        }).join('')}</article>`;
    }).join('')}</section>`;
}

export function mountFiles(host, { onClose, onBack = onClose, ready = Promise.resolve(), onFit = null, onRender = () => {} }) {
    const panel = createPanel(host, `<div class="lib files-panel" tabindex="-1" aria-label="Fichiers Nolys"><header class="lib-header"><button type="button" class="round-btn" data-action="back" aria-label="Revenir au panneau précédent" title="Retour"><i class="ph-bold ph-caret-left"></i></button><div class="lib-heading"><span>Fichiers</span><small></small></div><button type="button" class="round-btn is-accent" data-action="pick" aria-label="Ajouter des fichiers" title="Ajouter"><i class="ph-bold ph-plus"></i></button><button type="button" class="round-btn" data-action="close" aria-label="Fermer les fichiers" title="Fermer"><i class="ph-bold ph-x"></i></button></header><div class="lib-list files-body" id="list"><div class="files-feedback files-notice" role="status" aria-live="polite" id="files-notice"></div><div id="files-content"></div></div><footer class="files-footer">Traitement local · Vos originaux restent intacts</footer><div class="lib-toast" id="toast" role="status" hidden></div><div class="lib-menu" id="menu" role="menu" hidden></div></div>`, { onFit });
    if (!fileSheet) { fileSheet = new CSSStyleSheet(); fileSheet.replaceSync(styles); }
    panel.root.adoptedStyleSheets = [...panel.root.adoptedStyleSheets, fileSheet];
    const root = panel.root;
    const content = root.querySelector('#files-content');
    const abort = new AbortController();
    const on = (target, name, fn) => target.addEventListener(name, fn, { signal: abort.signal });
    let destroyed = false;
    function render() {
        if (destroyed || files.outgoing) return;
        const focused = root.activeElement;
        const focusKey = focused?.id;
        const focusAction = focused?.dataset.action;
        const focusContext = focused?.closest('[data-output], [data-job]');
        const contextSelector = focusContext?.dataset.output ? `[data-output="${CSS.escape(focusContext.dataset.output)}"]` : focusContext?.dataset.job ? `[data-job="${CSS.escape(focusContext.dataset.job)}"]` : '';
        const scroll = root.querySelector('.files-body')?.scrollTop || 0;
        root.querySelector('.lib-heading small').textContent = files.inputs.length ? `${files.inputs.length} sélectionné${files.inputs.length > 1 ? 's' : ''}` : 'Convertir et transformer, en local';
        root.querySelectorAll('.lib-header button').forEach(button => { button.disabled = files.busy; });
        root.querySelector('#files-notice').textContent = files.notice;
        content.innerHTML = `${files.error ? `<div class="files-feedback files-error" role="alert">${e(files.error)}${button('dismiss-error', 'Fermer le message', 'x')}</div>` : ''}${selection()}${tools()}<div class="files-destination"><i class="ph ph-folder" aria-hidden="true"></i><span><strong>Destination des copies</strong><span title="${e(files.destination)}">${e(files.destination || 'Chargement…')}</span></span>${button('exports', 'Ouvrir', 'arrow-square-out')}</div>${history()}`;
        content.querySelector('[data-primary]')?.classList.add('is-accent');
        root.querySelector('.files-body').scrollTop = scroll;
        if (!focused?.isConnected) {
            const replacement = focusKey ? root.querySelector(`#${CSS.escape(focusKey)}`) : focusAction ? root.querySelector(`${contextSelector} [data-action="${CSS.escape(focusAction)}"]`) : null;
            replacement?.focus({ preventScroll: true });
        }
        panel.keepFocus(); panel.fit();
    }
    const unsubscribe = subscribe(render);
    on(root, 'click', async event => {
        event.stopPropagation();
        const tab = event.target.closest('[data-tab]');
        if (tab) { files.tab = tab.dataset.tab; notify(); return; }
        const button = event.target.closest('[data-action]');
        if (!button || button.disabled) return;
        const inputIds = files.inputs.map(input => input.id);
        const outputId = button.closest('[data-output]')?.dataset.output;
        const jobId = button.closest('[data-job]')?.dataset.job;
        switch (button.dataset.action) {
            case 'pick': await pick(); break;
            case 'close': if (!files.busy && !files.outgoing) onClose(); break;
            case 'back': if (!files.busy && !files.outgoing) onBack(); break;
            case 'convert': await start('convert'); break;
            case 'resize': await start('resize'); break;
            case 'compress': await start('compress'); break;
            case 'export': await start('copy'); break;
            case 'cancel': await act('files_cancel', { jobId }); break;
            case 'forget': await act('files_forget', { jobId }); break;
            case 'copy-inputs': await copy(inputIds); break;
            case 'copy-output': await copy([outputId]); break;
            case 'reveal-input': await act('files_reveal', { id: inputIds[0] }); break;
            case 'reveal-output': await act('files_reveal', { id: outputId }); break;
            case 'exports': await act('files_reveal', { id: null }); break;
            case 'dismiss-error': files.error = ''; notify(); break;
        }
    });
    on(root, 'change', event => {
        const key = event.target.dataset.option;
        if (!['format', 'quality', 'maxEdge', 'background'].includes(key)) return;
        files[key] = ['quality', 'maxEdge'].includes(key) ? Number(event.target.value) : event.target.value;
        notify();
    });
    on(root, 'input', event => {
        if (event.target.dataset.option === 'quality') { files.quality = Number(event.target.value); event.target.nextElementSibling.textContent = `${files.quality} %`; }
    });
    on(root, 'keydown', event => {
        if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); if (!files.busy && !files.outgoing) onClose(); }
        if (event.target.matches('[role="tab"]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
            event.preventDefault();
            const tabs = [...root.querySelectorAll('[role="tab"]')];
            const i = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tabs.indexOf(event.target) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
            tabs[i].click(); root.querySelector(`#${tabs[i].id}`)?.focus();
        }
    });
    on(root, 'pointerdown', event => {
        const button = event.target.closest('[data-action="drag-output"]');
        if (event.button !== 0 || !button) return;
        event.preventDefault();
        // This dedicated control has no click action. Enter OLE while the button
        // is still held; waiting for a DOM move can lose the gesture as it exits
        // the transparent WebView. Windows owns movement/cancellation from here.
        dragOut([button.closest('[data-output]').dataset.output]);
    });
    render();
    ready.then(() => { if (!destroyed) { panel.startIntro(); panel.focus(); onRender(); } });
    return { destroy() { destroyed = true; unsubscribe(); abort.abort(); panel.destroy(); }, get busy() { return files.busy || files.outgoing; } };
}
