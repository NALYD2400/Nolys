# Vérification du placement — 6 novembre 2026

Correctifs locaux après Nolys 2.6.6, non publiés dans un installateur.

La fenêtre transparente conserve la zone utile du moniteur et un zoom natif de 1, en placement comme dans les vues normales. Le conteneur situe la capsule dans cette surface ; un zoom CSS règle la capsule et ses satellites. Les changements de mode ne peuvent donc plus dessiner une image avec le nouveau zoom natif et les anciennes coordonnées. L’entrée fait apparaître uniquement la bordure de placement, sans déplacer ni atténuer la capsule.

Le glisser utilise la différence absolue entre le curseur courant et son point de départ. Le dernier échantillon est appliqué au relâchement, puis la position est enregistrée sans recadrer la fenêtre. Les configurations ne sont diffusées qu’en fin de glisser. Le verrou réentrant du gestionnaire de déplacement natif et la règle CSS dupliquée qui réintroduisait la marge supérieure ont été supprimés.

La taille est interpolée sur 140 ms, avec interruption depuis la valeur réellement affichée. Les boutons restent sous la souris ; Aperçu/Replier libère cet ancrage et la barre suit immédiatement la hauteur de la capsule. Terminer replie d’abord l’aperçu sur place et attend sa transition avant de quitter le mode. Les commandes de placement sont temporairement désactivées pendant cette validation.

Le halo observe aussi le conteneur et conserve le même zoom que la capsule. Le menu clic droit mesure son contenu, se positionne dans la zone utile avec une marge de 8 px et défile si nécessaire ; sa commande native ne modifie aucune géométrie de fenêtre.

## Résultats

- 91 tests JavaScript, compilation de l’interface et 93 tests Rust séquentiels réussis ; 7 tests matériels restent ignorés.
- Parcours navigateur Placement, Interface, Menus et Halo réussis, ainsi que Réglages avant la dernière correction du zoom. Le test Placement vérifie notamment que Terminer attend le repli avant la commande native.
- Binaire Windows avec données et profil WebView isolés, aux échelles 65 %, 100 % et 150 % : entrée en placement sans déplacement mesuré, relâchement sans déplacement mesuré, sortie avec aperçu sans saut supérieur à 0,008 px, erreur maximale du halo de 0,016 px. Zoom natif inchangé. 35 images contrôlées par entrée, puis 140 par cycle relâchement/validation, après les callbacks de rendu.
- Déplacement par la même routine native jusqu’aux bords haut et bas : haut à 0 ; bas conforme à la bande visible de 40 px multipliée par l’échelle, sans réserve de l’ancienne fenêtre.
- Même parcours repris depuis le vrai bouton Déplacer du menu clic droit : déplacement nul à l’entrée aux trois échelles. Dimensions et espacement du satellite micro également vérifiés.
- Menus natifs longs (38 raccourcis) aux quatre coins et aux trois échelles, puis menus minimaux de 83 px : déplacement nul de la capsule à l’ouverture et à la fermeture, position enregistrée conservée, menu dans la zone utile et défilement disponible.

Les essais de relâchement appellent le début et la fin du glisser après un déplacement au clavier, avec curseur Windows immobile. Le calcul des deltas de curseur est testé en Rust ; ces essais ne remplacent pas un parcours manuel complet à la souris. Les passages entre écrans physiques à DPI différents restent à vérifier sur matériel. Les journaux et fixtures de diagnostic sont dans `.impeccable/runtime/`.
