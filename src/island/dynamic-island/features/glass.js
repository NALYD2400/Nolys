/**
 * Verre des boutons (Liquid Glass) : retiré.
 *
 * Le verre était recalculé en WebGL à chaque image sur chaque bouton, et les défilements
 * (bibliothèque, historique, centre de contrôle) traînaient derrière le doigt. Les boutons
 * gardent maintenant leur style classique, en CSS. Les méthodes ci-dessous restent là, vides,
 * pour que les vues qui les appellent n'aient rien à changer.
 */
export const glassMethods = {
    /** Plus de verre : le réglage « Boutons en verre » n'existe plus. */
    isGlassControlsEnabled() {
        return false;
    },

    /** Plus de surfaces en verre. */
    hasGlassSurfaces() {
        return false;
    },

    /** Retire la classe qui activait l'ancien verre, s'il en reste une trace. */
    releaseGlassControls() {
        this.el.classList.remove('glass-controls');
    },

    /** Sans verre, rien à poser sur les vues. */
    async syncGlassControls() {
        this.releaseGlassControls();
    },
};
