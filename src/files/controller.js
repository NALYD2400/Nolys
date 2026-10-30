import { files, subscribe, notify, pick, start, act, copy, dragOut, remove, retry, configure } from './store.js';
import { escapeHtml as e } from '../island/dynamic-island/helpers/format.js';
import { createPanel } from '../library/panel.js';
import { native } from '../shared/ipc.js';
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
const canPreview = file => !file.directory && /\.(png|jpe?g|webp|bmp|gif|avif|ico|svg)$/i.test(file.name);
const previewButton = file => canPreview(file) ? `<button type="button" class="round-btn" data-action="preview" data-file="${e(file.id)}" aria-label="Aperçu de ${e(file.name)}" title="Aperçu de l’image"><i class="ph-bold ph-eye" aria-hidden="true"></i></button>` : '';

function selection() {
    if (!files.inputs.length) return `<div class="files-empty"><i class="ph ph-tray-arrow-down" aria-hidden="true"></i><h3>Déposez vos fichiers</h3>${button('pick', 'Choisir des fichiers', 'plus', files.busy ? 'disabled' : '')}</div>`;
    const total = files.inputs.reduce((sum, input) => sum + input.size, 0);
    const items = files.inputs.map(input => `<li data-input="${e(input.id)}"><i class="ph ph-${icons[input.kind] || 'file'}" aria-hidden="true"></i><span title="${e(input.name)}">${e(input.name)}</span><small>${input.directory ? 'Dossier' : bytes(input.size)}</small>${previewButton(input)}<button type="button" class="round-btn" data-action="remove-input" data-file="${e(input.id)}" aria-label="Retirer ${e(input.name)} de la sélection" ${files.busy ? 'disabled' : ''}><i class="ph-bold ph-x" aria-hidden="true"></i></button></li>`).join('');
    if (files.inputs.length === 1) return `<ul class="files-inputs files-selection" aria-label="Fichier sélectionné">${items}</ul>`;
    return `<details class="files-selection" id="files-selection-list"><summary><strong>${files.inputs.length} fichiers sélectionnés</strong><span>${bytes(total)}</span><i class="ph-bold ph-caret-down" aria-hidden="true"></i></summary><ul class="files-inputs" aria-label="Fichiers sélectionnés">${items}</ul><div class="files-actions">${button('clear-inputs', 'Vider la sélection', 'minus', files.busy ? 'disabled' : '')}</div></details>`;
}

function tabs() {
    const convertible = files.inputs.length && files.inputs.every(input => !input.directory && ['jpg', 'jpeg', 'png', 'webp', 'bmp'].includes(input.extension));
    const items = !files.inputs.length ? [['selection', 'Fichiers']] : convertible ? [['convert', 'Convertir'], ['tools', 'Dimensions'], ['actions', 'Actions']] : [['actions', 'Actions']];
    items.push(['history', 'Activité']);
    items.push(['preferences', 'Préférences']);
    if (!items.some(([id]) => id === files.tab)) files.tab = items[0][0];
    const pending = files.jobs.filter(job => active.has(job.status)).length;
    return items.map(([tab, name]) => `<button type="button" class="chip ${files.tab === tab ? 'is-active' : ''}" role="tab" aria-selected="${files.tab === tab}" tabindex="${files.tab === tab ? 0 : -1}" aria-controls="files-content" data-tab="${tab}" id="files-tab-${tab}">${name}${tab === 'history' && pending ? ` · ${pending}` : ''}</button>`).join('');
}

