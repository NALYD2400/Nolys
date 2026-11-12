/** Menus dans la capsule : les listes natives Windows suivent la plus longue fenêtre. */
import { menuGeometry } from '../shared/menu-geometry.js';

export function createReplaySelects(root, on) {
    const panel = root.querySelector('.replay-panel');
    const list = root.querySelector('#list');
    const controls = new Map();
    let opened = null, active = 0, search = '', searchAt = 0;
    let anchorScrollTop = 0;
    let optionsSignature = '';
    const menu = document.createElement('div');
    menu.className = 'replay-select-menu'; menu.hidden = true; menu.setAttribute('role', 'listbox');
    panel.append(menu);

    function close(restoreFocus = false) {
        if (!opened) return false;
        const trigger = opened.trigger;
        opened = null; optionsSignature = ''; menu.hidden = true; menu.replaceChildren();
        trigger.setAttribute('aria-expanded', 'false');
        if (restoreFocus && trigger.isConnected) trigger.focus({preventScroll: true});
        return true;
    }
    function focusOption(index) {
        const options = [...menu.querySelectorAll('[role="option"]')];
        if (!options.length) return;
        active = (index + options.length) % options.length;
        options.forEach((option, i) => { option.tabIndex = i === active ? 0 : -1; });
        options[active].focus({preventScroll: true});
        const option = options[active];
        if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop;
        else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight) {
            menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight;
        }
    }
    function choose(index) {
        const current = opened;
        if (!current || current.select.disabled) return;
        const option = [...current.select.options].filter(option => !option.disabled)[index];
        if (!option) return;
        current.select.value = option.value;
        close(true);
        current.select.dispatchEvent(new Event('change', {bubbles: true}));
        sync();
        // Les filtres reconstruisent la liste : retrouve le nouveau bouton après ce rendu.
        root.getElementById(current.trigger.id)?.focus({preventScroll: true});
    }
    function open(control, first) {
        if (control.select.disabled) return;
        if (opened === control) { close(true); return; }
        close(); opened = control; search = ''; anchorScrollTop = list.scrollTop;
        const options = [...control.select.options].filter(option => !option.disabled);
        if (!options.length) { opened = null; return; }
        menu.id = `${control.trigger.id}-list`; menu.setAttribute('aria-labelledby', control.trigger.id);
        control.trigger.setAttribute('aria-controls', menu.id); control.trigger.setAttribute('aria-expanded', 'true');
        fillOptions(options);
        menu.hidden = false;
        position();
        focusOption(first === 'last' ? options.length - 1 : Math.max(0, options.findIndex(option => option.selected)));
    }
    const optionSignature = options => JSON.stringify(options.map(option => [option.value, option.textContent, option.selected]));
    function fillOptions(options) {
        optionsSignature = optionSignature(options);
        menu.replaceChildren(...options.map((option, index) => {
            const item = document.createElement('button');
            item.type = 'button'; item.setAttribute('role', 'option');
            item.setAttribute('aria-selected', String(option.selected)); item.dataset.optionIndex = index;
            item.textContent = option.textContent; item.title = option.textContent; item.dataset.value = option.value;
            return item;
        }));
    }
    function position() {
        if (!opened) return;
        const area = menuGeometry(panel), anchor = area.rect(opened.trigger.getBoundingClientRect());
        const margin = 12, gap = 5;
        const below = area.height - anchor.bottom - margin - gap, above = anchor.top - margin - gap;
        const preferredHeight = Math.min(250, menu.scrollHeight + 2 * menu.clientTop);
        const up = below < preferredHeight && above > below;
        menu.style.width = `${Math.max(1, Math.min(anchor.width, area.width - 24))}px`;
        menu.style.maxHeight = `${Math.max(1, Math.min(250, area.height - 24, up ? above : below))}px`;
        menu.style.left = `${Math.max(12, Math.min(anchor.left, area.width - menu.offsetWidth - 12))}px`;
        const top = up ? anchor.top - menu.offsetHeight - gap : anchor.bottom + gap;
        menu.style.top = `${Math.max(12, Math.min(top, area.height - menu.offsetHeight - 12))}px`;
        menu.style.transformOrigin = up ? 'bottom' : 'top';
    }
    const resize = new ResizeObserver(position);
    resize.observe(panel);
    function sync() {
        for (const [select, control] of controls) {
            if (!select.isConnected) { if (opened === control) close(); resize.unobserve(control.trigger); controls.delete(select); continue; }
            const label = select.selectedOptions[0]?.textContent || 'Choisir';
            if (control.text.textContent !== label) control.text.textContent = label;
            control.trigger.title = control.text.textContent;
            control.trigger.disabled = select.disabled;
            if (select.disabled && opened === control) close(true);
        }
        // Une source peut arriver ou disparaître pendant que sa liste est ouverte.
        // Conserver la valeur pointée plutôt qu'un index devenu celui d'une autre fenêtre.
        if (opened) {
            const options = [...opened.select.options].filter(option => !option.disabled);
            if (!options.length) { close(true); return; }
            if (optionSignature(options) !== optionsSignature) {
                const value = menu.children[active]?.dataset.value;
                fillOptions(options); position();
                const index = options.findIndex(option => option.value === value);
                focusOption(index >= 0 ? index : Math.max(0, options.findIndex(option => option.selected)));
            }
        }
    }
    function refresh() {
        sync();
        for (const select of root.querySelectorAll('select')) {
            if (controls.has(select)) continue;
            const wrapper = document.createElement('div'); wrapper.className = 'replay-select';
            const trigger = document.createElement('button'); trigger.type = 'button';
            const id = select.id || `replay-query-${select.dataset.query}`;
            trigger.id = `${id}-trigger`; trigger.className = 'replay-select-trigger';
            trigger.setAttribute('role', 'combobox'); trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false');
            const label = select.id && root.querySelector(`label[for="${CSS.escape(select.id)}"]`);
            if (label) { label.htmlFor = trigger.id; trigger.setAttribute('aria-label', label.textContent.trim()); }
            else trigger.setAttribute('aria-label', select.getAttribute('aria-label') || 'Choix');
            const text = document.createElement('span'); trigger.append(text);
            const caret = document.createElement('i'); caret.className = 'ph ph-caret-down'; caret.setAttribute('aria-hidden', 'true'); trigger.append(caret);
            select.before(wrapper); wrapper.append(trigger, select);
            select.hidden = true; select.tabIndex = -1; select.setAttribute('aria-hidden', 'true');
            controls.set(select, {select, trigger, text});
            resize.observe(trigger);
        }
        sync();
    }
    on(root, 'click', event => {
        const trigger = event.target.closest('.replay-select-trigger');
        if (trigger) { const control = [...controls.values()].find(control => control.trigger === trigger); if (control) open(control); return; }
        const option = event.target.closest('.replay-select-menu [role="option"]');
        if (option) choose(Number(option.dataset.optionIndex));
    });
    on(root, 'keydown', event => {
        const trigger = event.target.closest('.replay-select-trigger');
        if (!opened && !trigger) return;
        const key = event.key;
        if (key === 'Escape' && opened) { event.preventDefault(); event.stopImmediatePropagation(); close(true); return; }
        if (key === 'Tab' && opened) { close(true); return; }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
            event.preventDefault(); event.stopImmediatePropagation();
            if (!opened) { const control = [...controls.values()].find(control => control.trigger === trigger); if (control) open(control, key === 'End' ? 'last' : undefined); }
            else focusOption(key === 'Home' ? 0 : key === 'End' ? menu.children.length - 1 : active + (key === 'ArrowDown' ? 1 : -1));
        } else if (opened && ['Enter', ' '].includes(key)) { event.preventDefault(); event.stopImmediatePropagation(); choose(active); }
        else if (opened && key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            const now = performance.now(); search = now - searchAt > 700 ? key : search + key; searchAt = now;
            const items = [...menu.children], query = search.toLocaleLowerCase('fr');
            const index = items.findIndex(item => item.textContent.toLocaleLowerCase('fr').startsWith(query));
            if (index >= 0) { event.preventDefault(); focusOption(index); }
        }
    });
    on(document, 'pointerdown', event => { if (opened && !event.composedPath().includes(menu) && !event.composedPath().includes(opened.trigger)) close(); }, {capture: true});
    on(root, 'focusin', event => { if (opened && !menu.contains(event.target) && event.target !== opened.trigger) close(); });
    // Le clic peut suivre un scroll de mise au point dont l'événement est encore
    // en attente. Seul un mouvement après le placement invalide l'ancrage du menu.
    on(list, 'scroll', () => { if (list.scrollTop !== anchorScrollTop) close(); });
    on(window, 'resize', () => close(true));
    on(window, 'blur', () => close());
    return {refresh, sync, close, destroy: () => { resize.disconnect(); close(); menu.remove(); controls.clear(); }};
}
