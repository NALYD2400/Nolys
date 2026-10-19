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
