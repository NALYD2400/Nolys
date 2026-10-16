---
name: Nolys
description: Interface de bureau sombre, cuivre et verre ; bibliothèque personnelle dans la continuité de l’Island.
colors:
  accent: "#D49460"
  champagne: "#EDBC89"
  charcoal: "#17151B"
  ivory: "#F5EFE7"
  settings-background: "#161618"
  settings-text: "rgba(255, 255, 255, 0.94)"
  settings-secondary: "rgba(235, 235, 245, 0.58)"
  settings-separator: "rgba(255, 255, 255, 0.08)"
  library-text: "rgba(255, 255, 255, .96)"
  library-secondary: "rgba(255, 255, 255, .72)"
  library-line: "rgba(245, 239, 231, .08)"
  library-surface: "rgba(245, 239, 231, .05)"
  library-sidebar: "rgba(255, 255, 255, .018)"
  library-primary: "rgba(var(--accent-rgb), .25)"
typography:
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "13px"
  settings-title:
    fontSize: "22px"
    fontWeight: 700
    letterSpacing: "-0.02em"
  library-title:
    fontSize: "25px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-.035em"
  library-track:
    fontSize: "12px"
    fontWeight: 500
  library-button:
    fontSize: "12px"
    fontWeight: 550
rounded:
  input: "8px"
  library-button: "9px"
  navigation: "10px"
  menu: "12px"
  dialog: "18px"
  settings-window: "22px"
spacing:
  control-gap: "8px"
  content-gap: "10px"
  row-gap: "12px"
components:
  library-button:
    backgroundColor: "{colors.library-surface}"
    textColor: "{colors.library-text}"
    typography: "{typography.library-button}"
    rounded: "{rounded.library-button}"
    padding: "10px 15px"
  library-button-primary:
    backgroundColor: "{colors.library-primary}"
    textColor: "{colors.library-text}"
    typography: "{typography.library-button}"
    rounded: "{rounded.library-button}"
    padding: "10px 15px"
---

# Design System: Nolys

## Overview

**Creative North Star: "Identité Nolys existante"**

Ce relevé décrit l’identité en place, sans nouvelle direction artistique. Le N en verre cuivre/champagne sur carré charbon arrondi reste l’asset de marque. Les réglages et l’Island établissent la matière sombre, les accents chauds et les commandes arrondies ; la bibliothèque les prolonge avec une liste plus dense, directement dans la capsule agrandie.

**Key Characteristics:**
- Charbon, cuivre et champagne par défaut ; personnalisation existante de l’Island conservée.
- Inter, hiérarchie compacte et icônes Phosphor cohérentes avec l’application.
- Surfaces tonales et contours discrets ; verre et halos là où ils existent déjà.

Sources : `branding/README.md`, `src/settings/styles.css`, `src/services/ThemeService.js`, `src/library/styles.css`, `src/island/dynamic-island/views/library.js`, `src-tauri/src/island/layout.rs` et captures `.impeccable/review/18-bibliotheque-vide.png` à `21-bibliotheque-compacte.png`, ainsi que `native-library.png`. Les tokens `library-*` décrivent cette extension ; ils ne remplacent pas les tokens des réglages. Les captures de collection utilisent des titres synthétiques de test.

## Colors

### Primary

Cuivre et champagne restent les accents de marque par défaut. Dans la bibliothèque, l’accent hérité de l’Island porte le focus, les icônes actives, la progression et les fonds teintés. `--library-accent` et `--library-accent-rgb` suivent la configuration et la couleur de pochette lorsque sa synchronisation est active. Les valeurs cuivre du relevé sont des replis, pas une palette imposée : un accent bleu est également visible dans les captures de vérification. L’import utilise l’accent à 25 % d’opacité, puis 36 % au survol, avec texte clair.

### Neutral

Le charbon et l’ivoire viennent de la palette de marque. La vue interne et son en-tête restent transparents pour laisser passer la matière et le fond de l’Island ; barre latérale et lecteur ajoutent un blanc à 1,8 %. Les textes principal et secondaire utilisent des blancs à 96 % et 72 % ; traits et contrôles gardent leurs dérivés d’ivoire transparents. Navigation sélectionnée et morceau courant gardent un texte clair sur une teinte de l’accent. Les réglages conservent leurs propres tokens.

**The Incumbent Palette Rule.** Reprendre les rôles de couleur de la surface voisine ; ne pas uniformiser les différences existantes à l’occasion d’une extension.

## Typography

