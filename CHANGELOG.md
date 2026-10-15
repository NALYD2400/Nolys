# Historique

## 2.2.1 — 15 octobre 2026

- Performance : le halo qui respire pendant la lecture avance 24 fois par seconde au lieu de suivre le rafraîchissement de l'écran (jusqu'à 360 Hz), et les bulles cachées sous la pilule ne pulsent plus. Rendu identique, processeur divisé par 2,5 environ pendant la lecture.
- Nouveau réglage « Images par seconde » (Apparence) : plafond des animations continues qui se redessinent, 60 par défaut, jusqu'à 240 ou la fréquence de l'écran.
- Performance : quand l'Island est masquée (plein écran, raccourci), ses animations se mettent en pause et reprennent au même point quand elle revient.
- Pochette : après un précédent ou suivant, l'ancienne pochette (ou le logo du navigateur) ne reste plus si rien n'est trouvé.
- Minuteur et chrono dans une bulle à gauche de la pilule ; placement, titres et réglages retouchés.
- Icônes harmonisées dans l'Island et les Réglages.

## 2.2.0 — 15 octobre 2026

### Raccourcis clavier (nouvelle section « Raccourcis » des Réglages)

- Chaque action a sa propre combinaison, réglable en cliquant puis en appuyant sur les touches (Échap annule).
- Une touche seule est refusée (sauf F1 à F24), et une combinaison déjà utilisée par une autre action est signalée.
- Une combinaison prise par Windows ou une autre application est signalée dans les Réglages et au démarrage de l’Island.
- Interrupteur par action : désactiver sans effacer la combinaison.
- Actions : afficher ou masquer l’Island, mode placement, ouvrir le lecteur / le mixer / le centre de contrôle / le retour micro, lecture-pause, titre précédent et suivant, capture d’écran rapide, ouvrir les Réglages.
- Les raccourcis suivent les profils et les exports de réglages.

### Personnalisation (nouvelle page « Island » des Réglages)

- Thèmes en un clic : Cuivre, Néon, Minimal, Pochette, Nuit (matière, halo, visualiseur et couleurs d'un coup, puis tout reste réglable).
- Pilule : forme de la pochette (ronde, arrondie, carrée), titre affiché ou non, largeur maximale (180 à 340 px), défilement des titres longs activable.
- Visualiseur : 4 styles (gélules façon Apple, égaliseur, onde façon Siri, points), 3 à 9 barres, halo des barres, affichage dans la pilule et/ou le lecteur, couleurs (Liquide, pochette, unie, dégradé), sensibilité.
- Lecteur et halo : intensité de la pochette floutée en fond du lecteur, halo qui respire pendant la lecture ou fixe.
- Les réglages du visualiseur quittent la page Musique pour cette nouvelle page.

### Corrections

- Pochette après précédent/suivant : l'ancienne pochette (ou le logo Chrome) ne reste plus quand la recherche ne trouve rien pour le nouveau morceau.
- Fond d'écran pochette : une pochette encore en attente pouvait revenir juste après la désactivation ; elle est maintenant annulée, et l'option est revérifiée avant d'appliquer.
- Réglages : l'en-tête est en verre dépoli, et les cartes ne réapparaissent plus derrière le titre quand on fait défiler.
- Menus déroulants des Réglages : le bouton reste visible quand le menu est ouvert (le menu s'en détache au lieu de le remplacer).

- Pilule repliée : le titre du morceau s'affiche entre la pochette et l'onde, et la pilule prend la largeur de son contenu (150 à 240 px, avec le ressort à chaque morceau). Au-delà, le titre défile en boucle.
- Visualiseur refait façon Apple : 5 barres en gélule centrées, chacune à son rythme, aux couleurs de la pochette avec un léger halo, qui retombent en points à la pause. Dessin net sur les écrans haute densité.
- Pilule repliée : l'onde est posée dans le bout droit, symétrique de la pochette ronde ; le contenu ne déborde plus du bord.
- Lecteur ouvert : la bande de barres coupée en bas est remplacée par la même onde, à droite du titre.
- Lecteur ouvert plus compact : les temps sont collés sous la barre de progression, en Inter avec des chiffres de largeur fixe, et le vide du bas a disparu.
- Titre trop long (pilule et lecteur) : il défile en boucle vers la gauche, sans retour en arrière, au lieu d'être coupé ; la copie suit de près.

## 2.1.0 — 14 octobre 2026

### Retour micro (nouveau)

- Entends ta voix dans le casque en direct, comme sur un casque de jeu. Le traitement est natif (WASAPI), sans pilote ni logiciel tiers.
- Volume de 0 à 200 % avec saturation douce, balance gauche/droite.
- Anti-bruit IA avec RNNoise (open source, tourne en local), porte de bruit au seuil réglable, coupe-bas à 90 Hz.
- Latence au choix (faible, normale, sûre), micro et sortie au choix, suivi automatique des périphériques par défaut.
- Alerte quand la sortie est une enceinte (risque de Larsen).
- Nouvelle vue dans l'Island avec vumètre en direct : le seuil de la porte se glisse directement sur le vumètre.
- Tuile « Micro » dans le centre de contrôle (clic : activer, flèche : régler), entrée « Micro » dans le menu, page « Retour micro » dans les Réglages.
- Bulle d'activité à côté de la pilule, dans la même matière que la pilule (pochette floutée, halo), avec des barres qui suivent ta voix. Clic : régler, clic droit : couper.
- Les réglages sont gardés et le retour reprend tout seul au démarrage.

### Island

- Le visualiseur ignore le retour micro : il ne suit que la musique et les autres applications.
- Gain automatique du visualiseur : les barres bougent autant à faible volume (Windows, lecteur, morceau calme) qu'à fort volume.
- Les animations restent actives quand les « effets d'animation » de Windows sont coupés (le réglage « Mouvement sobre » sert à les réduire).
- La pilule se déforme maintenant comme un ressort (léger rebond façon iPhone), plus marqué en mouvement « vif ».
- Le contenu apparaît en cascade avec un flou qui se dissipe ; la pilule s'écrase légèrement quand on clique.
- Menu des modules sur 4 colonnes.
- Pochette ronde dans la pilule repliée, centrée dans son bout arrondi.

## 2.0.2 — 8 octobre 2026

- Nouvelle identité Nolys, anciennement Liquid Dynamic Island.
- N Liquid Glass cuivre/champagne et icônes Windows multirésolution.
- Logo des réglages, pochette de secours, barre système et visuels NSIS harmonisés.
- Couleurs de repos, halo, réglages et visualiseur en cuivre/champagne ; les préférences existantes et les pochettes restent prioritaires.
- Intitulés et documentation mis à jour ; identifiant, sauvegardes et canal de mise à jour conservés.

## 2.0.1 — 8 octobre 2026

Version publiée sous le nom Liquid Dynamic Island. Voir les [notes de version](https://github.com/NALYD2400/dynamique-island/releases/tag/v2.0.1).
