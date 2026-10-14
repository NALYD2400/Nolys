# Historique

## Prochaine version — en préparation

- Pilule repliée : le titre du morceau s'affiche entre la pochette et l'onde, et la pilule prend la largeur de son contenu (150 à 240 px, avec le ressort à chaque morceau). Au-delà, le titre défile en boucle.
- Visualiseur refait façon Apple : 5 barres en gélule centrées, chacune à son rythme, aux couleurs de la pochette avec un léger halo, qui retombent en points à la pause. Dessin net sur les écrans haute densité.
- Pilule repliée : l'onde est posée dans le bout droit, symétrique de la pochette ronde ; le contenu ne déborde plus du bord.
- Lecteur ouvert : la bande de barres coupée en bas est remplacée par la même onde, à droite du titre.
- Lecteur ouvert plus compact : les temps sont collés sous la barre de progression, en Inter avec des chiffres de largeur fixe, et le vide du bas a disparu.
- Titre trop long (pilule et lecteur) : il défile en boucle vers la gauche, sans retour en arrière, au lieu d'être coupé.

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