Inter avec repli `system-ui, sans-serif` assure le texte d’interface. Les réglages utilisent leur titre compact ; la bibliothèque augmente le titre de collection tout en gardant les boutons et noms de morceaux compacts. Les métadonnées et libellés secondaires descendent à 10–12 px selon leur rôle ; ce constat de densité n’est pas une nouvelle taille minimale globale. Durées et compteurs utilisent des chiffres tabulaires. Les titres longs sont tronqués dans les lignes, mais le titre de collection peut revenir à la ligne.

## Layout

Le shell des réglages possède une barre latérale de 228 px. La bibliothèque est un mode de la même Island, comme le Chrono : sa capsule s’agrandit jusqu’à environ 1060 × 720 px. La fenêtre transparente prend temporairement 1124 × 802 px à l’échelle 1, sous réserve de la zone de travail ; elle revient à 620 × 600 px hors de ce mode, sans modifier la position et le zoom enregistrés de la petite Island. Il n’existe pas de fenêtre native Bibliothèque distincte.

La grille interne utilise une barre latérale de 206 px, un en-tête de 68 px et un lecteur persistant de 108 px. Le contenu reçoit 26 px en haut et 30 px sur les côtés. La liste centrale et les playlists de la barre latérale défilent dans leur propre zone contrainte. Les lignes de titres mesurent 62 px, avec pochettes de 38 px.

À 900 px de largeur de fenêtre ou moins, la barre latérale passe à 188 px, les marges diminuent et la colonne Album disparaît. Les requêtes de conteneur mesurent ensuite la largeur de la vue interne : à 760 px ou moins, barre latérale de 164 px, en-tête de 58 px, lecteur de 96 px, titre de 22 px ; artiste et commandes latérales du lecteur sont masqués. À 530 px ou moins, barre latérale de 140 px, recherche sur une ligne entière et lecteur centré sur le transport. Sous 620 px de hauteur de fenêtre, la note latérale disparaît, les espacements se resserrent et l’état vide peut défiler. La disposition reste celle d’une application de bureau, sans navigation mobile distincte.

## Elevation & Depth

Les réglages emploient un fond flouté teinté par l’accent et des matières verre, métal ou holographique. La bibliothèque conserve la matière, les couleurs, le fond ou la pochette et le halo configurés sur l’Island qui la contient. Ses divisions internes restent tonales : les ombres servent aux menus et dialogues, avec un voile sombre flouté derrière les dialogues. Ne pas appliquer le halo de la capsule à chaque ligne de collection. Les valeurs exactes des ombres et transitions sont dans le sidecar.

## Shapes

Les angles arrondis s’adaptent à l’échelle : champs et boutons compacts, navigation plus enveloppante, menus et dialogues plus larges. Fermeture des réglages et lecture principale restent circulaires. Les séparateurs fins existent dans les réglages comme dans la bibliothèque ; ils structurent les groupes et les colonnes sans encadrer chaque morceau dans une carte.

## Components

- **Boutons :** import sur fond translucide teinté par l’accent hérité, commandes secondaires sur fond ivoire transparent, icônes seules pour les actions compactes. Le focus visible reprend l’accent ; les boutons indisponibles sont estompés. L’en-tête propose Replier l’Island et Revenir au menu de l’Island, dans le langage des autres modes.
- **Navigation :** libellé et icône à gauche, compteur à droite ; survol tonal, état actif clair sur accent à 11 % dans la bibliothèque.
- **Recherche et champs :** recherche intégrée sans cadre ; champs de dialogue sur fond charbon avec bord fin et angles arrondis. Conserver un libellé accessible.
- **Liste musicale :** colonnes alignées, en-tête fixe, pochette, favori et menu par titre. Le morceau courant se distingue par un fond d’accent à 5,5 % ; le fichier absent possède un message explicite.
- **Lecteur :** pochette et titre à gauche, transport et progression au centre, volume à droite lorsque la place le permet. Le bouton lecture circulaire clair sert de repère visuel. La lecture appartient à l’Island et continue pendant le repli ou le changement de mode.
- **Dialogues :** Échap ferme le dialogue ouvert en restant dans la bibliothèque. Hors dialogue, il ferme d’abord le menu ouvert, puis replie l’Island si aucun menu n’est ouvert.

## Do's and Don'ts

### Do:
- **Do** reprendre le logo validé, Inter et les rôles cuivre/charbon de Nolys.
- **Do** garder un focus visible et des libellés accessibles pour les actions à icône.
- **Do** préserver les états vide, sélectionné, en lecture et fichier introuvable.

### Don't:
- **Don't** transformer un mode agrandi de l’Island en nouvelle identité visuelle.
- **Don't** remplacer les variantes de matière et de couleur déjà configurables dans l’Island par une palette imposée.
- **Don't** présenter les titres synthétiques des captures de test comme du contenu utilisateur.
