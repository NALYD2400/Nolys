// Structure partagée par la vue intégrée et son aperçu de développement.
export const libraryMarkup = `
<div class="library-shell">
        <header class="titlebar">
            <div class="brand"><i class="ph ph-music-notes" aria-hidden="true"></i><strong>Bibliothèque</strong><span>Votre musique</span></div>
            <div class="window-actions">
                <button data-action="collapse" aria-label="Replier l’Island" title="Replier l’Island"><i class="ph ph-minus"></i></button>
                <button data-action="back-menu" aria-label="Revenir au menu de l’Island" title="Menu de l’Island"><i class="ph ph-squares-four"></i></button>
            </div>
        </header>
        <aside class="sidebar">
            <nav id="navigation" aria-label="Bibliothèque"></nav>
            <div class="playlists-heading"><h2>Mes playlists</h2><button data-action="create-playlist" class="icon-button" aria-label="Créer une playlist"><i class="ph ph-plus"></i></button></div>
            <nav id="playlists" aria-label="Playlists"></nav>
            <div class="sidebar-note"><i class="ph ph-hard-drives"></i><span>Votre musique, sur votre PC.<br>Aucun fichier dupliqué.</span></div>
        </aside>
        <main>
            <div class="workspace-tools">
                <label class="search"><i class="ph ph-magnifying-glass"></i><input id="search" type="search" placeholder="Rechercher dans la bibliothèque" aria-label="Rechercher un morceau, un artiste ou un album"></label>
                <details class="import-menu"><summary class="button primary"><i class="ph ph-plus"></i>Importer<i class="ph ph-caret-down"></i></summary><div class="dropdown"><button data-import="files"><i class="ph ph-file-audio"></i>Des fichiers</button><button data-import="folder"><i class="ph ph-folder-open"></i>Un dossier</button></div></details>
            </div>
            <div id="status" role="status" aria-live="polite" hidden></div>
            <section id="collection" aria-label="Collection musicale"><div class="loading">Ouverture de la bibliothèque…</div></section>
        </main>
        <footer id="player" class="player" aria-label="Lecteur de la bibliothèque">
            <div class="now-playing"><div id="playing-cover" class="cover"><i class="ph ph-vinyl-record"></i></div><div class="playing-text"><strong id="playing-title">Choisissez un morceau</strong><span id="playing-artist">La lecture continue dans l’Island.</span></div></div>
            <div class="transport">
                <div class="transport-buttons">
                    <button class="icon-button" data-control="shuffle" aria-label="Lecture aléatoire" aria-pressed="false"><i class="ph ph-shuffle"></i></button>
                    <button class="icon-button" data-media="prev" aria-label="Morceau précédent"><i class="ph-fill ph-skip-back"></i></button>
                    <button class="play-toggle" data-media="toggle" aria-label="Lecture" disabled><i class="ph-fill ph-play"></i></button>
                    <button class="icon-button" data-media="next" aria-label="Morceau suivant"><i class="ph-fill ph-skip-forward"></i></button>
                    <button class="icon-button" data-control="repeat" aria-label="Répétition désactivée" aria-pressed="false"><i class="ph ph-repeat"></i></button>
                </div>
                <div class="timeline"><span id="elapsed">0:00</span><input id="seek" type="range" min="0" max="1" value="0" step="1000" aria-label="Position de lecture" disabled><span id="duration">0:00</span></div>
            </div>
            <div class="player-options"><button class="icon-button" data-view="queue" aria-label="Voir la file de lecture"><i class="ph ph-queue"></i></button><i class="ph ph-speaker-high" aria-hidden="true"></i><input id="volume" type="range" min="0" max="1" step="0.01" value="0.8" aria-label="Volume du lecteur"><button class="icon-button" data-control="stop" aria-label="Arrêter la musique locale et revenir aux lecteurs externes" title="Revenir aux lecteurs externes"><i class="ph ph-eject"></i></button></div>
        </footer>
    </div>
    <div id="track-menu" class="dropdown track-menu" role="menu" hidden></div>
    <dialog id="dialog"><form id="dialog-form"><div id="dialog-content"></div></form></dialog>
`;
