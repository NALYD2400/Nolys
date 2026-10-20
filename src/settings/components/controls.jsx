/**
 * Briques d'interface des réglages. Tout est en HTML et CSS simples (styles.css) : pas de
 * verre réfracté. Un verre recalculé à chaque image faisait traîner le défilement des pages.
 */
import { startTransition, useEffect, useRef, useState } from 'react';
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
                {options.map((option) => {
                    const selected = option.value === value;
                    return (
                        <button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            className={`segment${selected ? ' is-selected' : ''}`}
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

/** Place à garder sous un bouton pour que son menu s'ouvre vers le bas (hauteur du menu, marge). */
const MENU_SPACE = 260;

/**
 * Menu déroulant, le même partout : intitulé de section et icône devant chaque choix.
 * `groups` : [{ label, options: [{ value, label, icon }] }] ; ou `options` avec `title` (une seule section).
 */
export function Select({ value, options, groups, title, onChange, placeholder = 'Choisir…' }) {
    const [open, setOpen] = useState(false);
    // Menu ouvert vers le haut quand il n'a pas la place sous le bouton (fin de page).
    const [up, setUp] = useState(false);
    const root = useRef(null);
    const sections = groups ?? [{ label: title, options }];
    const allOptions = sections.flatMap((group) => group.options);
    const current = allOptions.find((option) => option.value === value);

    // Fermeture au clic ailleurs et à Échap.
    useEffect(() => {
        if (!open) return undefined;
        // Le chemin composé traverse le shadow DOM : `target` vaudrait l'hôte, et le menu se
        // fermerait avant que le clic sur un de ses choix ne soit reçu.
        const onPointer = (event) => { if (root.current && !event.composedPath().includes(root.current)) setOpen(false); };
        const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
        document.addEventListener('pointerdown', onPointer, true);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', onPointer, true);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const renderItems = (items) =>
        items.map((option) => {
            const selected = option.value === value;
            return (
                <button
                    key={option.value}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    className={selected ? 'menu-item is-selected' : 'menu-item'}
                    onClick={() => {
                        playClick();
                        setOpen(false);
                        onChange(option.value);
                    }}
                >
                    {option.icon && <Icon name={option.icon.replace(/^ph(-fill|-bold)? /, '')} />}
                    <span>{option.label}</span>
                    {selected && <Icon name="ph-check" weight="bold" className="menu-check" />}
                </button>
            );
        });

    return (
        <div className="select" ref={root}>
            <button
                type="button"
                className="select-trigger glass"
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={(event) => {
                    if (!open) {
                        const rect = event.currentTarget.getBoundingClientRect();
                        const below = window.innerHeight - rect.bottom;
                        setUp(below < MENU_SPACE && rect.top > below);
                    }
                    setOpen((state) => !state);
                }}
            >
                <span>{current?.label ?? placeholder}</span>
                <Icon name="ph-caret-up-down" />
            </button>
            {open && (
                <div className={`select-menu glass${up ? ' is-up' : ''}`} role="listbox">
                    {sections.map((group, index) => (
                        <div key={group.label ?? index} role="group" aria-label={group.label}>
                            {group.label && <div className="menu-group-label">{group.label}</div>}
                            {renderItems(group.options)}
                        </div>
                    ))}
                </div>
            )}
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