function tools() {
    if (!files.inputs.length) return '';
    const convertible = files.inputs.every(input => !input.directory && ['jpg', 'jpeg', 'png', 'webp', 'bmp'].includes(input.extension));
    const disabled = files.busy || !convertible ? 'disabled' : '';
    const content = files.tab === 'actions' ? `<div class="files-actions">${button('copy-inputs', 'Copier', 'copy', files.busy ? 'disabled' : '')}${button('export', 'Exporter une copie', 'folder-plus', files.busy || files.inputs.some(i => i.directory) ? 'disabled' : '')}${button('reveal-input', 'Afficher', 'folder-open')}</div>` : `
        ${!convertible ? '<p class="files-explanation">Cette sélection contient des fichiers qui ne sont pas compatibles avec les outils image. Les actions de gestion restent disponibles.</p>' : ''}
        <div class="files-form-row"><label for="files-format">Format de sortie</label><select id="files-format" data-option="format" ${disabled}>${[['png', 'PNG · transparence'], ['jpg', 'JPG · qualité réglable'], ['webp', 'WebP · sans perte'], ['bmp', 'BMP']].map(([value, text]) => `<option value="${value}" ${files.format === value ? 'selected' : ''}>${text}</option>`).join('')}</select></div>
        ${files.format === 'jpg' ? `<div class="files-form-row"><label for="files-quality">Qualité JPG</label><div class="files-quality"><input id="files-quality" data-option="quality" type="range" min="30" max="100" value="${files.quality}" ${disabled}><output for="files-quality">${files.quality} %</output></div></div><div class="files-form-row"><label for="files-background">Si l’image est transparente</label><select id="files-background" data-option="background" ${disabled}><option value="" ${!files.background ? 'selected' : ''}>Me demander avant de retirer la transparence</option><option value="#ffffff" ${files.background === '#ffffff' ? 'selected' : ''}>Fond blanc</option><option value="#000000" ${files.background === '#000000' ? 'selected' : ''}>Fond noir</option></select></div>` : ''}
        ${files.tab === 'tools' ? `<div class="files-form-row"><label for="files-size">Grand côté maximal</label><select id="files-size" data-option="maxEdge" ${disabled}>${[640, 1280, 1920, 2560, 3840].map(size => `<option value="${size}" ${files.maxEdge === size ? 'selected' : ''}>${new Intl.NumberFormat('fr-FR').format(size)} px</option>`).join('')}</select></div><div class="files-actions">${button('resize', 'Redimensionner', 'resize', disabled)}${button('compress', 'Compresser en JPG', 'arrows-in', `${disabled} ${files.format !== 'jpg' ? 'disabled title="Choisissez JPG pour régler la qualité"' : ''}`)}</div><p class="files-explanation">Proportions conservées, sans agrandissement.</p>` : `${button('convert', `Convertir en ${files.format.toUpperCase()}`, 'arrows-left-right', `data-primary ${disabled}`)}`}`;
    return `<div class="files-tools">${content}</div>`;
}

function history() {
    if (!files.jobs.length) return '<div class="files-empty"><i class="ph ph-clock-counter-clockwise" aria-hidden="true"></i><h3>Aucun traitement</h3><p>Vos résultats apparaîtront ici.</p></div>';
    const pages = Math.ceil(files.jobs.length / 20);
    files.historyPage = Math.max(1, Math.min(files.historyPage, pages));
    return `<section class="files-history" aria-label="Traitements et résultats"><p class="files-explanation">${files.jobs.length} traitement${files.jobs.length > 1 ? 's' : ''} · Les exports restent dans leur dossier après retrait de l’historique.</p>${[...files.jobs].reverse().slice((files.historyPage - 1) * 20, files.historyPage * 20).map(job => {
        const busy = active.has(job.status);
        const done = job.outputs.length;
        return `<article class="files-job" data-job="${e(job.id)}"><div class="files-job-heading"><i class="ph ph-${busy ? 'circle-notch files-spinning' : done ? 'check-circle' : 'warning-circle'}" aria-hidden="true"></i><strong>${labels[job.status] || e(job.status)}</strong><span>${job.completed} / ${job.total}</span>${!busy && job.retryable ? button('retry', 'Réessayer les échecs', 'arrow-clockwise', files.busy ? 'disabled' : '') : ''}${button(busy ? 'cancel' : 'forget', busy ? 'Annuler' : 'Retirer', busy ? 'x' : 'minus', job.status === 'cancelling' ? 'disabled' : '')}</div>${busy ? `<progress max="${job.total}" value="${job.completed}" aria-label="Fichiers traités"></progress>` : ''}${job.items.map(item => {
            const output = job.outputs.find(output => output.id === item.outputId);
            const gain = item.sizeBefore > 0 && output ? Math.round((1 - output.size / item.sizeBefore) * 100) : 0;
            return `<div class="files-result"><div><strong title="${e(output?.name || item.name)}">${e(output?.name || item.name)}</strong><span>${output ? `${bytes(item.sizeBefore)} → ${bytes(output.size)}${gain > 0 ? ` · ${gain} % plus léger` : gain < 0 ? ' · fichier plus volumineux' : ''}` : e(item.error || labels[item.status] || 'En attente')}</span></div>${output ? `<div class="files-result-actions" data-output="${e(output.id)}">${previewButton(output)}${button('reveal-output', 'Afficher', 'folder-open')}${button('copy-output', 'Copier', 'copy')}${button('drag-output', 'Glisser', 'hand-grabbing', 'title="Maintenez et glissez le fichier vers une autre application"')}</div>` : ''}</div>`;
        }).join('')}</article>`;
    }).join('')}${pages > 1 ? `<nav class="files-pagination" aria-label="Pages de l’activité">${button('history-previous', 'Précédent', 'caret-left', files.historyPage === 1 ? 'disabled' : '')}<span>${files.historyPage} / ${pages}</span>${button('history-next', 'Suivant', 'caret-right', files.historyPage === pages ? 'disabled' : '')}</nav>` : ''}</section>`;
}

