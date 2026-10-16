# Réglages dans l’Island

Les Réglages sont un mode de la capsule (`settings`), comme la Bibliothèque : plus de fenêtre séparée.

## Ouverture

| Depuis | Chemin |
| --- | --- |
| Menu, clic droit, centre de contrôle | `island.setMode('settings')` → `openSettings()` (`src/island/dynamic-island/views/settings.js`) |
| Icône de la barre des tâches | `island::open_settings(app, false)` (Rust) → événement `open-settings` → `openSettings()` |
| Raccourci (Ctrl+Alt+P par défaut) | `island::open_settings(app, true)` → `toggleSettings()` : un second appui referme |

Côté Rust, `open_settings` réaffiche l’Island (masquée à la main ou par un plein écran), la place au premier plan et lui donne le focus : Échap agit tout de suite et un clic ailleurs la replie.

## Montage

- `views/settings.js` crée l’hôte `.island-library-view.island-settings-view` à sa taille finale (680 × 524 au plus, `contain: strict`), puis monte React **après** le ressort de la capsule (`capsuleSettled`).
- `src/settings/mount.jsx` attache un shadow DOM, y adopte la feuille du SDK Liquid Glass et celle des Réglages (`?inline`, analysées une fois), et rend `App`. Les menus du SDK sont portés dans la racine de leur scène, donc restent dans le shadow DOM et dans la capsule.
- Le code (React + SDK, ~150 Ko gzip) est téléchargé au repos après le lancement (`warmSettingsView`), ou à la première ouverture.
- Un nouveau rendu de l’Island (réglage appliqué via `config-changed`, thème) garde la vue React en place.
- La scène de verre de l’Island est libérée dans ce mode : une seule scène Liquid Glass active à la fois.

## Hauteur selon le contenu

Bibliothèque, Historique et Réglages demandent à l’Island la hauteur de leur contenu (`fitPanel`, `src/island/dynamic-island/views/library.js`), bornée par mode : Bibliothèque 280–496, Historique 260–452, Réglages 380–524. La vue (`contain: strict`) prend sa taille d’un coup, la capsule la suit avec son ressort, centrée comme à l’ouverture. La dernière hauteur est retenue par mode : une réouverture part directement de la bonne taille (la Bibliothèque la calcule aussi pendant sa préparation au repos).

- Bibliothèque et Historique : mesure après chaque rendu de la liste (`panel.fit`), sauf pendant une recherche.
- Réglages : mesure à l’ouverture et au changement de page seulement ; déplier une option fait défiler la page au lieu de déplacer la capsule sous le pointeur.

## Points d’attention

- **Taille** : 680 × 524 est le maximum qui laisse le halo s’estomper avant le bord de la fenêtre de 720 × 600 (élargie de 620 à 720 pour les Réglages). La fenêtre native n’est jamais redimensionnée pendant l’usage ; les positions enregistrées par les versions à 620 px sont décalées une fois au chargement (`layout::adapt_to_width`) pour que la pilule ne bouge pas.
- **Échelle** : la taille de l’Island (65–150 %) zoome toute la fenêtre, Réglages compris. D’où des boutons − / + plutôt qu’un curseur qui glisserait sous le pointeur.
- **Dialogues Windows** (importer, exporter) : `state/busy.js` déclare la vue occupée ; la perte de focus ne la replie pas. Échap et ✕ ferment quand même (`collapseIsland({ force: true })`).
- **Placement** : « Déplacer » replie l’Island (mode édition) puis rouvre les Réglages sur Position quand le placement se termine (`_settingsAfterLayout`, `features/preferences.js`).
- **Pochette** : l’Island publie la pochette et ses couleurs dans `src/shared/cover-bus.js` ; les Réglages s’y abonnent (plus d’aller-retour par Rust).
- **Isolation** : aucune règle sur `html`, `body` ou `:root` ; l’accent est posé sur l’hôte (`--accent-raw`), pas de `-webkit-app-region` (qui déplacerait la fenêtre de l’Island).

## Tests

`tools/tests/settings.browser.cjs` (Edge, pont Tauri simulé, vraie Island) : ouverture depuis le menu, taille de la capsule, isolation des styles, réglage relayé sans remontage, débordement de chaque page, menu dans la capsule, Échap, − / +, export, sélecteur de fichier, raccourci et barre des tâches, placement puis retour sur Position, repli au clic extérieur. `NOLYS_SHOTS=dossier` enregistre une capture par page ; la capture `docs/screenshots/21-reglages-general.png` est régénérée à chaque passage.
