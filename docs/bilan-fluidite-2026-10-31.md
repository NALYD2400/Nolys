# Corrections de fluidité de Nolys — 31 octobre 2026

Les six constats prioritaires de [l'audit](audit-fluidite-2026-10-31.md) ont été traités dans le code. L'identité cuivre, les matériaux et les ressorts de Nolys sont conservés. Les modifications Replay déjà présentes au début de la passe, notamment dans `audio.rs`, `engine.rs`, `styles.css` et leur suite navigateur, ont été conservées.

## Changements

| Avant | Après |
|---|---|
| Un comparateur de tri recréait ses options locales à chaque comparaison ; le texte de recherche était normalisé à chaque frappe. | Un `Intl.Collator` partagé et un cache faible de recherche, invalidé sur changement de métadonnées. Les playlists et la file conservent leur ordre. |
| « Afficher plus » reconstruisait une liste croissante, jusqu'à 1 500 lignes après neuf clics. | Pages fixes de 150 titres, commandes Précédent/Suivant toujours visibles, numéro de page, focus clavier conservé, page restaurée à la réouverture et recherche ramenée au début. La sélection de toute la page est nommée pour les lecteurs d'écran. |
| Une interaction pendant les 900 premières millisecondes pouvait rejouer la cascade des lignes, avec une attente visuellement vide. | Recherche, pagination ou nouvelle sélection interrompent la cascade d'ouverture ; les lignes deviennent immédiatement lisibles. L'animation initiale reste présente. |
| En état masqué, le visualiseur continuait ses demandes de niveau audio. | Planification et transition d'amplitude arrêtées en état masqué ; lecture fraîche du niveau et reprise au retour, sans toucher aux captures Replay. |
| Le mouvement normal de taille durait 620 ms, avec 90 ms avant le changement de vue puis une attente d'un tiers du ressort. | Taille animée sur 420 ms, fondu initial de 60 ms et avance du contenu au premier quart du ressort. Le mode vivant conserve son ressort, raccourci à 560 ms. Les Réglages attendent encore la fin du redimensionnement pour éviter de monter React au milieu du ressort. |
| Le réglage Windows de réduction des mouvements ne pilotait pas le mode par défaut. | Choix « Windows » par défaut, suivi des changements système à chaud et respect des choix explicites Sobre/Fluide/Vivante déjà enregistrés. Les styles de la bibliothèque suivent le mode résolu, sans figer globalement les indicateurs utiles. |
| Chaque statut périodique Replay déclenchait une lecture de l'instantané et du catalogue entier. | Télémétrie native légère et révision de catalogue. Une lecture complète seulement au changement de catalogue, avec regroupement des événements concurrents et protection contre les événements périmés. Les modifications, renommages et réindexations font avancer la révision. |
| Replay comparait les clips avec une sérialisation complète et réécrivait des textes, icônes et valeurs de sélecteurs inchangés. | Références stables de catalogue, résultat de pagination mémorisé et mises à jour ciblées des textes/icônes/sélecteurs. Les modifications non enregistrées et la vidéo en lecture restent conservées. |
| Un échec de lecture du volume devenait 70 % ; les erreurs d'écriture et les sessions absentes pouvaient être annoncées comme des réussites. | Valeur absente explicite, résultats COM vérifiés et erreurs remontées par Tauri. Le curseur affiche l'indisponibilité, le message explique l'échec et les sessions sont relues après une commande refusée. Le zéro réel reste une valeur valide. |

Sources principales : `src/library/`, `src/replay/`, `src/services/AudioVisualizerService.js`, `src/island/dynamic-island/features/`, `src/island/styles/motion.css`, `src/settings/state/`, `src-tauri/src/platform/audio.rs`, `src-tauri/src/commands/audio.rs` et `src-tauri/src/replay/`.

## Mesures avant et après

Build Vite de production, Edge 156, frontend réel avec pont Windows simulé, même fixture de 3 000 titres non triés. Ce sont des mesures locales ponctuelles, pas une garantie sur tous les ordinateurs.

| Scénario | Avant | Après |
|---|---:|---:|
| Recherche « M » puis « Mo », gestionnaire JavaScript synchrone | Environ 90 ms | Environ 10–13 ms |
| Extension de liste / changement de page, gestionnaire synchrone | Environ 92–142 ms | Environ 12–14 ms |
| Lignes présentes après neuf changements | 1 500 | 150 |
| Éléments dans la racine de la bibliothèque après neuf changements | Environ 21 090 | Environ 2 193 |
| Premier contenu du menu | Environ 300–315 ms | Environ 170–177 ms |
| Réglages disponibles | Environ 714–718 ms | Environ 485 ms ; suite de parcours indépendante à 513 ms |
| Appels de niveau audio durant 2,2 s en état masqué | 23–25 | 0 |
| Mutations `childList` pour trois statuts Replay inchangés | 27 | 0 |
| Télémétrie native avec 10 000 clips | Lecture complète du catalogue à chaque statut, environ 1,32 Mo pour la fixture | Événement inférieur à 2 Ko, sans catalogue ; borne vérifiée par test Rust |

Le changement de liste est désormais une pagination et non une accumulation : la comparaison porte sur le coût des interactions et le volume d'interface nécessaire pour parcourir la collection. Les mesures après correction ont précédé le dernier ajustement de cascade ; celui-ci a ensuite été confirmé visuellement et par le test d'opacité des nouvelles lignes.

La sonde de performance lit la classe de mouvement immédiatement après une émulation de préférence système ; ce champ instantané peut précéder le traitement de l'événement `change`. La preuve de suivi Windows est donc le test navigateur dédié, qui attend le mode résolu et vérifie aussi le respect du choix explicite, plutôt que ce champ instantané.

## Validation

- **Validation finale `npm run check` réussie : 80 tests JavaScript, build Vite, 88 tests Rust réussis ; 6 tests matériels ou spécifiques restent ignorés par défaut.**
- **Huit suites navigateur réussies** : accessibilité, Fichiers, fluidité, Bibliothèque, menus, Replay, Réglages et minuteurs. Les suites Réglages/minuteurs ont été reprises séparément après adaptation du contrôle de récupération au nouveau défaut « Windows » ; le parcours fluidité a été rejoué après la correction de cascade.
- Le nouveau parcours vérifie 3 000 titres, les pages bornées, la recherche, le focus, la réouverture, l'arrêt/reprise du visualiseur, les changements de préférence système et leur remplacement explicite, le catalogue Replay différentiel, les nœuds DOM conservés et les erreurs audio visibles.
- Les tests du modèle vérifient les classements numériques/accentués, les métadonnées modifiées, l'ordre des playlists/files, les pages après suppression, les événements Replay concurrents et les réglages non enregistrés.
- Le nouveau test Rust confirme que la télémétrie exclut le catalogue/configuration, reste petite avec 10 000 clips et suit les révisions après renommage/suppression des fixtures.
- Le test de notification attend désormais le véritable début de fermeture au lieu d'un instant absolu lié à l'ancienne durée d'ouverture. Le test de récupération compare le choix de mouvement effectif : absence de clé et valeur `system` sont équivalentes ; les échecs de transaction restent contrôlés par égalité exacte du stockage.
- Deux passes visuelles au format natif de 720 × 600 : défaut de cascade trouvé dans la première et corrigé ; confirmation des lignes et de la pagination dans la seconde. Les quatre choix de mouvement tiennent sans débordement horizontal.
- `git diff --check` réussi. Le détecteur ciblé ne relève que des conseils sur les ressorts, conservés intentionnellement ; il ne certifie pas la qualité ni les contrastes.

Les dépendances n'ont pas changé ; l'audit npm/RustSec exécuté pendant le diagnostic reste la référence, avec ses avertissements documentés.

## Captures de confirmation

Bibliothèque avec 3 000 titres, page 2, 150 lignes montées :

![Bibliothèque paginée](../.impeccable/review/corrections-fluidite-2026-10-31/library-pages.png)

Choix de mouvement Windows dans les Réglages :

![Réglage des animations](../.impeccable/review/corrections-fluidite-2026-10-31/appearance-motion.png)

Ces captures sont des preuves locales de développement, ignorées dans Git.

## Limites de la validation

Le renderer testé utilise le vrai frontend ; les périphériques Windows sont simulés dans les parcours navigateur. Les tests Rust couvrent les modèles et fixtures, mais ne remplacent pas les captures longues sur GPU, les débranchements physiques, la veille, les DPI mixtes ni l'installation/mise à jour signée. Aucun nouveau paquet de livraison n'est publié par cette passe.

Les profils CPU complets de l'application installée et les points de surveillance non démontrés comme bugs dans l'audit initial restent distincts. Aucun gain global de CPU, de batterie ou de FPS n'est annoncé à partir des seules mesures du renderer.

## Preuves locales reproductibles

- `.impeccable/runtime/corrections-fluidite-validation-finale-2026-10-31.log`
- `.impeccable/runtime/corrections-fluidite-browser-2026-10-31.log`
- `.impeccable/runtime/corrections-fluidite-browser-fin-2026-10-31.log`
- `.impeccable/runtime/corrections-fluidite-browser-confirmation-2026-10-31.log`
- `.impeccable/runtime/mesures-fluidite-apres-2026-10-31.json`
- `.impeccable/runtime/visuel-corrections-fluidite-2026-10-31.json`
- `.impeccable/runtime/avant-corrections-fluidite-2026-10-31.patch` : modifications déjà présentes avant les corrections, conservées comme point de comparaison local.
