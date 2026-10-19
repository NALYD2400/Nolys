# Replay & REC — conception et validation

Extension du panneau de modules de Nolys, mode Operate. Le service Rust possède les sessions, l’audio WASAPI, le tampon compressé en RAM, les travaux d’export et les fichiers de récupération. FFmpeg est un composant natif externe pour DXGI/WGC, l’encodage GPU et le remuxage MP4. Ce n’est pas une implémentation des codecs entièrement en Rust.

## Direction contract

THESIS: sauvegarder ce qui vient de se passer en une action, puis retrouver la vidéo. La session de capture persiste quand le panneau est fermé.

OWN-WORLD: extension de la Bibliothèque et de Fichiers : capsule, thème utilisateur, typographie Inter existante, en-tête commun, boutons et focus du panneau partagé. Aucun changement d’identité visuelle.

STORY: choisir un écran ou une fenêtre de jeu, activer le replay, lire sa durée disponible, sauvegarder. REC utilise le même flux encodé. Les paramètres détaillés restent dans un onglet, les clips dans un autre.

FIRST VIEWPORT: titre, onglets Capture / Réglages / Clips, source puis durée disponible. Sauvegarder / Activer reste l’action principale ; REC et arrêt restent accessibles. Le bandeau de succès et la barre de tampon sont retirés à la demande de l’utilisateur ; les erreurs restent visibles. Les diagnostics de mémoire et d’encodage vivent dans Réglages → Moteur vidéo et compatibilité ; le raccourci apparaît dans l’infobulle de Sauvegarder.

FORM: extension locale du panneau partagé ; chemin code-led, pas de nouvelle composition globale ni de comp générée. seed: none (extension locale sans tirage).

FINISH: revue et documentation locales dans `docs/nolys-replay-design-review.md`. Cette extension conserve le système visuel existant ; elle ne crée ni ne réécrit `DESIGN.md` ou `.impeccable/design.json`. Les captures de validation portent la provenance de leurs fixtures UI.

## Contrat du moteur

- Aucun démarrage de capture automatique, ni accès au micro sans activation explicite du réglage.
- Source résolue à nouveau au démarrage ; fenêtre identifiée par HWND et PID, écran associé à sa sortie DXGI, sans dépendre d’un simple ordre d’énumération.
- Capture d’un jeu via sa fenêtre Windows ou son écran. Aucun hook injecté dans le jeu ; compatibilité plein écran exclusif, DRM, HDR et anti-triche non garantie.
- Encodage matériel préféré ; aucun repli CPU implicite. Le transfert de compatibilité vers le GPU est distingué du chemin GPU direct.
- Fragments MP4 complets en RAM ; éviction par GOP et borne en octets. Un export partage les fragments par Arc. Sa mémoire épinglée peut porter les données compressées à environ deux fois le budget du tampon, en plus du moteur et de ses surfaces GPU.
- Sauvegarde sans réencodage. La dernière fraction de seconde encore en cours de multiplexage n’est pas incluse ; les bornes du replay suivent les images clés (intervalle demandé explicitement de deux secondes, images IDR forcées sur AMD). Le tampon vidéo ne dépasse pas la durée configurée : il retire le GOP précédent plutôt que d’allonger le replay. Sans nouvelle image clé, il vide les données expirées au lieu de conserver une durée excessive. Les paquets audio peuvent ajouter quelques millisecondes au conteneur MP4.
- Réglages verrouillés pendant une session ; nouvelle configuration au prochain démarrage.
- WASAPI 48 kHz stéréo, silence inclus, source système et micro séparées ou mixées. Les appareils disparus et files saturées déclenchent une erreur visible.
- Enregistrement fragmenté dans un dossier de récupération ; publication du MP4 final sans écraser un fichier existant. Une erreur de disque n’est pas annoncée comme un succès.
- Les fichiers de récupération sont conservés si l’assemblage échoue. Pas de purge des vidéos de l’utilisateur.

## Validation à documenter

