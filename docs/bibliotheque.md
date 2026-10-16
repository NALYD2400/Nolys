# Bibliothèque musicale Nolys

La bibliothèque ouvre votre collection audio personnelle dans une fenêtre dédiée. La lecture appartient à l’Island : fermer la fenêtre Bibliothèque laisse le morceau jouer tant que Nolys reste en cours d’exécution. Quitter Nolys arrête la lecture locale.

## Importer sa musique

Ouvrez **Bibliothèque** dans le menu de l’Island, puis **Importer → Des fichiers** ou **Un dossier**. Le choix d’un dossier parcourt aussi ses sous-dossiers. Les extensions reconnues sont **MP3, FLAC, WAV, M4A, AAC, OGG et OPUS** ; la lecture dépend aussi du décodage disponible dans le moteur audio de Windows.

Les fichiers restent à leur emplacement d’origine : Nolys enregistre leurs chemins, sans copier les fichiers audio ni modifier leurs tags. Un même chemin déjà importé est ignoré. L’import est ponctuel : aucun dossier n’est surveillé pour ajouter automatiquement les nouveaux fichiers. Relancez un import pour les ajouter.

Titre, artiste, album, durée et pochette sont lus dans les métadonnées disponibles. Sans titre renseigné, Nolys affiche le nom du fichier sans extension ; sans artiste, **Artiste inconnu** ; sans album ou durée, un tiret. Une icône de disque remplace la pochette absente.

## Retrouver et écouter

La recherche porte sur les titres, artistes et albums. **Ctrl+F** donne le focus à la recherche. Vous pouvez trier la collection et les favoris ; les grandes listes sont paginées par 100 morceaux.

Cliquez sur un titre ou sur **Écouter** pour lancer la collection affichée. Le lecteur inférieur et l’Island pilotent la même lecture : pause, précédent/suivant, position, volume, aléatoire et répétition. **File de lecture** montre les titres en attente ; le menu d’un morceau permet de l’y ajouter. L’action **Revenir aux lecteurs externes** arrête la lecture locale et rend la main aux lecteurs externes suivis par l’Island.

## Favoris et playlists

Le cœur d’un titre l’ajoute aux **Favoris**. Le bouton **+** à côté de **Mes playlists** crée une playlist. Ajoutez un morceau depuis son menu, ou cochez plusieurs titres puis choisissez **Ajouter à une playlist**. La case de l’en-tête sélectionne les morceaux de la page affichée.

Dans une playlist, les actions **Monter** et **Descendre** du menu d’un morceau changent son ordre. Vous pouvez renommer ou supprimer une playlist. Retirer un morceau d’une playlist le laisse dans la bibliothèque ; retirer un morceau de la bibliothèque le retire aussi des playlists, après confirmation. Les fichiers originaux sont conservés dans tous ces cas.

## Fichier déplacé ou indisponible

Un fichier absent apparaît avec **Fichier introuvable** et ne peut pas être lancé. Dans son menu, choisissez **Retrouver le fichier**, puis sélectionnez son nouvel emplacement. Nolys actualise ses informations en conservant son identité dans les playlists et son état favori. Un disque externe doit être accessible au moment de la lecture.

## Sauvegarde locale

Collection, chemins, favoris et playlists sont sauvegardés dans **`music-library.json`**, dans le répertoire de données de l’application fourni par Tauri. Les miniatures extraites des pochettes sont stockées dans **`music-covers`**, au même endroit. Ces données sont distinctes des fichiers audio originaux ; conserver seulement ce JSON ne sauvegarde pas votre musique. Les changements de collection sont enregistrés par remplacement atomique du fichier JSON.

## Vérification et limites

Les parcours d’interface ont été vérifiés dans un navigateur avec une **passerelle Tauri simulée** : import, playlists, ordre, favoris, fermeture/réouverture et tailles de fenêtre. La lecture a utilisé un véritable élément **HTMLAudio** dans ce navigateur, avec pause, position, volume et aléatoire. Cela ne constitue pas une validation complète du lecteur dans la fenêtre Windows native.

Les tests Rust natifs du parcours de fichiers, des métadonnées et des transactions de sauvegarde passent. Les boîtes de dialogue Windows de choix de fichiers et dossiers n’ont pas été exercées manuellement. Les captures `18-bibliotheque-vide.png` à `21-bibliotheque-compacte.png` illustrent les états vérifiés ; leurs titres musicaux sont des données synthétiques de test. Cette documentation ne vaut pas annonce de publication, de version installée ou de distribution.