function preferences() {
    const disabled = files.busy ? 'disabled' : '';
    return `<section class="files-preferences" aria-label="Préférences des fichiers"><h3>Prochains traitements</h3><p class="files-explanation">Ces valeurs seront proposées au prochain démarrage. Les traitements déjà lancés gardent leur dossier et leurs options.</p>
        <div class="files-form-row"><label for="files-default-format">Format</label><select id="files-default-format" data-option="format" ${disabled}>${['png', 'jpg', 'webp', 'bmp'].map(format => `<option value="${format}" ${files.format === format ? 'selected' : ''}>${format.toUpperCase()}</option>`).join('')}</select></div>
        <div class="files-form-row"><label for="files-default-quality">Qualité JPG</label><input id="files-default-quality" type="number" min="1" max="100" data-option="quality" value="${files.quality}" ${disabled}></div>
        <div class="files-form-row"><label for="files-default-edge">Grand côté maximal</label><input id="files-default-edge" type="number" min="1" max="16384" data-option="maxEdge" value="${files.maxEdge}" ${disabled}></div>
        <div class="files-form-row"><label for="files-default-background">Transparence en JPG</label><select id="files-default-background" data-option="background" ${disabled}><option value="" ${!files.background ? 'selected' : ''}>Me demander</option><option value="#ffffff" ${files.background === '#ffffff' ? 'selected' : ''}>Fond blanc</option><option value="#000000" ${files.background === '#000000' ? 'selected' : ''}>Fond noir</option></select></div>
        <div class="files-form-row"><label for="files-history-limit">Traitements terminés conservés</label><select id="files-history-limit" data-option="historyLimit" ${disabled}>${[20, 50, 100, 200, 500, 1000].map(limit => `<option value="${limit}" ${(files.historyLimit ?? files.preferences.historyLimit) === limit ? 'selected' : ''}>${limit}</option>`).join('')}</select></div>
        <p class="files-explanation">Seules les entrées anciennes de l’activité sont retirées. Les fichiers originaux et exportés sont conservés.</p>${button('save-preferences', 'Enregistrer les préférences', 'check', disabled)}
        <h3>Dossier des exports</h3><p class="files-destination">${e(files.destination)}</p>${button('choose-destination', 'Choisir un dossier', 'folder-open', disabled)}</section>`;
}

