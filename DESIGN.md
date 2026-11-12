# Identité visuelle Nolys

## Marque validée — 5 novembre 2026

Logo Orbite : deux courbes opposées en verre blanc nacré, ouverture diagonale, tuile bleu nuit et reflets bleus/violets. La forme validée est celle de gauche dans la comparaison avec la variante Island. Conserver son mouvement ; ne pas imposer une initiale N ou une capsule au centre.

Les illustrations des modules partagent cette matière : note musicale bleue, flèche Replay rouge franc (correction demandée explicitement), dossier ambre, chronomètre turquoise et microphone violet. Contrôle, Historique, Mélangeur, Bibliothèque, Réglages et Menu complètent la famille. Sources et provenance dans `branding/` ; exports locaux utilisables hors ligne.

À la demande de l’utilisateur, les modules emploient des PNG neutres contenant uniquement le symbole nacré, sur un fond entièrement transparent. Un fin liseré arrondi avec dégradé coloré est conservé ; son centre est évidé par un masque CSS, sans remplissage opaque ni ombre. Le matériau de l’app reste visible derrière le symbole. La couleur est appliquée en CSS avec un dégradé fixe et un masque alpha du même PNG pour le reflet inférieur. Catalogue dans `src/shared/module-art.js` ; rendu partagé entre menu JavaScript et composants React. Pas d’animation, flou, filtre, boucle JS ou changement de couleur périodique par icône. Le logo principal reste inchangé ; la famille nacrée est ensuite étendue aux raccourcis Windows prédéfinis, comme décrit ci-dessous.

## Interface existante

Cette évolution porte sur la marque et les illustrations du menu. La capsule transparente, Inter, les composants, la navigation, les dimensions et les thèmes existants sont conservés. Les thèmes cuivre/champagne restent disponibles et les choix enregistrés priment.

Les modules utilisent les illustrations nacrées dans le grand menu (42 px), le clic droit et les listes des Réglages (24 px). La lumière CSS est limitée au symbole et au liseré, sans halo extérieur ni animation. Au clic droit et dans les petits raccourcis du centre de contrôle, le liseré est masqué : le symbole seul reste sur fond transparent. Les libellés restent du texte accessible ; les images sont décoratives.

Choix confirmé le 6 novembre 2026 : retour aux icônes nacrées pour les modules. Les actions utilitaires Déplacer, Quitter et Personnaliser restent des pictogrammes Phosphor réguliers dans les menus et leurs éditeurs. Les raccourcis Windows connus conservent leur illustration, les raccourcis personnels inconnus leur icône choisie. Aucune migration des préférences n’est nécessaire.

Le micro retrouve son symbole nacré violet dans l’en-tête (30 px) et la tuile du centre de contrôle (24 px), sans fond ni liseré. L’anneau fonctionnel indiquant la voix reste présent quand le retour est actif. Lecture/pause, coches, flèches et petits contrôles restent simples. Le logo Orbite de l’application reste inchangé.

Les états compacts Replay, REC et minuteur reprennent aussi les symboles nacrés des modules (28 px, 16 px en mode jeu), ainsi que les bulles Replay et micro (22 px) et l’en-tête du mélangeur (24 px). Aucun cadre autour de ces symboles. REC conserve un point rouge distinct ; les barres de voix, la confirmation de coupure micro et le compteur satellite du minuteur gardent leur fonction.

## Vérification

Vérifier les exports Windows, le logo en 32 px, le menu à la taille native, le lecteur sans pochette et les réglages. Les captures dans `.impeccable/review/branding-orbite/` proviennent du navigateur avec pont natif simulé ; elles ne prouvent pas le rendu d’une installation publiée.
