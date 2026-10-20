/** Recherche Spotlight. */
export const searchView = {
    openSpotlightSearch() {
        this.mode = 'search';
        this.isExpanded = true;
        this.el.classList.remove('island-idle');
        this.el.classList.add('island-expanded');
        this.renderContent();
        setTimeout(() => {
            const input = this.el.querySelector('#island-search-input');
            if (input) input.focus();
        }, 120);
    },

    renderSearch() {
        this.content.innerHTML = `
            <div class="island-search-container">
                <div class="search-bar-integrated">
                    <i class="ph ph-magnifying-glass search-icon-integrated"></i>
                    <input type="text" id="island-search-input" placeholder="Rechercher…" autofocus>
                    <button class="island-close-search" title="Fermer la recherche" aria-label="Fermer la recherche" data-island-action="closeSearch">
                        <i class="ph ph-x"></i>
                    </button>
                </div>
                <div id="island-search-results" class="island-search-results">
                    <!-- Results injected here from SearchManager events -->
                    <div class="search-empty-state">Tape pour commencer…</div>
                </div>
            </div>
        `;

        const input = this.content.querySelector('#island-search-input');
        input.oninput = (e) => {
            window.dispatchEvent(new CustomEvent('liquid-search-input', { detail: e.target.value }));
        };

        // Prevent island expansion toggle when clicking input
        input.onclick = (e) => e.stopPropagation();
    },
};