export function mountFiles(host, { onClose, onBack = onClose, ready = Promise.resolve(), onRender = () => {}, onPreviewChange = () => {} }) {
    const panel = createPanel(host, `<div class="lib files-panel" tabindex="-1" aria-label="Fichiers Nolys"><header class="lib-header"><button type="button" class="round-btn" data-action="back" aria-label="Revenir au panneau précédent" title="Retour"><i class="ph-bold ph-caret-left"></i></button><div class="lib-heading"><span>Fichiers</span></div><button type="button" class="round-btn is-accent" data-action="pick" aria-label="Ajouter des fichiers" title="Ajouter"><i class="ph-bold ph-plus"></i></button><button type="button" class="round-btn" data-action="close" aria-label="Fermer les fichiers" title="Fermer"><i class="ph-bold ph-x"></i></button></header><nav class="lib-chips files-tabs" id="files-tabs" role="tablist" aria-label="Fichiers et activité"></nav><div class="lib-list files-body" id="list"><div class="files-feedback files-notice" role="status" aria-live="polite" id="files-notice"></div><section id="files-content" role="tabpanel"></section></div><footer class="files-footer"><span>Originaux conservés</span>${button('exports', 'Dossier des exports', 'folder-open')}</footer><div class="lib-toast" id="toast" role="status" hidden></div><div class="lib-menu" id="menu" role="menu" hidden></div></div>`);
    if (!fileSheet) { fileSheet = new CSSStyleSheet(); fileSheet.replaceSync(styles); }
    panel.root.adoptedStyleSheets = [...panel.root.adoptedStyleSheets, fileSheet];
    const root = panel.root;
    const content = root.querySelector('#files-content');
    const abort = new AbortController();
    const on = (target, name, fn) => target.addEventListener(name, fn, { signal: abort.signal });
    let destroyed = false, previousTab = files.tab;
    let confirmRepair = false;
    let preview = null, previewRequest = 0, loadingPreview = null, previewScroll = 0;
    let selectionKey = files.inputs.map(input => input.id).join('|');
    function returnToFiles() {
        const id = preview?.id || loadingPreview;
        ++previewRequest; loadingPreview = null;
        content.querySelector('img')?.removeAttribute('src');
        preview = null; onPreviewChange(false); render();
        root.querySelector('.files-body').scrollTop = previewScroll;
        root.querySelector(`[data-file="${CSS.escape(id || '')}"]`)?.focus({ preventScroll: true });
    }
    async function openPreview(id) {
        const file = [...files.inputs, ...files.jobs.flatMap(job => job.outputs)].find(file => file.id === id);
        if (!file || !canPreview(file)) return;
        const request = ++previewRequest;
        previewScroll = root.querySelector('.files-body').scrollTop;
        loadingPreview = id; files.error = ''; render();
        try {
            const path = await native.invoke('files_preview', { id });
            if (destroyed || request !== previewRequest) return;
            preview = { id, name: file.name, src: native.fileSrc(path) };
            onPreviewChange(true);
        } catch (error) {
            if (!destroyed && request === previewRequest) files.error = String(error?.message || error);
        } finally {
            if (!destroyed && request === previewRequest) { loadingPreview = null; render(); if (preview) root.querySelector('[data-action="back"]').focus({ preventScroll: true }); }
        }
    }
    function render() {
        if (destroyed || files.outgoing) return;
        const currentSelection = files.inputs.map(input => input.id).join('|');
        if (currentSelection !== selectionKey) {
            selectionKey = currentSelection; ++previewRequest; loadingPreview = null;
            if (preview) { content.querySelector('img')?.removeAttribute('src'); preview = null; onPreviewChange(false); }
        }
        root.querySelector('.files-panel').classList.toggle('is-preview', Boolean(preview));
        root.querySelector('#files-tabs').hidden = Boolean(preview);
        root.querySelector('.files-footer').hidden = Boolean(preview);
        root.querySelector('.lib-header [data-action="pick"]').hidden = Boolean(preview);
        root.querySelector('.lib-heading span').textContent = preview ? preview.name : 'Fichiers';
        const back = root.querySelector('[data-action="back"]');
        back.setAttribute('aria-label', preview ? 'Revenir aux fichiers' : 'Revenir au panneau précédent');
        if (preview) {
            root.querySelector('#files-notice').textContent = '';
            content.setAttribute('aria-label', `Aperçu de ${preview.name}`);
            content.removeAttribute('aria-labelledby');
            if (!content.querySelector('#files-preview-image')) {
                content.innerHTML = `<div class="files-preview"><div class="files-preview-error" role="alert" hidden><p>Cette image ne peut pas être affichée. Vérifiez son format ou son emplacement.</p>${button('reveal-preview', 'Afficher dans le dossier', 'folder-open')}</div></div>`;
                const image = document.createElement('img');
                image.id = 'files-preview-image'; image.alt = preview.name; image.decoding = 'async';
                image.onerror = () => { if (!destroyed && image.isConnected) { image.hidden = true; content.querySelector('.files-preview-error').hidden = false; } };
                image.src = preview.src;
                content.querySelector('.files-preview').prepend(image);
            }
            root.querySelector('.files-body').scrollTop = 0;
            panel.keepFocus(); return;
        }
        content.removeAttribute('aria-label');
        const focused = root.activeElement;
        const focusKey = focused?.id;
        const focusAction = focused?.dataset.action;
        const focusContext = focused?.closest('[data-output], [data-job], [data-input]');
        const contextSelector = focusContext?.dataset.output ? `[data-output="${CSS.escape(focusContext.dataset.output)}"]` : focusContext?.dataset.job ? `[data-job="${CSS.escape(focusContext.dataset.job)}"]` : focusContext?.dataset.input ? `[data-input="${CSS.escape(focusContext.dataset.input)}"]` : '';
        const tabChanged = previousTab !== files.tab;
        const scroll = tabChanged ? 0 : root.querySelector('.files-body')?.scrollTop || 0;
        previousTab = files.tab;
        const openDetails = [...content.querySelectorAll('details[open]')].map(el => el.id);
        root.querySelector('#files-tabs').innerHTML = tabs();
        root.querySelectorAll('.lib-header button').forEach(button => { button.disabled = files.busy; });
        root.querySelector('#files-notice').textContent = files.notice;
        const recovery = files.repairable ? `<section class="files-recovery" aria-label="Récupération de l’historique"><p>Vous pouvez ouvrir le journal ou démarrer un historique neuf. Une copie de l’original sera conservée avant toute reconstruction ; les exports restent dans leur dossier.</p><div class="files-actions">${button('reveal-history', 'Ouvrir l’emplacement', 'folder-open')}${confirmRepair ? button('confirm-repair', 'Conserver l’original et reconstruire', 'arrow-clockwise', files.busy ? 'disabled' : '') + button('cancel-repair', 'Annuler', 'x') : button('repair-history', 'Reconstruire l’historique…', 'first-aid')}</div></section>` : '';
        content.innerHTML = `${files.error ? `<div class="files-feedback files-error" role="alert">${e(files.error)}${button('dismiss-error', 'Fermer le message', 'x', 'aria-label="Fermer le message"')}</div>` : ''}${recovery}${files.tab === 'history' ? history() : files.tab === 'preferences' ? preferences() : selection() + tools()}`;
        content.setAttribute('aria-labelledby', `files-tab-${files.tab}`);
        if (tabChanged) panel.tabIn(content);
        openDetails.forEach(id => { const details = content.querySelector(`#${id}`); if (details) details.open = true; });
        content.querySelectorAll('[data-action="preview"]').forEach(button => { button.disabled = files.busy || button.dataset.file === loadingPreview; });
        root.querySelector('[data-action="exports"]').title = files.destination || 'Dossier des exports';
        content.querySelector('[data-primary]')?.classList.add('is-accent');
        root.querySelector('.files-body').scrollTop = scroll;
        if (!focused?.isConnected) {
            const replacement = focusKey ? root.querySelector(`#${CSS.escape(focusKey)}`) : focusAction ? root.querySelector(`${contextSelector} [data-action="${CSS.escape(focusAction)}"]`) : null;
            replacement?.focus({ preventScroll: true });
        }
        panel.keepFocus();
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
            case 'preview': await openPreview(button.dataset.file); break;
            case 'reveal-preview': if (preview) await act('files_reveal', { id: preview.id }); break;
            case 'pick': await pick(); break;
            case 'close': if (!files.busy && !files.outgoing) onClose(); break;
            case 'back': if (preview || loadingPreview) returnToFiles(); else if (!files.busy && !files.outgoing) onBack(); break;
            case 'convert': case 'resize': case 'compress': case 'export':
                await start(button.dataset.action === 'export' ? 'copy' : button.dataset.action);
                break;
            case 'cancel': await act('files_cancel', { jobId }); break;
            case 'forget': await act('files_forget', { jobId }); break;
            case 'retry': await retry(jobId); break;
            case 'remove-input': await remove([button.dataset.file]); break;
            case 'clear-inputs': await remove(inputIds); break;
            case 'history-previous': files.historyPage--; notify(); break;
            case 'history-next': files.historyPage++; notify(); break;
            case 'save-preferences': await configure('files_preferences', { preferences: { format: files.format, quality: files.quality, maxEdge: files.maxEdge, background: files.background || null, historyLimit: files.historyLimit ?? files.preferences.historyLimit } }); break;
            case 'choose-destination': await configure('files_pick_destination'); break;
            case 'repair-history': confirmRepair = true; render(); root.querySelector('[data-action="confirm-repair"]')?.focus(); break;
            case 'cancel-repair': confirmRepair = false; render(); break;
            case 'confirm-repair': await configure('files_repair_history'); confirmRepair = false; render(); break;
            case 'reveal-history': await act('files_reveal_history'); break;
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
        if (!['format', 'quality', 'maxEdge', 'background', 'historyLimit'].includes(key)) return;
        files[key] = ['quality', 'maxEdge', 'historyLimit'].includes(key) ? Number(event.target.value) : event.target.value;
        notify();
    });
    on(root, 'input', event => {
        if (event.target.dataset.option === 'quality' && event.target.type === 'range') { files.quality = Number(event.target.value); event.target.nextElementSibling.textContent = `${files.quality} %`; }
    });
    on(root, 'keydown', event => {
        if (event.key === 'Escape') { event.stopPropagation(); event.preventDefault(); if (preview || loadingPreview) returnToFiles(); else if (!files.busy && !files.outgoing) onClose(); }
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
    on(window, 'resize', () => { if (preview) onPreviewChange(true); });
    render();
    ready.then(() => { if (!destroyed) { panel.startIntro(); panel.focus(); onRender(); } });
    return { destroy() { destroyed = true; ++previewRequest; content.querySelector('img')?.removeAttribute('src'); preview = null; unsubscribe(); abort.abort(); panel.destroy(); }, get busy() { return files.busy || files.outgoing; } };
}
