/**
 * Briques d'interface des réglages. Tout est en HTML et CSS simples (styles.css) : pas de
 * verre réfracté. Un verre recalculé à chaque image faisait traîner le défilement des pages.
 */
import { startTransition, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { playClick } from '../state/sound.js';

/** Vert « activé » façon iOS : l'état reste lisible quelle que soit la pochette. */
export const SWITCH_TINT = '#30d158';

/** Une seule graisse pour toute l'interface : régulière (`ph`). `weight="bold"` seulement pour les coches. */
export const Icon = ({ name, weight = 'regular', className = '' }) => (
    <i className={`${weight === 'regular' ? 'ph' : `ph-${weight}`} ${name} ${className}`} aria-hidden="true" />
);

/** Groupe de réglages sur une surface sombre. */
export function Card({ title, footer, children }) {
    return (
        <section className="card">
            {title && <h2 className="card-title">{title}</h2>}
            <div className="card-surface glass">{children}</div>
            {footer && <p className="card-footer">{footer}</p>}
        </section>
    );
}

/** Ligne : libellé (et description) à gauche, contrôle à droite. */
export function Row({ label, description, children, stacked = false }) {
    return (
        <div className={`row${stacked ? ' row-stacked' : ''}`}>
            <div className="row-text">
                <span className="row-label">{label}</span>
                {description && <span className="row-description">{description}</span>}
            </div>
            {children && <div className="row-control">{children}</div>}
        </div>
    );
}

/** Interrupteur à deux états (role="switch"). */
export function Switch({ checked, onCheckedChange, ...props }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            className={`switch${checked ? ' is-on' : ''}`}
            onClick={() => onCheckedChange(!checked)}
            {...props}
        >
            <span className="switch-knob" />
        </button>
    );
}

/**
 * L'interrupteur bascule tout de suite (état local) ; la mise à jour des réglages suit en
 * priorité basse : elle redessine toute la page et ne doit pas saccader l'animation.
 */
export function Toggle({ label, description, checked, onChange }) {
    const [optimistic, setOptimistic] = useState(null);
    useEffect(() => {
        if (optimistic === null) return undefined;
        if (optimistic === checked) { setOptimistic(null); return undefined; }
        // Changement refusé (ou jamais confirmé) : on revient à l'état réel.
        const timer = setTimeout(() => setOptimistic(null), 1500);
        return () => clearTimeout(timer);
    }, [checked, optimistic]);
    return (
        <Row label={label} description={description}>
            <Switch
                aria-label={label}
                checked={optimistic ?? checked}
                onCheckedChange={(value) => {
                    playClick();
                    setOptimistic(value);
                    startTransition(() => onChange(value));
                }}
            />
        </Row>
    );
}

/** Curseur `live` : pendant un glissement, au plus une mise à jour toutes les 50 ms. */
const SLIDER_SEND_MS = 50;

/** Curseur continu ; `format` met en forme la valeur affichée. */
export function SliderRow({ label, description, value, min, max, step = 1, format = (v) => v, onChange, onPreview, live = false }) {
    // La valeur en cours de glissement vit ici : seul ce curseur se redessine à chaque
    // mouvement, pas toute la page. Elle n'est envoyée qu'au lâcher. `live` : envoi pendant
    // le glissement (le volume du retour micro, qu'on doit entendre changer).
    const [draft, setDraft] = useState(null);
    const send = useRef({ last: 0, timer: null, value: null, onChange, onPreview });
    send.current.onChange = onChange;
    // `onPreview` : chaque position, sans passer par les réglages (aperçu qui suit le doigt).
    send.current.onPreview = onPreview;
    useEffect(() => () => clearTimeout(send.current.timer), []);
    // La valeur reçue a rattrapé le glissement (aller-retour natif compris) : on la reprend.
    useEffect(() => {
        if (draft === null) return undefined;
        if (value === draft) { setDraft(null); return undefined; }
        const timer = setTimeout(() => setDraft(null), 800);
        return () => clearTimeout(timer);
    }, [value, draft]);

    const flush = () => {
        const state = send.current;
        clearTimeout(state.timer);
        state.timer = null;
        state.last = performance.now();
        state.onChange(state.value);
    };
    const change = (next) => {
        const state = send.current;
        state.value = next;
        setDraft(next);
        state.onPreview?.(next);
        if (!live) return;
        const wait = SLIDER_SEND_MS - (performance.now() - state.last);
        if (wait <= 0) flush();
        else if (!state.timer) state.timer = setTimeout(flush, wait);
    };
    const shown = draft ?? value;
    return (
        <Row label={label} description={description} stacked>
            <div className="slider">
                <input
                    type="range"
                    className="slider-input"
                    aria-label={label}
                    min={min}
                    max={max}
                    step={step}
                    value={shown}
                    style={{ '--fill': `${((shown - min) / (max - min)) * 100}%` }}
                    onChange={(event) => change(Number(event.target.value))}
                    onPointerUp={() => { send.current.value = shown; flush(); }}
                    onKeyUp={() => { send.current.value = shown; flush(); }}
                />
                <span className="slider-value">{format(shown)}</span>
            </div>
        </Row>
    );
}

