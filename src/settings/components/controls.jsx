/**
 * Briques d'interface des réglages, construites sur les composants Liquid Glass.
 */
import { useEffect, useState } from 'react';
import {
    GlassButton,
    GlassMenu,
    GlassMenuContent,
    GlassMenuGroup,
    GlassMenuGroupLabel,
    GlassMenuItem,
    GlassMenuTrigger,
    GlassSlider,
    GlassSurface,
    GlassSwitch,
    GlassTabsIndicator,
    GlassTabsList,
    GlassTabsRoot,
    GlassTabsTrigger,
} from '@glass-sdk/liquid-glass';
import { playClick } from '../state/sound.js';

/** Vert « activé » façon iOS : l'état reste lisible quelle que soit la pochette. */
export const SWITCH_TINT = '#30d158';
/** Remplissage neutre des curseurs (comme le centre de contrôle macOS). */
const SLIDER_TINT = '#e5e5ea';

/** Une seule graisse pour toute l'interface : régulière (`ph`). `weight="bold"` seulement pour les coches. */
export const Icon = ({ name, weight = 'regular', className = '' }) => (
    <i className={`${weight === 'regular' ? 'ph' : `ph-${weight}`} ${name} ${className}`} aria-hidden="true" />
);

/** Groupe de réglages sur une surface de verre. */
export function Card({ title, footer, children }) {
    return (
        <section className="card">
            {title && <h2 className="card-title">{title}</h2>}
            <GlassSurface className="card-surface" material="regular" radius={18}>
                {children}
            </GlassSurface>
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

export function Toggle({ label, description, checked, onChange }) {
    return (
        <Row label={label} description={description}>
            <GlassSwitch
                aria-label={label}
                tint={SWITCH_TINT}
                checked={checked}
                onCheckedChange={(value) => {
                    playClick();
                    onChange(value);
                }}
            />
        </Row>
    );
}

/** Curseur continu ; `format` met en forme la valeur affichée. */
export function SliderRow({ label, description, value, min, max, step = 1, format = (v) => v, onChange }) {
    return (
        <Row label={label} description={description} stacked>
            <div className="slider">
                <GlassSlider
                    aria-label={label}
                    tint={SLIDER_TINT}
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    onValueChange={(next) => onChange(Array.isArray(next) ? next[0] : next)}
                />
                <span className="slider-value">{format(value)}</span>
            </div>
        </Row>
    );
}

/** Choix exclusif court, en contrôle segmenté à lentille de verre. */
export function Segmented({ label, description, value, options, onChange }) {
    return (
        <Row label={label} description={description}>
            <GlassTabsRoot
                value={value}
                onValueChange={(next) => {
                    playClick();
                    onChange(next);
                }}
            >
                <GlassTabsList size="sm" aria-label={label}>
                    <GlassTabsIndicator />
                    {options.map((option) => (
                        <GlassTabsTrigger key={option.value} value={option.value}>
                            {option.label}
                        </GlassTabsTrigger>
                    ))}
                </GlassTabsList>
            </GlassTabsRoot>
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

/** Menu déroulant en verre. `groups` : [{ label, options: [{ value, label, icon }] }]. */
export function Select({ value, options, groups, onChange, placeholder = 'Choisir…' }) {
    const allOptions = groups ? groups.flatMap((group) => group.options) : options;
    const current = allOptions.find((option) => option.value === value);
    const renderItems = (items) =>
        items.map((option) => (
            <GlassMenuItem
                key={option.value}
                className={option.value === value ? 'menu-item is-selected' : 'menu-item'}
                onClick={() => {
                    playClick();
                    onChange(option.value);
                }}
            >
                {option.icon && <Icon name={option.icon.replace(/^ph(-fill|-bold)? /, '')} />}
                <span>{option.label}</span>
                {option.value === value && <Icon name="ph-check" weight="bold" className="menu-check" />}
            </GlassMenuItem>
        ));

    return (
        <GlassMenu>
            <GlassSurface render={<GlassMenuTrigger />} className="select-trigger" radius="capsule" interactive>
                <span>{current?.label ?? placeholder}</span>
                <Icon name="ph-caret-up-down" />
            </GlassSurface>
            {/* « detach » : le menu se détache du bouton comme une goutte, le bouton reste visible
                (par défaut, le bouton devenait le menu et disparaissait pendant l'ouverture). */}
            <GlassMenuContent className="select-menu" align="end" morph="detach">
                {groups
                    ? groups.map((group) => (
                          <GlassMenuGroup key={group.label}>
                              <GlassMenuGroupLabel className="menu-group-label">{group.label}</GlassMenuGroupLabel>
                              {renderItems(group.options)}
                          </GlassMenuGroup>
                      ))
                    : renderItems(options)}
            </GlassMenuContent>
        </GlassMenu>
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
        <GlassButton
            className={`button${tone ? ` button-${tone}` : ''}`}
            {...props}
            onClick={(event) => {
                playClick();
                props.onClick?.(event);
            }}
        >
            {icon && <Icon name={icon} />}
            {children}
        </GlassButton>
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
        <GlassButton
            className={`shortcut${recording ? ' is-recording' : ''}${off ? ' is-off' : ''}`}
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
        </GlassButton>
    );
}

/** Masque son contenu sans le démonter brutalement (apparition douce). */
export function Reveal({ when, children }) {
    return <div className={`reveal${when ? ' is-open' : ''}`} aria-hidden={!when}>{when ? children : null}</div>;
}
