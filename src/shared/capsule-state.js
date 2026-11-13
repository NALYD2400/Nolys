/**
 * États de la capsule et événements autorisés.
 *
 * Postures :
 * - compact : pilule repliée (mode musique)
 * - module : une vue dépliée
 * - placement : déplacement, la navigation des modules est refusée
 *
 * `transitioning` n'est pas une quatrième posture : une demande arrivée
 * pendant le ressort est reportée (`defer`) et atterrit sur `next`.
 * Le placement refuse ouvrir, replier et basculer. L'aperçu de placement
 * est le seul dépliage permis dans ce mode.
 */

export function capsuleSnapshot({
    mode = 'music',
    expanded = false,
    transitioning = false,
    placement = false,
    preview = false,
    busy = null,
} = {}) {
    return {
        mode,
        expanded: Boolean(expanded),
        transitioning: Boolean(transitioning),
        placement: Boolean(placement),
        preview: Boolean(preview),
        busy: busy || null,
    };
}

function copy(state, patch) {
    return { ...state, ...patch };
}

/**
 * @returns {{ effect: 'apply' | 'defer' | 'refuse' | 'noop', next: object, reason?: string }}
 */
export function decide(state, intent) {
    const current = capsuleSnapshot(state);
    if (!intent || typeof intent.type !== 'string') {
        return { effect: 'refuse', next: current, reason: 'unknown' };
    }

    if (intent.type === 'enter-placement') {
        return {
            effect: 'apply',
            next: copy(current, { placement: true, preview: false, transitioning: false, mode: 'music', expanded: false }),
        };
    }
    if (intent.type === 'leave-placement') {
        if (!current.placement) return { effect: 'noop', next: current, reason: 'already-idle' };
        return {
            effect: 'apply',
            next: copy(current, { placement: false, preview: false, transitioning: false, expanded: false }),
        };
    }
    if (intent.type === 'toggle-preview') {
        if (!current.placement) return { effect: 'refuse', next: current, reason: 'preview-outside-placement' };
        const on = typeof intent.on === 'boolean' ? intent.on : !current.preview;
        return { effect: 'apply', next: copy(current, { mode: 'music', preview: on, expanded: on }) };
    }
    if (intent.type === 'reset') {
        if (current.placement) return { effect: 'refuse', next: current, reason: 'placement' };
        return { effect: 'apply', next: copy(current, { mode: 'music', expanded: false, transitioning: false }) };
    }

    if (current.placement && (intent.type === 'open' || intent.type === 'collapse' || intent.type === 'toggle')) {
        return { effect: 'refuse', next: current, reason: 'placement' };
    }

    if (intent.type === 'collapse') {
        if (current.mode === 'files') return { effect: 'apply', next: current, reason: 'close-files' };
        if (current.busy === 'replay' && !intent.force) return { effect: 'refuse', next: current, reason: 'replay-busy' };
        if (!current.expanded) return { effect: 'noop', next: current, reason: 'already-compact' };
        if (current.busy === 'library') return { effect: 'refuse', next: current, reason: 'library-busy' };
        if (current.busy === 'settings' && !intent.force) return { effect: 'refuse', next: current, reason: 'settings-busy' };
        if (current.mode === 'notification') return { effect: 'apply', next: current, reason: 'dismiss-notification' };
        const next = copy(current, { mode: 'music', expanded: false });
        if (current.transitioning) return { effect: 'defer', next, reason: 'transition' };
        return { effect: 'apply', next };
    }

    if (intent.type === 'toggle') {
        const next = copy(current, { expanded: !current.expanded });
        if (current.transitioning) return { effect: 'defer', next, reason: 'transition' };
        return { effect: 'apply', next };
    }

    if (intent.type === 'open') {
        const mode = typeof intent.mode === 'string' ? intent.mode : '';
        if (!mode) return { effect: 'refuse', next: current, reason: 'missing-mode' };
        const next = copy(current, { mode, expanded: intent.expand ? true : current.expanded });
        if (current.transitioning) return { effect: 'defer', next, reason: 'transition' };
        return { effect: 'apply', next };
    }

    return { effect: 'refuse', next: current, reason: 'unknown' };
}
