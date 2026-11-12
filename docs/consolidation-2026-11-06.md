# Consolidation de Nolys — 6 novembre 2026

L'utilisateur a confié la réalisation de la consolidation proposée après l'avis produit : fiabilité des interactions, essais Windows, mesures de performance, découverte des fonctions principales et lisibilité sur les fonds chargés. L'identité Orbite et les icônes nacrées rétablies restent la référence visuelle. Les corrections locales de l'audit précédent sont conservées.

## Critères de fin

- [x] Interactions : les retours immédiats, ouvertures rapides, notifications et changements de placement n'appliquent plus d'état devenu obsolète ; tests de régression et parcours réels du frontend.
- [x] Windows : géométrie testée sur les écrans disponibles, modèles à DPI différents et changement d'écran/disponibilité ; scénarios de périphérique/veille couverts au niveau possible sans modifier la configuration du bureau de l'utilisateur. Les essais physiques non réalisables sont nommés séparément.
- [x] Performance : outil reproductible et mesures du processus natif **et de ses descendants WebView2**, avec CPU, mémoire et GPU lorsque les compteurs sont disponibles ; repos, musique, vues ouvertes et économie ; observation prolongée de 35,6 minutes, arrêtée à la demande de finalisation de l'utilisateur, et limites documentées.
- [x] Découverte : accès aux usages principaux et au guide depuis les réglages ; premier usage compréhensible, sans modifier les menus personnalisés existants.
- [x] Lisibilité : texte et commandes vérifiés sur fonds sombres, clairs et chargés, aux tailles proposées, avec capture avant/après des changements visuels nécessaires.

Un contrôle vert ne prouve que le scénario exécuté. Les performances d'une WebView de navigateur simulée ne sont pas présentées comme celles de l'application Windows. La publication d'un installateur ne fait pas partie de cette phase de consolidation.

## État initial constaté

- Base du dépôt : `36f5309`, nombreuses corrections locales non publiées déjà présentes.
- Le guide `GettingStarted` existe : il faudra le rendre plus utile, sans créer de parcours concurrent.
- La navigation possède un jeton d'annulation et une seule transition en attente. `returnToMusicIdle` ne les invalide pas, alors que Fichiers et le placement possèdent chacun une annulation manuelle similaire.
- Les performances prolongées et les essais matériels manquent dans le rapport de l'audit précédent.

## Preuves

Les commandes, journaux, mesures et résultats seront ajoutés au fur et à mesure ; aucune case n'est validée sur la seule base d'une intention.

### Interactions et Replay

- Annulation centralisée des transitions : retour immédiat au repos, Fichiers et entrée en placement invalident le rendu différé et l'ouverture suivante. Régression notification/navigation passée ; 92 tests JavaScript et 93 tests Rust passés, 7 tests matériels/opt-in ignorés.
- Les listes Replay et les menus de la bibliothèque convertissent les rectangles du navigateur vers le repère local du panneau zoomé. Les flèches et Home/End font défiler la liste seule. Un observateur de taille partagé recale la liste quand son ancrage change.
- La réponse tardive du stockage et le chargement des sources mettent à jour les champs concernés sans remplacer la vue. Une liste ouverte suit aussi le réordonnancement des sources en conservant la valeur pointée, au lieu de réutiliser un index devenu celui d'une autre fenêtre.
- Vérification Windows embarquée : 36 listes de Réglages à 65, 100, 125 et 150 %, erreur maximale d'alignement 0 px. Journal `replay-menu-native-focused.log`, résultat `diagnostic-SUtcgn/replay-selects.json`.
- Les clips ont des contrôles intégrés dans le repère de la vidéo : progression, lecture/pause, son, plein écran et navigation clavier. Leurs écouteurs sont libérés à la fermeture. Les contrôles et le message d'erreur occupent des zones distinctes.
- Parcours navigateur : clic à 25/75 % et Home/End à 65/100/150 %, son, lecture/pause, plein écran, erreur de codec et retour aux clips. Parcours Windows : six clics aux mêmes fractions/échelles, une seule barre, aucune commande native superposée, écart temporel relatif maximal 1,67 point de pourcentage sur le clip synthétique de 3 s. Résultat `diagnostic-Zsj5cH/clip-player.json` ; aucune capture du bureau ou source audio réelle.

### Icônes et découverte