Tests du tampon, lecture BMFF bornée, réglages et concurrence UI ; compilation UI et Rust ; captures et exports réels sur le PC AMD ; lecture des sorties par un décodeur indépendant du muxeur ; audio système et micro lorsque disponibles ; état visuel au repos, actif, en erreur et pendant REC. Les essais multi-GPU, multi-écrans, jeux exclusifs, HDR, veille, débranchement audio et charge prolongée sont une matrice distincte. Aucun objectif « zéro bug » ou pourcentage de performance n’est annoncé sans preuve.

## Utilisation

1. Ouvrir **Replay** depuis le menu de l'Island, puis choisir la source dans **Capture**. Dans **Réglages**, choisir le profil, l'audio et le dossier, puis **Enregistrer les réglages**. La capture doit être arrêtée pour modifier ces réglages ; le microphone nécessite une activation explicite.
2. Cliquer **Activer le replay**, attendre que la durée disponible augmente, puis **Sauvegarder**. Le tampon glisse en continu : une durée configurée de 60 secondes conserve jusqu’aux 60 dernières secondes, même si la session reste active pendant des heures. Le raccourci de sauvegarde apparaît au survol du bouton ; il se configure dans les réglages de raccourcis de Nolys. La limite mémoire et les images clés peuvent raccourcir la durée exportée d’environ un intervalle d’images clés.
3. Cliquer **Enregistrer** pour démarrer REC, puis **Terminer REC** pour publier la vidéo. REC n’est pas limité par la durée du replay : il continue jusqu’à son arrêt. Terminer REC laisse le tampon Replay actif. **Arrêter la capture** termine toute la session et finalise REC s’il est actif. Fermer le panneau laisse la capture active. Une bulle caméra, avec la même matière que le micro et le chrono, permet de rouvrir les commandes : elle apparaît uniquement quand l’Island est repliée, choisit un côté libre ou la file la plus courte sans chevaucher les autres bulles et passe au rouge pendant REC. Elle se masque quand un module est ouvert.
4. Dans **Clips**, **Lire** agrandit l’Island (jusqu’à 680 px dans sa fenêtre) et ouvre la vidéo avec les contrôles natifs : lecture, pause, position et volume. La flèche de retour ou Échap ramène à la liste, en conservant sa position de défilement. La vidéo n’est pas rechargée par la télémétrie de capture. Un format non décodable par Windows propose une ouverture dans un lecteur externe. Seul le fichier du clip identifié est autorisé dans le protocole média local.
5. **Afficher** révèle le clip dans l’Explorateur. **Supprimer** demande sa mise à la corbeille Windows et ne retire l’entrée de l’historique qu’après réussite ; une erreur conserve le clip. L’opération Shell garde l’avertissement Windows si le fichier ne peut pas être recyclé. Après une interruption, **Ouvrir les fragments** donne accès aux fichiers de récupération s’ils existent.

