Nolys Replay & REC

Le service est écrit en Rust. FFmpeg fournit la capture DXGI/WGC, les codecs
matériels et le multiplexage MP4. Aucun téléchargement n'est déclenché à l'usage.

Pour préparer le composant avant une compilation Windows :
  npm run prepare:replay
ou définir NOLYS_FFMPEG vers le binaire Windows à intégrer.

Le script copie le binaire local et consigne sa version et son SHA-256.
Le binaire, build-info.txt et ffmpeg.sha256 ne sont pas versionnés dans Git.
Le programme installé recherche d'abord ce composant embarqué ; un moteur
personnalisé peut être choisi dans Replay > Réglages > Moteur vidéo.

FFmpeg est un projet tiers : https://ffmpeg.org/
La licence et la provenance du binaire réellement distribué doivent accompagner
chaque livraison. Voir build-info.txt et le texte renvoyé par ffmpeg -L.
Ce dossier ne constitue pas une autorisation de redistribuer n'importe quel build.
