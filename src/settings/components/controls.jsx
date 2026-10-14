/**
 * Briques d'interface des réglages, construites sur les composants Liquid Glass.
 */
import { useEffect, useRef, useState } from 'react';
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
const SWITCH_TINT = '#30d158';
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

const MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'Meta']);
const KEY_NAMES = { ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };

/** Enregistre une combinaison de touches au clavier. */
export function ShortcutRecorder({ value, onChange }) {
    const [recording, setRecording] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!recording) return undefined;
        const onKey = (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (event.key === 'Escape') {
                setRecording(false);
                return;
            }
            if (MODIFIERS.has(event.key)) return;
            const keys = [];
            if (event.ctrlKey) keys.push('Ctrl');
            if (event.shiftKey) keys.push('Shift');
            if (event.altKey) keys.push('Alt');
            if (event.metaKey) keys.push('Super');
            let key = KEY_NAMES[event.key] ?? event.key;
            key = key.length === 1 ? key.toUpperCase() : key.charAt(0).toUpperCase() + key.slice(1);
            keys.push(key);
            setRecording(false);
            onChange(keys.join('+'));
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [recording, onChange]);

    return (
        <GlassButton
            ref={ref}
            className={`shortcut${recording ? ' is-recording' : ''}`}
            onClick={() => {
                playClick();
                setRecording((current) => !current);
            }}
        >
            {recording ? 'Appuie sur les touches…' : value.split('+').map((part) => <kbd key={part}>{part}</kbd>)}
        </GlassButton>
    );
}

/** Masque son contenu sans le démonter brutalement (apparition douce). */
export function Reveal({ when, children }) {
    return <div className={`reveal${when ? ' is-open' : ''}`} aria-hidden={!when}>{when ? children : null}</div>;
}
