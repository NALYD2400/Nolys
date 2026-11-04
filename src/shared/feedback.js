/** Même durée, icône et annonce accessible pour les retours d'action de chaque vue. */
const timers = new WeakMap();
export const FEEDBACK_DURATION = { success: 2400, error: 6000 };

export function clearFeedback(element) {
    if (!element) return;
    clearTimeout(timers.get(element));
    timers.delete(element);
    element.hidden = true;
}

export function showFeedback(element, message, { error = false, icon = error ? 'ph-warning-circle' : 'ph-check' } = {}) {
    if (!element) return;
    clearFeedback(element);
    if (!message) return;
    const glyph = document.createElement('i');
    glyph.className = `ph ${/^ph-[a-z0-9-]+$/.test(icon) ? icon : 'ph-check'}`;
    glyph.setAttribute('aria-hidden', 'true');
    const text = document.createElement('span');
    text.textContent = String(message);
    element.replaceChildren(glyph, text);
    element.classList.add('feedback-toast');
    element.classList.toggle('is-error', error);
    element.setAttribute('role', error ? 'alert' : 'status');
    element.setAttribute('aria-live', error ? 'assertive' : 'polite');
    element.setAttribute('aria-atomic', 'true');
    element.hidden = false;
    timers.set(element, setTimeout(() => clearFeedback(element), error ? FEEDBACK_DURATION.error : FEEDBACK_DURATION.success));
}
