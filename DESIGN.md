# Identité visuelle Nolys

## Marque validée — 5 novembre 2026

Logo Orbite : deux courbes opposées en verre blanc nacré, ouverture diagonale, tuile bleu nuit et reflets bleus/violets. La forme validée est celle de gauche dans la comparaison avec la variante Island. Conserver son mouvement ; ne pas imposer une initiale N ou une capsule au centre.

Les illustrations des modules partagent cette matière : note musicale bleue, flèche Replay rouge franc (correction demandée explicitement), dossier ambre, chronomètre turquoise et microphone violet. Contrôle, Historique, Mélangeur, Bibliothèque, Réglages et Menu complètent la famille. Sources et provenance dans `branding/` ; exports locaux utilisables hors ligne.

À la demande de l’utilisateur, les modules emploient des PNG neutres contenant uniquement le symbole nacré, sur un fond entièrement transparent. Un fin liseré arrondi avec dégradé coloré est conservé ; son centre est évidé par un masque CSS, sans remplissage opaque ni ombre. Le matériau de l’app reste visible derrière le symbole. La couleur est appliquée en CSS avec un dégradé fixe et un masque alpha du même PNG pour le reflet inférieur. Catalogue dans `src/shared/module-art.js` ; rendu partagé entre menu JavaScript et composants React. Pas d’animation, flou, filtre, boucle JS ou changement de couleur périodique par icône. Le logo principal reste inchangé ; la famille nacrée est ensuite étendue aux raccourcis Windows prédéfinis, comme décrit ci-dessous.

## Interface existante

Cette évolution porte sur la marque et les illustrations du menu. La capsule transparente, Inter, les composants, la navigation, les dimensions et les thèmes existants sont conservés. Les thèmes cuivre/champagne restent disponibles et les choix enregistrés priment.

Les petits contrôles et satellites utilisent Phosphor ; les illustrations en verre sont réservées aux emplacements où leurs détails restent lisibles. La lumière CSS est limitée au symbole et au liseré, sans halo extérieur ni animation. Au clic droit et dans le lanceur du centre de contrôle, le liseré est masqué à la demande de l’utilisateur. Les libellés restent du texte accessible ; les images sont décoratives.

Les actions Déplacer, Quitter, Personnaliser et Recherche ainsi que les huit raccourcis Windows prédéfinis utilisent aussi la famille nacrée. Leur commande existante détermine l’icône, sans migration des préférences. Un raccourci personnel dont la commande n’est pas connue conserve son pictogramme. Ces illustrations identifient une destination ou une action ; les petites commandes lecture/pause, les coches et les flèches de navigation restent simples.

## Vérification

Vérifier les exports Windows, le logo en 32 px, le menu à la taille native, le lecteur sans pochette et les réglages. Les captures dans `.impeccable/review/branding-orbite/` proviennent du navigateur avec pont natif simulé ; elles ne prouvent pas le rendu d’une installation publiée.
