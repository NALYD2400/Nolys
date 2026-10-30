# Vérification Replay & REC

Les contrôles ordinaires n’ouvrent aucun écran, flux audio ou microphone :

```powershell
node --test tools/tests/replay.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml --lib replay::
cargo test --manifest-path src-tauri/Cargo.toml --lib replay::recovery::tests::complete_and_truncated_synthetic_recordings_recover_without_touching_sources -- --ignored --exact
```

La dernière commande crée uniquement une vidéo synthétique temporaire et vérifie sa récupération complète/tronquée, sa lecture et la conservation des fragments.

Les essais matériels suivants sont **opt-in** : ils capturent réellement la source choisie, et les options audio ouvrent les appareils indiqués. Ils utilisent des réglages/fichiers temporaires ; ne pas les lancer automatiquement sur une machine personnelle.

```powershell
# 30 minutes de REC, tampon Replay de 60 secondes, fenêtre de test dédiée.
./tools/tests/replay-native.ps1 -Source Window -Seconds 60 -RecordingSeconds 1800
# Ajouter explicitement -SystemAudio et/ou -Microphone pour tester les pistes.
```

Matrice à réaliser et consigner sur matériel : AMD/NVIDIA/Intel, H.264/HEVC, écran/fenêtre, 30/60/120 FPS, audio PC seul/micro seul/deux pistes/mix ; 30 minutes puis 2 heures avec synchronisation audiovisuelle au début/milieu/fin, mémoire stabilisée et taille disque ; veille/reprise, déconnexion de périphérique, changement DPI/résolution. Contrôler le comportement des erreurs sans déclarer ces scénarios validés par une compilation.

Dans l’interface : la bibliothèque affiche 25 clips par page et garde les anciens indexés. Réindexer lit seulement les MP4 directement dans le dossier de destination, conserve les entrées existantes et copie tout manifeste corrompu avant reconstruction. Retrouver demande explicitement le fichier déplacé. Les clips importés affichent une durée inconnue jusqu’à la lecture. Une mise à la corbeille groupée demande confirmation et s’arrête au premier refus ; les clips suivants restent en place. Les fragments récupérés restent conservés pour contrôle manuel dans leur dossier.

Le cache régénérable est limité à 128 Mio et 512 JPEG ; l’élagage ne vise que les fichiers réguliers `<16 chiffres hexadécimaux>.jpg` du dossier interne `replay-thumbnails`. Les vidéos et images personnelles hors de ce cache ne sont jamais purgées. Le contrôle audio lit un niveau ponctuel et l’état muet, sans enregistrer ni modifier Windows. Silence et niveau non mesurable sont distincts d’un appareil absent. L’aperçu capture une image à la demande, sans rafraîchissement automatique.
