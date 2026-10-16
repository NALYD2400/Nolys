# Bibliothèque musicale Nolys

La Bibliothèque est un mode de l’Island, comme le Lecteur ou le Mélangeur : ouvrez le menu de l’Island puis **Bibliothèque**. La capsule prend sa plus grande forme avec le même ressort que les autres modes, garde sa matière, son halo et sa couleur d’accent (thème ou pochette), et reste dans la fenêtre de l’Island.

- **‹** (en haut à gauche) revient au menu de l’Island.
- **Échap** remonte d’un niveau : menu ouvert, puis feuille de dialogue, puis sélection, puis recherche ; ensuite il replie l’Island.
- Cliquer hors de l’Island la replie aussi. La lecture continue dans tous les cas.

## Importer sa musique

Le bouton **+** en haut à droite propose **Un dossier** ou **Des fichiers** (les sous-dossiers sont parcourus). Formats reconnus : **MP3, FLAC, WAV, M4A, AAC, OGG et OPUS**.

Les fichiers restent à leur place : Nolys enregistre leurs chemins, sans copier l’audio ni modifier les tags. Un fichier déjà importé est ignoré. Aucun dossier n’est surveillé : relancez un import pour ajouter de nouveaux fichiers. Titre, artiste, album, durée et pochette sont lus dans les métadonnées ; sans titre, le nom du fichier est utilisé.

## Retrouver et écouter

Les pastilles sous l’en-tête passent de **Tous** à **Favoris**, à la **File** d’attente et à vos playlists (la molette fait défiler les pastilles). La recherche porte sur le titre, l’artiste et l’album, sans tenir compte des accents ; **Ctrl+F** y place le curseur. Le bouton de tri propose titre, artiste, album ou ajout récent. Les grandes collections s’affichent par tranches de 150 titres.

Un clic sur un titre lance la collection affichée à partir de lui ; **Lire** la lance depuis le début (ou au hasard si l’aléatoire est actif). Le mini-lecteur en bas et l’Island pilotent la même lecture : pause, précédent/suivant, position, volume, aléatoire et répétition. Les raccourcis média globaux visent aussi la lecture locale tant qu’elle est active. Le bouton **⏏** arrête la lecture locale et rend la main aux autres lecteurs suivis par l’Island.

## Favoris et playlists

Le cœur d’une ligne (visible au survol) ajoute le titre aux favoris. **+ Playlist** crée une playlist. Le menu **⋯** d’un titre (ou un clic droit) permet de l’ajouter à une playlist, de le lire ensuite, de le monter ou descendre dans une playlist, de retrouver son fichier ou de le retirer.

**Choisir** active la sélection : touchez plusieurs titres, puis **Ajouter à…** ou **Retirer**. Retirer d’une playlist laisse le titre dans la bibliothèque ; retirer de la bibliothèque le retire aussi des playlists, après confirmation. Les fichiers originaux ne sont jamais supprimés.

## Fichier déplacé

Un fichier absent est grisé avec **Fichier introuvable** et un bouton **Retrouver** : choisissez son nouvel emplacement, le titre garde ses playlists et son état favori.

## Sauvegarde locale

Collection, favoris et playlists sont enregistrés dans **`music-library.json`** (remplacement atomique), les miniatures de pochettes dans **`music-covers`**, tous deux dans le dossier de données de Nolys. Ce fichier ne contient pas votre musique.

## Vérification

`tools/tests/local-music.test.mjs` couvre le lecteur (file, aléatoire, répétition, fichiers absents). `tools/tests/library.browser.cjs` parcourt la vraie interface dans Edge avec un pont Tauri simulé, des titres synthétiques et un véritable élément audio ; il produit les captures `docs/screenshots/18` à `20`. Les sélecteurs de fichiers Windows se vérifient dans l’application.