Le test navigateur lit et déplace la position d’une vidéo H.264/AAC synthétique servie avec des réponses HTTP Range, puis contrôle le retour à la liste et les erreurs de suppression. La corbeille native se vérifie séparément par `powershell -NoProfile -ExecutionPolicy Bypass -File tools/tests/replay-recycle.ps1` : le script crée son propre fichier unique, le retrouve dans la corbeille et le restaure intact. Aucun clip personnel n’est utilisé. Les options Shell utilisées sont documentées par [Microsoft](https://learn.microsoft.com/fr-fr/windows/win32/api/shobjidl_core/nf-shobjidl_core-ifileoperation-setoperationflags).

Pour préparer le moteur avant une compilation Windows, exécuter `npm run prepare:replay` avec un FFmpeg local compatible, au besoin indiqué par `NOLYS_FFMPEG`. Le script vérifie les filtres Windows requis et consigne version et SHA-256. Le binaire embarqué et ces métadonnées sont ignorés dans Git ; un simple clone ne les contient pas. Le service applicatif est en Rust, tandis que FFmpeg reste le composant natif de capture, de codec et de multiplexage. Voir `src-tauri/resources/replay/README.txt` pour la préparation et la provenance du composant distribué.

Pour lancer volontairement l'essai natif de fenêtre avec audio système et microphone, depuis la racine du dépôt :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/tests/replay-native.ps1 -Source Window -Codec hevc -Fps 60 -SystemAudio -Microphone
```

Ce test est explicitement opt-in : il ouvre une fenêtre de test en arrière-plan sans l'activer, capture dans des fichiers temporaires et n'utilise pas les préférences personnelles. `-Source Desktop -Codec h264 -SystemAudio -Microphone -MixAudio` permet le parcours d'écran avec une piste mixée. Il nécessite l'environnement de développement Rust et le moteur local préparé ; il ne constitue pas un benchmark.

## État vérifié au 19 octobre 2026

- Sur le PC hôte AMD RX 7800 XT : capture, encodage, exports replay et REC puis décodage des sorties réussis sans audio ; parcours répété avec audio système AAC réussi. Ces essais ciblés ne constituent pas une mesure de cadence soutenue ni de synchronisation audio sous charge prolongée.
- Un essai fonctionnel court avec 60 FPS configurés, son système et microphone sur pistes séparées a ensuite réussi : chacun des deux MP4 (replay et REC) contient deux pistes AAC et chaque piste des exports a été décodée. Le service Rust envoie l'audio PCM dans un flux Matroska horodaté, en blocs de 10 ms avec silence inclus, depuis une origine temporelle partagée avec la vidéo. La cadence soutenue et la synchronisation audio prolongée ne sont pas mesurées par cet essai.
- Capture WGC de la fenêtre de test en arrière-plan à 60 FPS configurés réussie en H.264 sans audio, puis en HEVC avec son système et microphone sur deux pistes AAC. Un autre essai d'écran H.264 à 60 FPS configurés a réussi avec PC et micro mixés sur une seule piste AAC. Chaque parcours a produit replay et REC, décodé toutes les pistes et vérifié leur nombre ; les derniers essais ont aussi vérifié une première image vidéo non noire par décodage brut en 32 × 32. Ces vérifications ne couvrent pas toutes les combinaisons de source, codec et audio.
- Le chemin observé est un encodage GPU avec transfert de compatibilité. Aucun chemin sans copie ni gain de consommation CPU n'a été mesuré.
- 41 tests JavaScript sur 41 ont réussi, ainsi que les suites navigateur Replay et menus existants. La compilation UI a réussi avec les avertissements `host-context` déjà présents. Après la correction de durée, la suite Rust de bibliothèque a réussi : 40 tests réussis et 3 tests matériels ignorés par défaut ; les parcours natifs Replay ont été exécutés séparément. La compilation de l'exécutable applicatif en profil de développement a réussi.
- Dépassement de durée reproduit sur AMD : avec le seul paramètre GOP, un flux synthétique H.264 de huit secondes ne contenait qu’une image clé initiale. La demande explicite d’images clés et d’IDR a rétabli les bornes à 0, 2, 4 et 6 secondes. Le tampon applique aussi une limite stricte en durée, même si une image clé manque. Un essai natif d’écran H.264 à 60 FPS avec audio système, prolongé au-delà de 60 secondes, a produit un replay MP4 de 58,26 secondes pour une limite de 60 secondes ; REC a dépassé la limite de replay. Les deux fichiers et leurs pistes ont été décodés sans erreur.
- Sept captures issues du navigateur de test couvrent repos, réglages, REC, clips, liste vide, erreur et format compact. Le pont Tauri de ce test utilise des données simulées : les mentions de GPU direct, de FPS et d'audio dans ces images ne prouvent pas le fonctionnement natif correspondant. Provenance et revue dans `nolys-replay-design-review.md`.

Les autres GPU, sources multiples, fenêtres de jeux réels, plein écran exclusif, HDR, veille, perte d'appareil audio, usage prolongé et performances restent à valider. Les 60 FPS sont une configuration des essais, pas une mesure de cadence soutenue ; la synchronisation audio prolongée reste à mesurer. Le verdict visuel « ship » concerne exclusivement les deux corrections P2 revues (nom accessible du bouton de fermeture du message et fixture Clips stabilisée), pas une validation générale de diffusion du moteur.