- Capsule Replay/REC et minuteur, satellites Replay et micro, en-tête du mélangeur : symboles nacrés du catalogue partagé, sans cadre autour des petits symboles. Compteurs, barres de voix, confirmation de coupure et point rouge REC restent fonctionnels.
- Le logo Nolys utilisé comme pochette n'hérite plus du remplissage noir et des 16 px de retrait des icônes de services. Le parcours `interface` vérifie l'image et l'absence de padding/fond noir.
- Le guide existant donne accès à Position, Menus et Raccourcis. Le focus rejoint le titre de la destination ; le guide reste dans À propos après « Compris ». Les menus personnalisés ne sont pas migrés.
- Vérification visuelle groupée : `.impeccable/review/consolidation/` et `adaptive-interface-2026-11-01/local-logo-full.png`. Description de Réglages sur fond blanc : contraste échantillonné minimal passé de 4,39:1 à 6,06:1 après augmentation du texte secondaire. Le titre de groupe extérieur aux cartes emploie désormais le texte principal pour rester lisible sur le haut clair. Ce contrôle ciblé ne constitue pas une certification de tous les thèmes personnalisés.

### Windows

- Deux moniteurs réellement disponibles, tous deux à facteur DPI 1 : 12 placements (coins opposés, 65/100/150 %) et 36 ouvertures Musique/Menu/Réglages. Chaque vue tient à l'écran ; le retour compact retrouve son ancrage. Rectangle natif lu par `GetWindowRect` avec contexte DPI physique, sans élargir les permissions de l'application.
- L'identifiant d'un écran disparu est simulé : repli sur un moniteur disponible et pilule visible. Résultat `diagnostic-iADKk1/windows-layout.json`.
- Les modèles Rust couvrent aussi des zones de travail à coordonnées négatives, petits écrans et les transformations d'échelle. Le test minuteur navigateur bloque le rendu 3 s et vérifie la reprise et l'alarme unique.
- Limites matérielles : aucun DPI Windows modifié, aucun écran/périphérique débranché, aucune mise en veille réelle imposée au poste. L'ouverture des vraies entrées/sorties micro reste opt-in et n'a pas été exécutée. Le mécanisme de réouverture/fallback natif est inspecté, sans prétendre reproduire les interruptions physiques.

### Performance — mesure finalisée à la demande de l'utilisateur

Le script `tools/diagnostics/profile-native.mjs` mesure le processus Rust et tous ses descendants WebView2 via `process-metrics.ps1` : CPU cumulée par identité de processus, mémoire privée, working set et compteurs GPU 3D disponibles. Il conserve les échantillons bruts et les phases séparées, puis produit un résumé. Le working set additionné inclut des pages partagées ; les moteurs 3D ne couvrent pas la composition DWM.

Session démarrée sur le binaire debug embarqué `consolidation-modules.exe`, données isolées `diagnostic-Ti7h4Z`. WAV silencieux local, volume nul ; aucune commande média n'est envoyée à un lecteur externe. Repos, musique compacte/dépliée, Réglages, Contrôle, économie, puis une heure de musique compacte et retour au repos. Les données média affichées sont contrôlées ; la détection native reste exécutée. Ce binaire précède les derniers contrôles de clips et corrections de contraste ; ce n'est ni un benchmark de version publiée ni une mesure de capture réelle.

Cette première session s'est arrêtée avant sa fin pendant l'interruption signalée par l'utilisateur : processus et port de diagnostic absents, dernier échantillon à 15 h 43. Le processus avait été observé vivant à 15 h 41. Aucun résultat prolongé complet n'en est déduit ; les données brutes sont conservées.

À 15 h 51, nouvelle session sur `consolidation-final.exe`, données `diagnostic-96Uck6`, processus de pilotage 27920 lancé sans fenêtre et indépendamment de la session de commande. Les mesures et un fichier `progress.json` sont enregistrés périodiquement. La protection des commandes média et le contrôle des données présentées sont désormais posés sur le lecteur : les propriétés `invoke` du pont Tauri sont gelées, ce qui empêchait de les remplacer pour la première fixture. Cette correction concerne uniquement l'outil de mesure.

Cette seconde tentative a montré un état déplié pendant la phase nommée compacte ; elle est invalidée et arrêtée sur le PID de diagnostic vérifié. À 15 h 53, session `consolidation-profile-verified.log`, pilote 25540 : entrée compacte explicite après démarrage de la lecture, interactions manuelles neutralisées dans cette fenêtre de test, vérification du mode/dépliement/lecture à chaque point de contrôle. Tout état divergent arrête la mesure au lieu d'être agrégé sous un mauvais libellé. Les tentatives précédentes sont conservées, sans les présenter comme des résultats valides.

