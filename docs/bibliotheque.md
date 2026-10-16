# Bibliothèque musicale Nolys

La bibliothèque ouvre votre collection audio personnelle directement dans l’Island agrandie, comme un grand mode Chrono. Elle reprend sa matière, ses couleurs, son fond ou sa pochette et son halo configurés. Sa taille de travail approche 1060 × 720 px et s’adapte à la zone de travail de l’écran et au zoom de l’Island.

En haut à droite, **Replier l’Island** retrouve la capsule compacte ; **Menu de l’Island** donne accès aux autres modes. La lecture continue pendant ces changements et la position enregistrée de la petite Island est conservée. Quitter Nolys arrête la lecture locale. Les réglages gardent leur interface actuelle ; leur intégration dans l’Island reste une évolution future.

## Importer sa musique

Ouvrez **Bibliothèque** dans le menu de l’Island, puis **Importer → Des fichiers** ou **Un dossier**. Le choix d’un dossier parcourt aussi ses sous-dossiers. Les extensions reconnues sont **MP3, FLAC, WAV, M4A, AAC, OGG et OPUS** ; la lecture dépend aussi du décodage disponible dans le moteur audio de Windows.

Les fichiers restent à leur emplacement d’origine : Nolys enregistre leurs chemins, sans copier les fichiers audio ni modifier leurs tags. Un même chemin déjà importé est ignoré. L’import est ponctuel : aucun dossier n’est surveillé pour ajouter automatiquement les nouveaux fichiers. Relancez un import pour les ajouter.

Titre, artiste, album, durée et pochette sont lus dans les métadonnées disponibles. Sans titre renseigné, Nolys affiche le nom du fichier sans extension ; sans artiste, **Artiste inconnu** ; sans album ou durée, un tiret. Une icône de disque remplace la pochette absente.

## Retrouver et écouter

La recherche porte sur les titres, artistes et albums. **Ctrl+F** donne le focus à la recherche. Vous pouvez trier la collection et les favoris ; les grandes listes sont paginées par 100 morceaux. Sur un petit écran, la liste et le lecteur se resserrent et certaines colonnes ou commandes secondaires sont masquées. La liste et les playlists restent défilables.

Cliquez sur un titre ou sur **Écouter** pour lancer la collection affichée. Le lecteur inférieur et l’Island pilotent la même lecture : pause, précédent/suivant, position, volume, aléatoire et répétition. **File de lecture** montre les titres en attente ; le menu d’un morceau permet de l’y ajouter. L’action **Revenir aux lecteurs externes** arrête la lecture locale et rend la main aux lecteurs externes suivis par l’Island.

## Favoris et playlists

Le cœur d’un titre l’ajoute aux **Favoris**. Le bouton **+** à côté de **Mes playlists** crée une playlist. Ajoutez un morceau depuis son menu, ou cochez plusieurs titres puis choisissez **Ajouter à une playlist**. La case de l’en-tête sélectionne les morceaux de la page affichée.

**Échap** ferme le dialogue ouvert sans quitter la bibliothèque. En dehors d’un dialogue, la touche ferme d’abord un menu ouvert ; sinon elle replie l’Island.

Dans une playlist, les actions **Monter** et **Descendre** du menu d’un morceau changent son ordre. Vous pouvez renommer ou supprimer une playlist. Retirer un morceau d’une playlist le laisse dans la bibliothèque ; retirer un morceau de la bibliothèque le retire aussi des playlists, après confirmation. Les fichiers originaux sont conservés dans tous ces cas.

## Fichier déplacé ou indisponible

Un fichier absent apparaît avec **Fichier introuvable** et ne peut pas être lancé. Dans son menu, choisissez **Retrouver le fichier**, puis sélectionnez son nouvel emplacement. Nolys actualise ses informations en conservant son identité dans les playlists et son état favori. Un disque externe doit être accessible au moment de la lecture.

## Sauvegarde locale

Collection, chemins, favoris et playlists sont sauvegardés dans **`music-library.json`**, dans le répertoire de données de l’application fourni par Tauri. Les miniatures extraites des pochettes sont stockées dans **`music-covers`**, au même endroit. Ces données sont distinctes des fichiers audio originaux ; conserver seulement ce JSON ne sauvegarde pas votre musique. Les changements de collection sont enregistrés par remplacement atomique du fichier JSON.

## Vérification et limites

Dans l’application Windows locale, la bibliothèque a été ouverte dans la même fenêtre native que l’Island : zone transparente mesurée à 1124 × 802 px et capsule visible à environ 1062 × 722 px. Le retour au menu a restauré la fenêtre de 620 × 600 px ; la réouverture et la fermeture d’un dialogue de création par Échap ont été vérifiées. Il n’y a plus de fenêtre native Bibliothèque séparée.

Les parcours d’interface ont aussi été vérifiés dans un navigateur avec une **passerelle Tauri simulée** et des **titres synthétiques** : import simulé, playlists, ordre, favoris, changement de mode/réouverture, nettoyage des écouteurs et tailles compactes. Échap a été exercé dans les dialogues de création, de renommage et de suppression. La lecture a utilisé un véritable élément **HTMLAudio** dans ce navigateur, avec pause, position, volume et aléatoire.

Dans le WebView Windows compilé, un WAV synthétique fourni par une URL Blob a continué de jouer, en sourdine, pendant le passage de la bibliothèque au menu de l’Island : sa position est passée d’environ 0,10 s à 0,90 s sans mise en pause, avec la passerelle native d’événements de lecture. Ce contrôle isolé remplaçait temporairement la source de fichier, sa vérification de disponibilité et la commande de pause des lecteurs externes ; les remplacements ont été restaurés et aucun titre de test n’a été sauvegardé. Il valide la continuité du moteur audio et des événements dans ce parcours, sans valider l’import natif ni la lecture d’un fichier réel par son chemin autorisé.

Les tests Rust natifs du parcours de fichiers, des métadonnées, des transactions de sauvegarde et du placement de la grande Island passent. Les boîtes de dialogue Windows de choix de fichiers et dossiers n’ont pas été exercées manuellement. Les captures `.impeccable/review/18-bibliotheque-vide.png` à `21-bibliotheque-compacte.png` illustrent les états de navigateur ; leurs titres musicaux sont des données synthétiques de test. `native-library.png` montre l’état vide dans l’application Windows locale. Cette documentation ne vaut pas annonce de publication, de version installée ou de distribution.
