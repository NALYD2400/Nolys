# Replay & REC — revue et disposition documentaire

Relevé du 19 octobre 2026. Replay & REC est une extension locale du panneau Bibliothèque/Fichiers, en mode Operate. Le contrat de surface est `.impeccable/surfaces/src-island-dynamic-island-views-replay-js.md` ; le parcours et les limites natives sont décrits dans `nolys-replay-conception.md`.

## Existant examiné

La revue documentaire a lu `PRODUCT.md`, le contrat de surface, `src/library/panel.js`, `src/library/styles.css`, `src/replay/controller.js`, `src/replay/styles.css`, `src/island/dynamic-island/views/replay.js` et `src/island/styles/replay.css`. Ce dernier est le chemin réel de la feuille de l'Island.

Le panneau Replay appelle le même `createPanel` que la Bibliothèque et ajoute sa feuille au socle partagé : typographie Inter, accent issu du thème utilisateur, surfaces sombres translucides, en-tête et boutons ronds, actions en pilules, onglets en pastilles et focus visible. La capsule reprend le format du panneau partagé ; ses réglages défilent dans le corps. Le texte d'état, la progression du tampon et le compteur REC distinguent les états sans dépendre uniquement des couleurs. Le format compact observé reste une fenêtre de bureau Windows, sans cible mobile établie.

Cette extension conserve l'identité Liquid Glass cuivre/champagne et les préférences d'apparence de Nolys. Aucun nouveau monde visuel ni jeu de tokens global n'est nécessaire. `DESIGN.md` et `.impeccable/design.json` ne sont ni créés ni réécrits dans ce passage. La disposition documentaire est une addition factuelle à `PRODUCT.md`, les instructions et la portée de validation dans la conception, et le présent relevé local.

## Captures examinées et provenance

Les sept fichiers ci-dessous ont été inspectés visuellement. Ils sont produits par `tools/tests/replay.browser.cjs`, dans le navigateur Edge piloté par Playwright avec le vrai code UI et un pont Tauri simulé. Les données des clips, de la session, des appareils et de la télémétrie sont des fixtures. Le fond de page est imposé par le test. Ces fichiers locaux sont ignorés dans Git et servent de preuves de rendu, pas d'images produit distribuées.

| Capture dans `.impeccable/review/` | Évidence visuelle |
| --- | --- |
| `replay-idle-desktop.png` | Source, état prêt, durée et mémoire, action Activer, accès REC et réglages. |
| `replay-settings-desktop.png` | Profils et champs dans le langage du panneau ; contenu supplémentaire accessible par défilement. |
| `replay-recording-desktop.png` | État actif, compteur REC, sauvegarde et commandes de fin de session. |
| `replay-clips-desktop.png` | Onglet Clips sélectionné après stabilisation, ligne de clip et actions Lire/Afficher. |
| `replay-clips-empty-desktop.png` | Onglet Clips sélectionné et état vide avec retour à la capture. |
| `replay-error-desktop.png` | Message de source indisponible, bouton de fermeture et clips conservés. |
| `replay-idle-compact.png` | Présentation de bureau à fenêtre réduite, sans débordement horizontal observé dans le test. |

Les vues desktop sont capturées dans un viewport de 900 × 700 ; le format compact utilise 640 × 600. La mention « DXGI · GPU direct » et les valeurs 120 FPS visibles dans certaines fixtures sont injectées par le test. Elles ne démontrent ni un chemin natif sans copie, ni cette cadence, ni l'accès effectif au microphone.

## Verdict de finition reçu

Le reviewer a rendu **ship** après résolution de deux P2 :

- Le bouton de fermeture du message possède désormais le nom accessible explicite **Fermer le message**, même quand son libellé visuel est masqué.
- La fixture Clips attend la stabilisation et vérifie l'onglet sélectionné ainsi que son contenu avant la capture ; la preuve de liste vide est conservée séparément.

Le détecteur a renvoyé `[]`. Le verdict est limité à ces deux corrections et à leur preuve UI ; il ne vaut pas certification d'accessibilité complète, revue exhaustive du module ou autorisation générale de diffusion native. Le documenter consigne ce verdict reçu sans l'élargir.

## Portée native distincte

Sur l'hôte AMD RX 7800 XT, les essais d'encodage, d'export replay et REC et de décodage ont réussi sans audio, puis avec audio système AAC. Les essais courts à 60 FPS configurés ont ensuite couvert le son système plus microphone séparés ; une fenêtre de test WGC en arrière-plan en H.264 sans audio puis HEVC avec deux pistes AAC ; et l'écran en H.264 avec PC et micro mixés sur une piste AAC. Chaque parcours a produit replay et REC, décodé toutes les pistes et vérifié le nombre de pistes audio. Les derniers essais ont aussi contrôlé une première image vidéo non noire par décodage brut en 32 × 32. Cette fenêtre de test ne prouve pas la compatibilité avec chaque jeu.