À 15 h 59, contrôle indépendant : le collecteur PowerShell n'existait plus et son dernier échantillon datait de 15 h 57, alors que le pilote continuait de collecter le tas JavaScript. Cette tentative est également invalidée. Le collecteur tolère désormais la terminaison d'un processus entre son énumération et la lecture de ses propriétés ; le pilote arrête immédiatement une mesure dont le collecteur est terminé ou périmé, et écrit sa cause d'échec. Nouvelle session à 16 h 01 : pilote 20180, `consolidation-profile-observed.log`, données `diagnostic-eRd5Kd`. Les causes éventuelles de sortie sont conservées dans `collector-error.log` et `failure.json` plutôt que perdues pendant une interruption CDP.

Le générateur `report-profile.py` est vérifié sur une fixture synthétique séparée ; ses valeurs ne sont pas des mesures de Nolys. Il refuse un jeu de mesures incomplet ou une phase prolongée de moins d'une heure. L'environnement matplotlib de cette analyse est isolé dans `.impeccable/runtime/profile-analysis/.venv`, avec dépendances figées dans son `requirements.txt` ; aucune dépendance de l'application n'est modifiée.

Après la demande explicite « fait le final », la collecte est arrêtée sans attendre l'heure optionnelle. Le jeu retenu comporte 1 017 échantillons et sept phases : repos, musique compacte/dépliée, Réglages, Contrôle, économie et 35,6 minutes d'observation compacte. Les processus de test sont fermés. Le retour final au repos n'est pas mesuré ; aucune heure complète n'est revendiquée.

Rapport conservé dans [diagnostics/performance-2026-11-06.md](diagnostics/performance-2026-11-06.md), avec la courbe CPU/mémoire. Au repos initial : 0,19 % CPU machine et 205,6 Mio privés en moyenne. Sur la phase prolongée : 1,59 % CPU machine et 424,8 Mio privés en moyenne pour le processus natif et ses descendants ; médianes des dix premières/dernières minutes 422,2 et 427,3 Mio (+5,1 Mio). Le tas JavaScript reste entre 3,3 et 4,3 Mio. Cela ne montre pas d'emballement rapide sur cette observation et ne prouve pas l'absence de fuite sur tous les parcours.

La consommation active reste un point d'amélioration : le court échantillon en économie descend à 0,07 % CPU machine, mais la session n'est pas un benchmark contrôlé entre deux versions. Les niveaux audio système des autres applications peuvent alimenter le visualiseur même avec un WAV de test silencieux. Les compteurs GPU 3D sont disponibles mais arrondis à zéro ; ils ne prouvent pas une consommation graphique nulle et excluent DWM. L'augmentation de mémoire au chargement des vues ne doit pas être assimilée à une fuite sans autre preuve.

### Journaux des parcours

Dans `.impeccable/runtime/` : `module-status-browser.log`, `consolidation-guide-browser.log`, `consolidation-final-frontend.log`, `replay-live-sources.log`, `windows-layout-native.log`, `clip-player-native.log`, `consolidation-all-unit.log`, `consolidation-rust.log`. Les échecs initiaux restent conservés ; les journaux « after » ou explicitement réussis décrivent les corrections vérifiées.

Dernier passage groupé des 13 parcours : `consolidation-regression.log`, tous réussis. Compilation embarquée finale : `consolidation-final-native-build.log`. Sur ce binaire, `replay-selects-native-final.log` confirme 36 listes alignées à 0 px ; `clip-player-native-final.log` confirme les six recherches temporelles et le plein écran, avec retour à la même position. Le résultat final est `diagnostic-Kd2n3U/clip-player.json`. Le clavier Home/End, le volume, la sortie du plein écran et la région de clic étendue sont aussi vérifiés dans le parcours navigateur. L'observation native du plein écran nécessite une fenêtre effectivement focalisée ; l'émulation du focus seule n'accorde pas cette autorisation WebView2.

## État final

Les cinq volets de consolidation sont traités au périmètre vérifiable ici, avec les limites matérielles et la durée réelle des mesures précisées. Les modifications sont dans le worktree ; cette phase n'a pas publié d'installateur ni de release. Les parcours matériels réels (veille, débranchement, DPI Windows mixtes, longues captures audio) restent distincts des contrôles exécutés et ne sont pas déclarés réussis.
