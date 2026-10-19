# Nolys

<!-- impeccable:product-schema 1 -->

## Platform

web

Interface WebView2 dans une application de bureau Windows ; aucune cible mobile établie.

## Product Purpose

Nolys propose une capsule de bureau qui donne accès à la musique, aux commandes audio, aux notifications et aux contrôles Windows. Le module Fichiers en cours d'implémentation permet aussi de déposer des fichiers et de recevoir des actions locales adaptées, en prenant Tangerine comme référence d'interaction.

## Operating Context

- Application Windows, fenêtre transparente et généralement au premier plan, avec clic traversant autour de la capsule.
- Island déplaçable, mise à l'échelle et placement multi-écran configurables.
- Les vues Réglages et Bibliothèque vivent dans l'Island.
- Le module Fichiers doit cohabiter avec la lecture musicale, les notifications, le mode placement, le mode économie et le masquage en plein écran ; la matrice complète de coexistence reste à vérifier.

## Capabilities and Constraints

État observé dans le dépôt le 18 octobre 2026 : Tauri/Rust ; Island en JavaScript et CSS ; Réglages en React ; bibliothèque musicale locale. Les versions verrouillées comprennent Tauri 2.12.1, Wry 0.57.0 et image 0.25.10.

Une première implémentation locale du module Fichiers est présente : conversions d'images statiques JPG/PNG/WebP/BMP, redimensionnement proportionnel sans agrandissement, qualité/compression JPG et copie de fichiers ordinaires vers des exports durables. Le service préserve les originaux, publie les sorties sans écrasement et gère file, historique, annulation et état interrompu au redémarrage. L'accès passe par dépôt natif, sélecteur, menu ou Ctrl+Alt+F ; presse-papiers Windows et adaptateur de glisser sortant sont intégrés.

Le service libère les anciennes sélections sans perdre les sources des travaux en attente et poursuit la file après une panique de codec interceptée. À la fermeture, il refuse les nouvelles demandes, désactive les dépôts entrants, demande l'annulation et attend jusqu'à trois secondes le drainage du worker fichiers ; les travaux encore actifs sont signalés interrompus au redémarrage. Ce délai concerne le worker et n'est pas une mesure du temps réel de fermeture de toute l'application. Le moteur image borne la lecture source à 128 Mio avant création du décodeur, refuse les JPEG CMJN/YCCK et les profils ICC non RVB ou incompatibles ; seuls les profils RVB compatibles, avec en-tête contrôlé et taille au plus 4 Mio, sont conservés. Une image RGBA entièrement opaque peut devenir JPG sans choix de fond ; la transparence réelle exige toujours ce choix. Le corpus couleur complet reste à valider.

Le 18 octobre 2026, un dépôt réel Explorateur → capsule compacte a produit une sortie PNG utilisable ; le collage d'un résultat Nolys dans l'Explorateur a été vérifié par hash. Le bouton Afficher a également ouvert le dossier et sélectionné le PNG exporté (427 octets). Après l'échec d'un geste automatique trop bref, l'utilisateur a réussi le glisser sortant vers l'Explorateur avec appui maintenu : la trace OLE indique une copie réussie et le fichier déposé est identique à l'export par SHA-256 ; l'original demeure intact. Ce parcours précis est validé. Les autres applications cibles, l'annulation, la sécurité des dépôts hors cible, le survol prolongé, les DPI et les performances avec audio actif restent à vérifier. Les images animées et profondeurs non prises en charge sont refusées explicitement ; aucune transformation PDF, audio, vidéo ou archive n'est disponible. Les préférences Fichiers, la rétention configurable de l'historique et la reprise ciblée des échecs restent à construire. Le module n'est pas prêt pour une diffusion complète.

La conception historique, la feuille de route et l'addendum daté distinguant capacités implémentées, preuves et critères restant ouverts sont conservés dans `docs/nolys-fichiers-conception.md`.

## Brand Commitments

Nom Nolys, logo N existant et identité Liquid Glass cuivre/champagne documentée dans le dépôt. Les choix d'apparence enregistrés par l'utilisateur restent prioritaires. Fichiers réutilise les composants, le verre, le thème et les animations de l'application existante. La référence Tangerine porte sur le traitement des fichiers au cours d'un glisser-déposer.

## Evidence on Hand

- Demande de l'utilisateur dans cette conversation : concevoir l'intégration de Tangerine au dépôt dans l'Island ; choix détaillés délégués à l'agent après examen de la référence.
- `README.md`, `branding/README.md`, `src/shared/theme-look.js`.
- Code des vues et du cœur natif dans `src/` et `src-tauri/src/`.
- Captures de développement dans `docs/screenshots/`, dont `21-reglages-general.png` ; elles illustrent l'existant et ne valident pas une fonctionnalité de dépôt.
- Capture réelle du panneau Fichiers avec résultat : `.impeccable/review/files-empty-results.png` (720 × 570) ; elle atteste l'intégration visuelle observée, sans valider toute la matrice native.
- Capture réelle du menu : `.impeccable/review/files-menu.png` ; le bouton Fichiers réutilise les tuiles existantes après correction du fond blanc natif du bouton.
- Essais Windows du 18 octobre 2026 : dépôt entrant, conversion et collage Explorateur avec original intact ; détails et limites dans l'addendum de conception.
- Dernières vérifications : compilation UI réussie, 29 tests JavaScript réussis ; 33 tests Rust dont 31 réussis et 2 microphone ignorés. Ces vérifications ne ferment pas les essais natifs encore ouverts.

## Open Decisions

- Audience au-delà de l'utilisateur du projet, modèle commercial et exigences de diffusion non établis.
- La proposition est partiellement implémentée dans le dépôt ; la validation native complète, les extensions de moteurs et la préparation d'une livraison restent ouvertes. Les étapes A et C ne sont pas déclarées achevées.
- La réconciliation du journal de publication après crash, les préférences/rétention et les mesures de fermeture, DPI et coexistence audio restent à approfondir. L'instance de développement isolée et ses commandes de diagnostic ne constituent pas des fonctions de production.