Rust fournit l'audio PCM par Matroska horodaté en blocs de 10 ms, silence inclus, depuis une origine temporelle partagée avec la vidéo. Ces essais ne mesurent ni cadence soutenue ni synchronisation audio prolongée. Le chemin constaté utilise l'encodage matériel avec transfert de compatibilité. Aucune mesure de zéro copie ou d'économie CPU n'est disponible. Multi-GPU, plein écran exclusif, HDR et charge prolongée restent à valider.

Les 41 tests JavaScript et les deux suites navigateur (Replay et menus existants) ont réussi. La compilation UI a réussi avec les avertissements `host-context` existants. La suite Rust complète a réussi : 38 tests réussis et 3 tests matériels ignorés par défaut ; les parcours natifs Replay ont été exécutés séparément. La compilation de l'exécutable applicatif en profil de développement a réussi. Le runner natif `tools/tests/replay-native.ps1` est opt-in, utilise des captures temporaires et crée sa fenêtre de test sans l'activer ; sa commande est documentée dans la conception.

Le service Rust possède sessions, WASAPI, tampon compressé et travaux d'export ; FFmpeg est le composant natif externe de capture et de codec. `npm run prepare:replay` prépare le binaire local ignoré dans Git. Les résultats natifs, leur préparation et les validations encore ouvertes restent documentés dans la conception, séparément des captures du navigateur.

## Simplification de Replay et Fichiers — 19 octobre 2026

L’état précédent est sauvegardé dans le commit `c5ae460`. La demande utilisateur concerne la surcharge d’information dans Replay et Fichiers, avec maintien du langage des autres modules. Capture conserve source, état, durée et commandes ; les diagnostics se déplacent dans les réglages, les informations répétées disparaissent et une confirmation courte donne accès aux Clips. Dans Fichiers, Activité reçoit les résultats et la progression ; les actions de conversion, dimensions, copie, export, affichage et glisser sortant restent accessibles. La liste d’une sélection multiple et les informations de conversion se déplient à la demande.

Les captures locales `replay-clean-saved.png` et `files-clean-{empty,convert,activity,error,compact}.png`, ainsi que les captures Replay régénérées, utilisent le vrai frontend avec un pont Tauri simulé. Elles ne prouvent pas une nouvelle capture native. Le test navigateur Fichiers vérifie les opérations déplacées, le passage automatique à Activité après un démarrage réussi, le maintien de la sélection après erreur et l’affichage compact. La suite Replay vérifie aussi la confirmation courte et l’absence de défilement en Capture. Les deux suites et les 41 tests JavaScript réussissent ; la compilation UI réussit avec les avertissements `host-context` préexistants.

La revue indépendante de cette simplification conclut « ship » sans correction matérielle demandée après inspection de huit captures et du diff. Ce verdict concerne l’agencement et les parcours déplacés, sans étendre la validation du moteur natif ou du chrono.

## Lecteur intégré et suppression de clips — 19 octobre 2026

À la demande suivante de l’utilisateur, le bandeau « Replay enregistré / Voir le clip » et la barre de tampon sont retirés. Le compteur de durée est conservé. La liste Clips reçoit une suppression et sa commande Lire ouvre un lecteur intégré dans une capsule plus large, avec retour par flèche ou Échap. Les erreurs de lecture proposent un lecteur externe. Les captures `replay-player-desktop.png` et `replay-player-compact.png` utilisent une vidéo H.264/AAC synthétique ; elles montrent les contrôles natifs et le respect de la fenêtre.

La mise à la corbeille est testée nativement sur un fichier factice unique puis restauré et vérifié intact. Les tests Rust couvrent la préservation de l’historique en cas d’échec et la suppression ciblée ; le store UI refuse les snapshots anciens après suppression. La suite Rust de bibliothèque compte 42 réussites et quatre tests matériels ignorés par défaut, dont le test corbeille exécuté séparément. Les 42 tests JavaScript passent. La revue visuelle indépendante des quatre captures conclut « ship », sans correction demandée pour cet ajout.

## Liste de clips ajustée et renommage — 19 octobre 2026

La hauteur du panneau suit désormais son contenu avec un minimum de 180 px et un maximum de 536 px : un seul clip occupe moins de 240 px dans le test navigateur, tandis qu’une liste de douze clips atteint le plafond et défile. Le crayon ouvre une saisie dans la ligne, validée par Entrée ou la coche et annulée par Échap ou la croix. Les mises à jour de capture conservent le champ, son focus et le texte saisi. Les captures `replay-clips-desktop.png` et `replay-rename-{desktop,compact}.png` montrent ces états dans le vrai frontend avec un pont natif simulé.

Le renommage natif conserve le dossier, l’extension et l’identifiant du clip ; `MoveFileW` ne remplace pas un fichier existant. Trois tests Rust sur fichiers temporaires vérifient la conservation des octets et de l’historique après redémarrage, les noms invalides et collisions, puis le retour au nom initial si l’historique ne peut pas être enregistré. Les cinq tests ciblés de gestion des clips et les sept tests du store JavaScript passent, ainsi que la suite navigateur Replay étendue et la compilation UI. L’application locale a été reconstruite et relancée avec la nouvelle commande.
