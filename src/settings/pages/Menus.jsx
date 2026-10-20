import { useEffect, useRef, useState } from 'react';
import { Button, Card, Icon, Row, Segmented, Select, Switch, Toggle } from '../components/controls.jsx';
import { MENU_ACTIONS, MAX_MENU_ITEMS, menuEntry, sanitizeMenus, SHORTCUT_ICONS } from '../../shared/menu-config.js';
import { SHORTCUT_PRESETS } from '../state/presets.js';

const WINDOWS_SHORTCUTS = Object.entries(SHORTCUT_PRESETS).filter(([, preset]) => preset.cmd && !preset.cmd.startsWith('liquid:'));
const EMPTY_DRAFT = { kind: '', name: '', cmd: '', icon: SHORTCUT_ICONS[0] };

export default function Menus({ store }) {
    const { settings, update } = store;
    const menus = sanitizeMenus(settings.menus);
    const [surface, setSurface] = useState('modules');
    const [draft, setDraft] = useState(EMPTY_DRAFT);
    const [editing, setEditing] = useState(null);
    const [error, setError] = useState('');
    const formRef = useRef(null);
    useEffect(() => {
        if (editing) {
            formRef.current?.scrollIntoView({ block: 'nearest' });
            formRef.current?.querySelector('input')?.focus({ preventScroll: true });
        }
    }, [editing]);
    const entries = menus[surface];
    const setEntries = next => update({ menus: { ...menus, [surface]: next } });
    const clearDraft = () => { setDraft(EMPTY_DRAFT); setEditing(null); setError(''); };
    const changeSurface = next => { setSurface(next); clearDraft(); };
    const move = (index, step) => {
        const next = [...entries];
        [next[index], next[index + step]] = [next[index + step], next[index]];
        setEntries(next);
    };
    const groups = [
        { label: 'Fonctions de Nolys', options: MENU_ACTIONS.filter(action =>
            !(surface === 'modules' && action.contextOnly) && !entries.some(entry => entry.id === action.id))
            .map(action => ({ value: action.id, label: action.label, icon: action.icon })) },
        { label: 'Windows', options: WINDOWS_SHORTCUTS.map(([id, preset]) => ({ value: `windows:${id}`, label: preset.name, icon: preset.icon })) },
        { label: 'Personnel', options: [{ value: 'custom', label: 'Application, dossier ou lien…', icon: 'ph-arrow-square-out' }] },
    ].filter(group => group.options.length);

    const choose = kind => {
        setError('');
        if (kind.startsWith('windows:')) {
            const preset = SHORTCUT_PRESETS[kind.slice(8)];
            setDraft({ kind, name: preset.name, cmd: preset.cmd, icon: 'ph-app-window' });
        } else setDraft({ ...EMPTY_DRAFT, kind });
    };
    const save = event => {
        event.preventDefault();
        const builtin = MENU_ACTIONS.find(action => action.id === draft.kind);
        if (!builtin && (!draft.name.trim() || !draft.cmd.trim())) {
            setError('Renseigne un nom et une destination.');
            return;
        }
        const entry = builtin ? { id: builtin.id, enabled: true } : {
            id: editing || `custom-${crypto.randomUUID()}`, enabled: entries.find(item => item.id === editing)?.enabled !== false,
            name: draft.name.trim(), cmd: draft.cmd.trim(), icon: draft.icon,
        };
        setEntries(editing ? entries.map(item => item.id === editing ? entry : item) : [...entries, entry]);
        clearDraft();
    };

    return (
        <>
            <Card footer="Les modifications sont enregistrées automatiquement. Les réglages restent accessibles dans les deux menus.">
                <Segmented label="Personnaliser" value={surface} onChange={changeSurface} options={[
                    { value: 'modules', label: 'Modules' }, { value: 'context', label: 'Clic droit' },
                ]} />
            </Card>
            <Card title={surface === 'modules' ? 'Menu des modules' : 'Menu du clic droit'}
                footer={surface === 'modules'
                    ? 'La bulle adapte sa taille aux boutons visibles. Masquer un bouton conserve sa fonction et ses raccourcis clavier.'
                    : 'L’ordre de cette liste est celui du menu. Les boutons masqués restent disponibles ici.'}>
                {surface === 'context' && <Toggle label="Afficher le morceau et les commandes de lecture" checked={menus.showMedia}
                    onChange={showMedia => update({ menus: { ...menus, showMedia } })} />}
                <ol className="menu-editor-list" aria-label="Ordre des boutons">
                    {entries.map((entry, index) => {
                        const action = menuEntry(entry);
                        const custom = entry.id.startsWith('custom-');
                        const unavailable = action.flag && localStorage.getItem(action.flag) === 'false';
                        return (
                            <li key={entry.id} className={`menu-editor-row${entry.enabled === false ? ' is-hidden' : ''}`}>
                                <Icon name={action.icon} className="menu-editor-icon" />
                                <div className="menu-editor-name">
                                    <span>{action.label}</span>
                                    {custom && <small title={entry.cmd}>{entry.cmd}</small>}
                                    {unavailable && <small>Module désactivé dans ses réglages</small>}
                                </div>
                                <div className="menu-editor-actions">
                                    {custom && <button type="button" className="menu-editor-button" title={`Modifier ${action.label}`} aria-label={`Modifier ${action.label}`}
                                        onClick={() => { setEditing(entry.id); setDraft({ kind: 'custom', name: entry.name, cmd: entry.cmd, icon: entry.icon }); setError(''); }}><Icon name="ph-pencil-simple" /></button>}
                                    <button type="button" className="menu-editor-button" disabled={index === 0} title={`Monter ${action.label}`} aria-label={`Monter ${action.label}`} onClick={() => move(index, -1)}><Icon name="ph-arrow-up" /></button>
                                    <button type="button" className="menu-editor-button" disabled={index === entries.length - 1} title={`Descendre ${action.label}`} aria-label={`Descendre ${action.label}`} onClick={() => move(index, 1)}><Icon name="ph-arrow-down" /></button>
                                    {entry.id === 'settings' ? <Icon name="ph-lock-simple" className="menu-editor-lock" /> :
                                        <Switch aria-label={`Afficher ${action.label}`} checked={entry.enabled !== false}
                                            onCheckedChange={enabled => setEntries(entries.map(item => item.id === entry.id ? { ...item, enabled } : item))} />}
                                    {custom && <button type="button" className="menu-editor-button" title={`Retirer ${action.label}`} aria-label={`Retirer ${action.label}`}
                                        onClick={() => { setEntries(entries.filter(item => item.id !== entry.id)); if (editing === entry.id) clearDraft(); }}><Icon name="ph-trash" /></button>}
                                </div>
                            </li>
                        );
                    })}
                </ol>
            </Card>
            <Card title={editing ? 'Modifier le raccourci' : 'Ajouter un bouton'}>
                <form onSubmit={save} ref={formRef}>
                    {!editing && <Row label="Destination"><Select value={draft.kind} groups={groups} onChange={choose} placeholder="Choisir un bouton…" /></Row>}
                    {(draft.kind === 'custom' || draft.kind.startsWith('windows:') || editing) && (
                        <div className="menu-editor-fields">
                            <label>Nom du bouton<input className="text-input" maxLength={40} value={draft.name} placeholder="Mon raccourci"
                                onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
                            <label>Application, dossier ou lien<input className="text-input" maxLength={2048} value={draft.cmd} placeholder="C:\…\app.exe ou https://…"
                                onChange={event => setDraft({ ...draft, cmd: event.target.value })} /></label>
                            <div className="menu-editor-icons" role="group" aria-label="Icône du raccourci">
                                {SHORTCUT_ICONS.map((icon, index) => <button type="button" key={icon} className="menu-editor-button" aria-label={['Lien', 'Dossier', 'Site web', 'Application', 'Favori', 'Jeu', 'Code', 'Musique'][index]}
                                    aria-pressed={draft.icon === icon} onClick={() => setDraft({ ...draft, icon })}><Icon name={icon} /></button>)}
                            </div>
                            <p className="card-footer">Chemin complet vers un programme, un fichier ou un dossier, adresse https:// ou protocole d’application (spotify:, ms-settings:…).</p>
                        </div>
                    )}
                    {error && <p className="hotkey-error menu-editor-message" role="alert">{error}</p>}
                    {entries.length >= MAX_MENU_ITEMS && !editing && <p className="card-footer" role="status">Limite de {MAX_MENU_ITEMS} boutons atteinte. Retire un raccourci pour en ajouter un.</p>}
                    {(draft.kind || editing) && <div className="menu-editor-form-actions">
                        <Button type="button" onClick={clearDraft}>Annuler</Button>
                        <Button type="submit" icon={editing ? 'ph-check' : 'ph-plus'} disabled={!editing && entries.length >= MAX_MENU_ITEMS}>{editing ? 'Enregistrer' : 'Ajouter'}</Button>
                    </div>}
                </form>
            </Card>
        </>
    );
}