/** Choix exclusif court, en contrôle segmenté. */
export function Segmented({ label, description, value, options, onChange }) {
    return (
        <Row label={label} description={description}>
            <div className="segmented" role="radiogroup" aria-label={label}>
                {options.map((option, index) => {
                    const selected = option.value === value;
                    return (
                        <button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            tabIndex={selected || (!options.some(item => item.value === value) && index === 0) ? 0 : -1}
                            className={`segment${selected ? ' is-selected' : ''}`}
                            onKeyDown={event => {
                                if (!['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
                                event.preventDefault();
                                const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
                                    : (index + (['ArrowRight', 'ArrowDown'].includes(event.key) ? 1 : -1) + options.length) % options.length;
                                event.currentTarget.parentElement.querySelectorAll('[role="radio"]')[next]?.focus();
                                playClick(); onChange(options[next].value);
                            }}
                            onClick={() => {
                                if (selected) return;
                                playClick();
                                onChange(option.value);
                            }}
                        >
                            {option.label}
                        </button>
                    );
                })}
            </div>
        </Row>
    );
}

/** Choix visuel en vignettes (matériau, style de fond d'écran, widget…). */
export function ChoiceGrid({ value, options, onChange, columns = options.length }) {
    return (
        <div className="choice-grid" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
            {options.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    className={`choice${option.value === value ? ' is-selected' : ''}`}
                    aria-pressed={option.value === value}
                    onClick={() => {
                        playClick();
                        onChange(option.value);
                    }}
                >
                    <span className={`choice-preview choice-${option.value}`}>
                        <Icon name={option.icon} />
                    </span>
                    <span className="choice-label">{option.label}</span>
                </button>
            ))}
        </div>
    );
}

const MENU_MAX_HEIGHT = 320;
const MENU_GAP = 6;

/**
 * Menu déroulant, le même partout : intitulé de section et icône devant chaque choix.
 * `groups` : [{ label, options: [{ value, label, icon }] }] ; ou `options` avec `title` (une seule section).
 */
