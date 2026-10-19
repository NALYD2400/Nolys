---
version: 1
slug: "src-island-dynamic-island-views-replay-js"
primary_target: "src/island/dynamic-island/views/replay.js"
related_targets: ["src/replay/controller.js","src/replay/styles.css"]
---

# Replay & REC — conception et validation

Extension du panneau de modules de Nolys, mode Operate. Le service Rust possède les sessions, l’audio WASAPI, le tampon compressé en RAM, les travaux d’export et les fichiers de récupération. FFmpeg est un composant natif externe pour DXGI/WGC, l’encodage GPU et le remuxage MP4. Ce n’est pas une implémentation des codecs entièrement en Rust.

## Direction contract

THESIS: sauvegarder ce qui vient de se passer en une action, puis retrouver la vidéo. La session de capture persiste quand le panneau est fermé.

OWN-WORLD: extension de la Bibliothèque et de Fichiers : capsule, thème utilisateur, typographie Inter existante, en-tête commun, boutons et focus du panneau partagé. Aucun changement d’identité visuelle.

STORY: choisir un écran ou une fenêtre de jeu, activer le replay, lire sa durée disponible, sauvegarder. REC utilise le même flux encodé. Les paramètres détaillés restent dans un onglet, les clips dans un autre.

FIRST VIEWPORT: titre sans sous-titre ; onglets Capture / Réglages / Clips ; source, état et durée disponible au centre ; action principale Sauvegarder / Activer, commande REC et arrêt par icône nommée. Aucun bandeau de succès ni barre de tampon, à la demande de l’utilisateur. Mémoire et encodeur réellement utilisés dans Réglages → Moteur vidéo et compatibilité ; raccourci dans l’infobulle de Sauvegarder. Clips donne accès à Lire, Afficher et Supprimer ; Lire agrandit la capsule et affiche une vidéo intégrée avec retour à la liste.

FORM: extension locale du panneau partagé ; chemin code-led, pas de nouvelle composition globale ni de comp générée. seed: none (extension locale sans tirage).

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Contrat du moteur

- Aucun démarrage de capture automatique, ni accès au micro sans activation explicite du réglage.
- Source résolue à nouveau au démarrage ; fenêtre identifiée par HWND et PID, écran associé à sa sortie DXGI, sans dépendre d’un simple ordre d’énumération.
- Capture d’un jeu via sa fenêtre Windows ou son écran. Aucun hook injecté dans le jeu ; compatibilité plein écran exclusif, DRM, HDR et anti-triche non garantie.
- Encodage matériel préféré ; aucun repli CPU implicite. Le transfert de compatibilité vers le GPU est distingué du chemin GPU direct.
- Fragments MP4 complets en RAM ; éviction par GOP et borne en octets. Un export partage les fragments par Arc. Sa mémoire épinglée peut porter les données compressées à environ deux fois le budget du tampon, en plus du moteur et de ses surfaces GPU.
- Sauvegarde sans réencodage. La dernière fraction de seconde encore en cours de multiplexage n’est pas incluse ; les bornes du replay suivent les images clés (intervalle visé de deux secondes).
- Réglages verrouillés pendant une session ; nouvelle configuration au prochain démarrage.
- WASAPI 48 kHz stéréo, silence inclus, source système et micro séparées ou mixées. Les appareils disparus et files saturées déclenchent une erreur visible.
- Enregistrement fragmenté dans un dossier de récupération ; publication du MP4 final sans écraser un fichier existant. Une erreur de disque n’est pas annoncée comme un succès.
- Les fichiers de récupération sont conservés si l’assemblage échoue. Pas de purge des vidéos de l’utilisateur.

## Validation à documenter

Tests du tampon, lecture BMFF bornée, réglages et concurrence UI ; compilation UI et Rust ; captures et exports réels sur le PC AMD ; lecture des sorties par un décodeur indépendant du muxeur ; audio système et micro lorsque disponibles ; état visuel au repos, actif, en erreur et pendant REC. Les essais multi-GPU, multi-écrans, jeux exclusifs, HDR, veille, débranchement audio et charge prolongée sont une matrice distincte. Aucun objectif « zéro bug » ou pourcentage de performance n’est annoncé sans preuve.
