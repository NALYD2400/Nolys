# Revue des clips et des dimensions de l’Island — 30 octobre 2026

État sauvegardé avant modification : commit `1642ae6` (repère, dépôt initialement propre).

## Corrections

- Clips : vignette 16:9 cliquable, titre sur une ligne plus large et commandes regroupées dessous. Une image JPEG de 320 × 180 est extraite du clip existant par FFmpeg, sans modifier la vidéo. Seuls les identifiants de clips de l’historique sont acceptés par la commande native ; seul le JPEG produit est autorisé dans le protocole local.
- Chargement à proximité des lignes visibles, une demande à la fois par panneau ; décodeur natif sérialisé, limité à huit secondes, sans console. Cache disque publié à partir d’un fichier temporaire complet, dépendant du chemin, de la taille et de la date de modification de la source. Cache frontend limité à 200 entrées. Un aperçu indisponible conserve une icône et les commandes de lecture.
- Les hauteurs Replay sont mémorisées séparément pour Capture, Clips et le lecteur. Réglages conserve sa hauteur complète. Les anciennes hauteurs communes ne servent plus à initialiser un autre onglet.
- La mesure part des dimensions de mise en page du contenu, indépendamment des translations de l’animation d’entrée. Les écritures de hauteur persistées sont dédupliquées. Le montage différé attend la fin des transitions de largeur et de hauteur, y compris si l’une se termine avant l’autre.
- Réseau : la largeur de la vue incluait auparavant 40 px de marges internes supplémentaires. Le calcul inclut maintenant ces marges. Les valeurs aléatoires ont été remplacées par les compteurs réseau existants du backend ; conversion de Kio/s vers Mbit/s et affichage « — » si les mesures sont indisponibles.
- Les sélecteurs de deux suites navigateur ont été actualisés pour leurs rôles actuels (`option` dans les listes et `radio` pour le choix Modules/Clic droit).
- Réglages : Échap sur un menu déroulant ne déclenche plus simultanément le repli de l’Island. Le menu se ferme d’abord ; les Réglages restent disponibles pour l’action suivante.

## Vérifications et portée

Compilation UI et `cargo check --lib` réussis. Les 50 tests JavaScript et les 52 tests Rust ordinaires réussissent ; cinq tests dépendant du moteur ou du matériel sont ignorés par défaut. Le nouvel essai FFmpeg sur une vidéo synthétique temporaire a été exécuté séparément : JPEG décodable, dimensions 320 × 180, réutilisation du cache, invalidation après déplacement du fichier et octets vidéo intacts.

Les suites navigateur utilisent le vrai frontend dans Edge et un pont Tauri simulé. Elles ne démarrent aucune capture du bureau ou du microphone. Les captures de revue se trouvent dans `.impeccable/review/` (dossier ignoré dans Git) ; la vignette de la capture Replay provient d’une vidéo de test synthétique.

Le parcours Replay couvre lecture, déplacement dans la vidéo, stabilité pendant la télémétrie, retour à la liste, réglages, renommage, suppression réussie ou refusée, états vides, listes longues, vignettes et cache, formats 900 × 700 et 640 × 600. Le contrôle des limites dans la fenêtre native 720 × 600 couvre Musique, Chrono, Réseau, Menu, Recherche musicale, Historique, Centre de contrôle, Mixeur, Micro, Bibliothèque, Réglages, Replay et Fichiers. La notification dispose aussi de sa suite JavaScript de concurrence et de restauration du panneau précédent.

Les quatre suites navigateur Replay, Fichiers, Menus et Réglages réussissent. Les 11 pages de Réglages ont été vérifiées sans défilement horizontal ; les parcours couvrent aussi les menus déroulants, Échap, l’export simulé, l’import avec perte de focus, le placement et la réouverture. Le test de fermeture d’un menu attend désormais la fin des transitions pour détecter un éventuel repli différé. Les débits réseau injectés dans le test contrôlent la conversion des unités et le repli en cas de mesure indisponible.

Le détecteur de qualité signale une image sans `src` dans le gabarit Clips : c’est le chargement différé prévu. L’image demeure transparente jusqu’à réception et décodage du JPEG ; le bouton affiche son icône de secours. Le navigateur vérifie son chargement effectif. La compilation conserve les avertissements préexistants du minificateur sur `:host-context`.

## Points restant à approfondir

- Une exécution dans le navigateur ne valide pas les interactions avec les DPI Windows, plusieurs écrans physiques, la veille, le plein écran exclusif ou une capture de longue durée. Cette matrice native reste à réaliser.
- Les températures et l’activité disque dans `platform/system.rs::telemetry` sont encore simulées. La vue Réseau ne les utilise pas. Elles devront être remplacées ou explicitement signalées avant toute exposition à l’utilisateur.
- Le cache des vignettes sur disque n’a pas encore de limite de rétention ; celui en mémoire est borné. Une politique de nettoyage des seuls aperçus générés serait utile pour les historiques renouvelés sur une longue période.
- Les préférences et la rétention du module Fichiers restent des fonctions à compléter selon le document de conception existant.

Cette passe corrige les défauts observés et couvre les principaux écrans ; elle ne constitue pas une certification exhaustive du backend ni de toutes les configurations matérielles.