export function Select({ value, options, groups, title, onChange, placeholder = 'Choisir…' }) {
    const [open, setOpen] = useState(false);
    const [up, setUp] = useState(false);
    const [menuSize, setMenuSize] = useState({});
    const [active, setActive] = useState(0);
    const root = useRef(null);
    const trigger = useRef(null);
    const menu = useRef(null);
    const search = useRef({ text: '', at: 0 });
    const id = useId();
    const sections = groups ?? [{ label: title, options: options ?? [] }];
    const allOptions = sections.flatMap(group => group.options);
    const selectedIndex = allOptions.findIndex(option => option.value === value);
    const current = allOptions[selectedIndex];
    const show = (index = Math.max(0, selectedIndex)) => {
        if (!allOptions.length) return;
        setActive(index);
        setOpen(true);
    };
    const close = (restore = false) => { setOpen(false); if (restore) trigger.current?.focus(); };
    const choose = index => {
        const option = allOptions[index];
        if (!option) return;
        playClick(); close(true); onChange(option.value);
    };
    useLayoutEffect(() => {
        if (!open) return undefined;
        const page = root.current.closest('.page');
        const position = () => {
            const rect = root.current.getBoundingClientRect();
            const bounds = page?.getBoundingClientRect();
            // La fenêtre native comprend de larges marges transparentes. La page,
            // avec son masque de défilement, est la limite réellement visible.
            const scale = rect.height / root.current.offsetHeight || 1;
            const top = Math.max(0, bounds?.top ?? 0) + 14 * scale;
            const bottom = Math.min(window.innerHeight, bounds?.bottom ?? window.innerHeight) - 30 * scale;
            const above = Math.max(0, (rect.top - top) / scale - MENU_GAP);
            const below = Math.max(0, (bottom - rect.bottom) / scale - MENU_GAP);
            const height = Math.min(MENU_MAX_HEIGHT, menu.current.scrollHeight);
            const upwards = below < height && above > below;
            setUp(upwards);
            setMenuSize({
                '--select-menu-height': `${Math.min(MENU_MAX_HEIGHT, upwards ? above : below)}px`,
                '--select-menu-width': `${Math.max(0, (rect.right - Math.max(0, bounds?.left ?? 0)) / scale - 8)}px`,
            });
        };
        position();
        page?.addEventListener('scroll', position, { passive: true });
        window.addEventListener('resize', position);
        const observer = new ResizeObserver(position);
        if (page) observer.observe(page);
        return () => {
            page?.removeEventListener('scroll', position);
            window.removeEventListener('resize', position);
            observer.disconnect();
        };
    }, [open]);
    useEffect(() => {
        if (!open) return undefined;
        const onPointer = event => { if (root.current && !event.composedPath().includes(root.current)) setOpen(false); };
        document.addEventListener('pointerdown', onPointer, true);
        return () => document.removeEventListener('pointerdown', onPointer, true);
    }, [open]);
    useEffect(() => {
        if (!open) return;
        const item = root.current?.querySelector(`[data-option-index="${active}"]`);
        if (!item || !menu.current) return;
        item.focus({ preventScroll: true });
        // Ne déplacer que la liste : scrollIntoView faisait aussi défiler la page
        // et pouvait repousser le bouton et son menu hors de la capsule.
        const bounds = menu.current.getBoundingClientRect();
        const rect = item.getBoundingClientRect();
        const scale = bounds.height / menu.current.offsetHeight || 1;
        if (rect.top < bounds.top + 6 * scale) menu.current.scrollTop += (rect.top - bounds.top) / scale - 6;
        else if (rect.bottom > bounds.bottom - 6 * scale) menu.current.scrollTop += (rect.bottom - bounds.bottom) / scale + 6;
    }, [open, active]);
    const onKeyDown = event => {
        const key = event.key;
        if (key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true); return; }
        if (key === 'Tab') { close(); return; }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(key)) {
            event.preventDefault(); event.stopPropagation();
            if (!allOptions.length) return;
            const next = key === 'Home' ? 0 : key === 'End' ? allOptions.length - 1
                : !open ? Math.max(0, selectedIndex) : (active + (key === 'ArrowDown' ? 1 : -1) + allOptions.length) % allOptions.length;
            if (open) setActive(next); else show(next);
        } else if (open && (key === 'Enter' || key === ' ')) {
            event.preventDefault(); event.stopPropagation(); choose(active);
        } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && key !== ' ') {
            const now = performance.now();
            search.current.text = now - search.current.at > 700 ? key : search.current.text + key;
            search.current.at = now;
            const text = search.current.text.toLocaleLowerCase();
            const start = open ? active : Math.max(0, selectedIndex);
            const indices = allOptions.map((_, index) => (start + index + 1) % allOptions.length);
            const index = indices.find(index => allOptions[index].label.toLocaleLowerCase().startsWith(text));
            if (index !== undefined) { event.preventDefault(); if (open) setActive(index); else show(index); }
        }
    };
    let optionIndex = 0;
    return (
        <div className="select" ref={root} onKeyDown={onKeyDown}
            onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}>
            <button type="button" ref={trigger} id={`${id}-trigger`} className="select-trigger glass"
                aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${id}-list` : undefined}
                aria-label={title ? `${title} : ${current?.label ?? placeholder}` : undefined}
                onClick={() => open ? close() : show()}>
                <span>{current?.label ?? placeholder}</span><Icon name="ph-caret-up-down" />
            </button>
            {open && <div ref={menu} id={`${id}-list`} style={menuSize} className={`select-menu glass${up ? ' is-up' : ''}`} role="listbox" aria-labelledby={`${id}-trigger`}>
                {sections.map((group, groupIndex) => <div key={group.label ?? groupIndex} role="group" aria-label={group.label}>
                    {group.label && <div className="menu-group-label">{group.label}</div>}
                    {group.options.map(option => {
                        const index = optionIndex++;
                        const selected = option.value === value;
                        return <button key={option.value} type="button" role="option" aria-selected={selected}
                            tabIndex={index === active ? 0 : -1} data-option-index={index}
                            className={selected ? 'menu-item is-selected' : 'menu-item'} onClick={() => choose(index)}>
                            {option.icon && <Icon name={option.icon.replace(/^ph(-fill|-bold)? /, '')} />}
                            <span>{option.label}</span>{selected && <Icon name="ph-check" weight="bold" className="menu-check" />}
                        </button>;
                    })}
                </div>)}
            </div>}
        </div>
    );
}
/** Pastille de couleur (sélecteur natif). */
export function ColorSwatch({ label, value, onChange }) {
    return (
        <label className="swatch" title={label}>
            <input type="color" value={value} aria-label={label} onChange={(e) => onChange(e.target.value)} />
            <span className="swatch-dot" style={{ background: value }} />
        </label>
    );
}

export function Button({ children, icon, tone, ...props }) {
    return (
        <button
            type="button"
            className={`button glass${tone ? ` button-${tone}` : ''}`}
            {...props}
            onClick={(event) => {
                playClick();
                props.onClick?.(event);
            }}
        >
            {icon && <Icon name={icon} />}
            {children}
        </button>
    );
}

const MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'AltGraph', 'Meta']);
/** Noms attendus par le cœur natif pour les touches autres que lettres, chiffres et F-touches. */
const CODE_NAMES = {
    Space: 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Enter: 'Enter', Tab: 'Tab',
    Backspace: 'Backspace', Delete: 'Delete', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', Insert: 'Insert',
    Comma: 'Comma', Period: 'Period', Minus: 'Minus', Equal: 'Equal', Slash: 'Slash', Semicolon: 'Semicolon', Quote: 'Quote',
    Backquote: 'Backquote', Backslash: 'Backslash', BracketLeft: 'BracketLeft', BracketRight: 'BracketRight',
};
const FUNCTION_KEY = /^F([1-9]|1\d|2[0-4])$/;

/** Nom de la touche physique (`event.code`), indépendant de la disposition du clavier (AZERTY, QWERTY…). */
function keyName(code) {
    const letter = /^Key([A-Z])$/.exec(code);
    if (letter) return letter[1];
    const digit = /^Digit(\d)$/.exec(code);
    if (digit) return digit[1];
    if (FUNCTION_KEY.test(code) || /^Numpad\d$/.test(code)) return code;
    return CODE_NAMES[code] ?? null;
}

/**
 * Combinaison de touches : un clic, puis la combinaison au clavier. Échap annule, un clic
 * ailleurs aussi. Une touche seule est refusée (sauf F1 à F24) : elle ferait taper partout.
 */
export function ShortcutRecorder({ value, onChange, label, off = false }) {
    const [recording, setRecording] = useState(false);
    const [hint, setHint] = useState('');

    useEffect(() => {
        if (!recording) return undefined;
        const onKey = (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (event.key === 'Escape') {
                setRecording(false);
                setHint('');
                return;
            }
            if (MODIFIERS.has(event.key)) return;
            const key = keyName(event.code);
            if (!key) {
                setHint('Touche non prise en charge');
                return;
            }
            const modifiers = [];
            if (event.ctrlKey) modifiers.push('Ctrl');
            if (event.shiftKey) modifiers.push('Shift');
            if (event.altKey) modifiers.push('Alt');
            if (event.metaKey) modifiers.push('Super');
            if (modifiers.length === 0 && !FUNCTION_KEY.test(key)) {
                setHint('Ajoute Ctrl, Alt ou Maj');
                return;
            }
            setRecording(false);
            setHint('');
            onChange([...modifiers, key].join('+'));
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [recording, onChange]);

    return (
        <button
            type="button"
            className={`shortcut glass${recording ? ' is-recording' : ''}${off ? ' is-off' : ''}`}
            aria-label={label ? `Raccourci : ${label}` : undefined}
            onClick={() => {
                playClick();
                setHint('');
                setRecording((current) => !current);
            }}
            onBlur={() => {
                setRecording(false);
                setHint('');
            }}
        >
            {recording && (hint || 'Appuie sur les touches…')}
            {!recording && (value ? value.split('+').map((part) => <kbd key={part}>{part}</kbd>) : 'Aucune')}
        </button>
    );
}

/** Masque son contenu sans le démonter brutalement (apparition douce). */
export function Reveal({ when, children }) {
    return <div className={`reveal${when ? ' is-open' : ''}`} aria-hidden={!when}>{when ? children : null}</div>;
}
