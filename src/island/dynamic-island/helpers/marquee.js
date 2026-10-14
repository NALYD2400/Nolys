/**
 * Défilement en boucle d'un titre trop long : le texte part vers la gauche et une
 * copie le suit, si bien que la boucle ne se voit pas (pas d'aller-retour).
 *
 * `box` coupe le texte (overflow: hidden), `text` est l'élément en ligne qui défile.
 * Renvoie true si le titre défile.
 */
const GAP = 18; // espace entre la fin du titre et sa copie (px)
const SPEED = 28; // px par seconde

/** Largeur réelle du texte, qu'il soit en ligne (scrollWidth vaut alors 0) ou en bloc. */
const textWidth = (text) => Math.max(text.scrollWidth, text.getBoundingClientRect().width);

export function applyLoopMarquee(box, text, overflow = textWidth(text) - box.clientWidth) {
    if (overflow <= 2) {
        box.classList.remove('is-marquee');
        return false;
    }
    const width = textWidth(text);
    const copy = text.cloneNode(true);
    copy.setAttribute('aria-hidden', 'true');
    copy.classList.add('marquee-copy');
    copy.style.marginLeft = `${GAP}px`;
    // Les deux exemplaires défilent ensemble dans une piste commune.
    const track = document.createElement('span');
    track.className = 'marquee-track';
    text.replaceWith(track);
    track.append(text, copy);
    box.classList.add('is-marquee');
    box.style.setProperty('--marquee-shift', `-${width + GAP}px`);
    box.style.setProperty('--marquee-duration', `${((width + GAP) / SPEED).toFixed(1)}s`);
    return true;
}
