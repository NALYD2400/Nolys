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
  library-secondary: "rgba(245, 239, 231, .65)"
  library-line: "rgba(245, 239, 231, .08)"
  library-surface: "rgba(245, 239, 231, .05)"
  library-sidebar: "#121115"
  library-titlebar: "#151318"
  library-button-text: "#25180e"
typography:
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "13px"
  settings-title:
    fontSize: "22px"
    fontWeight: 700
    letterSpacing: "-0.02em"
  library-title:
    fontSize: "27px"
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
    textColor: "{colors.ivory}"
    typography: "{typography.library-button}"
    rounded: "{rounded.library-button}"
    padding: "10px 15px"
  library-button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.library-button-text}"
    typography: "{typography.library-button}"
    rounded: "{rounded.library-button}"
    padding: "10px 15px"
---

# Design System: Nolys

## Overview

**Creative North Star: "Identité Nolys existante"**

Ce relevé décrit l’identité en place, sans nouvelle direction artistique. Le N en verre cuivre/champagne sur carré charbon arrondi reste l’asset de marque. Les réglages et l’Island établissent la matière sombre, les accents chauds et les commandes arrondies ; la bibliothèque les prolonge avec une liste plus dense.

**Key Characteristics:**
- Charbon, cuivre et champagne par défaut ; personnalisation existante de l’Island conservée.
- Inter, hiérarchie compacte et icônes Phosphor cohérentes avec l’application.
- Surfaces tonales et contours discrets ; verre et halos là où ils existent déjà.

Sources : `branding/README.md`, `src/settings/styles.css`, `src/services/ThemeService.js`, `src/library/styles.css` et capture `docs/screenshots/19-bibliotheque.png`. Les tokens `library-*` décrivent cette extension ; ils ne remplacent pas les tokens des réglages.

## Colors

### Primary

Le cuivre porte l’action principale, le focus et les états actifs. Le champagne souligne la navigation sélectionnée et le morceau courant. Ce sont des valeurs par défaut : l’Island dispose déjà de réglages de couleur et d’une synchronisation avec les pochettes. La bibliothèque utilise actuellement sa propre palette CSS fixe.

### Neutral

Le charbon et l’ivoire viennent de la palette de marque. La bibliothèque distingue titre, barre latérale et lecteur par des fonds légèrement différents ; ses textes secondaires, traits et fonds de contrôle dérivent de l’ivoire transparent. Les réglages gardent leurs propres blancs transparents et leur fond légèrement plus neutre.

**The Incumbent Palette Rule.** Reprendre les rôles de couleur de la surface voisine ; ne pas uniformiser les différences existantes à l’occasion d’une extension.

## Typography

Inter avec repli `system-ui, sans-serif` assure le texte d’interface. Les réglages utilisent leur titre compact ; la bibliothèque augmente le titre de collection tout en gardant les boutons et noms de morceaux compacts. Les métadonnées et libellés secondaires descendent à 10–12 px selon leur rôle ; ce constat de densité n’est pas une nouvelle taille minimale globale. Durées et compteurs utilisent des chiffres tabulaires. Les titres longs sont tronqués dans les lignes, mais le titre de collection peut revenir à la ligne.

## Layout

Le shell des réglages possède une barre latérale de 228 px. L’extension Bibliothèque utilise 216 px, un en-tête de 52 px et un lecteur persistant de 108 px ; seule la collection centrale défile. Le contenu reçoit 26 px en haut et 30 px sur les côtés. Les lignes de titres mesurent 62 px, avec pochettes de 38 px.

À 900 px de largeur ou moins, la barre latérale passe à 188 px, les marges diminuent et la colonne Album disparaît. Sous 620 px de hauteur, les espacements et l’illustration de l’état vide se resserrent. Il s’agit d’une fenêtre de bureau redimensionnable, sans navigation mobile distincte.

## Elevation & Depth

Les réglages emploient un fond flouté teinté par l’accent et des matières verre, métal ou holographique. L’Island utilise un reflet intérieur, une ombre diffuse et un halo configurable. La bibliothèque est principalement tonale : les ombres servent aux menus et dialogues, avec un voile sombre flouté derrière les dialogues. Ne pas appliquer le halo de l’Island à chaque ligne de collection. Les valeurs exactes des ombres et transitions sont dans le sidecar.

## Shapes

Les angles arrondis s’adaptent à l’échelle : champs et boutons compacts, navigation plus enveloppante, menus et dialogues plus larges. Fermeture des réglages et lecture principale restent circulaires. Les séparateurs fins existent dans les réglages comme dans la bibliothèque ; ils structurent les groupes et les colonnes sans encadrer chaque morceau dans une carte.

## Components

- **Boutons :** action d’import cuivre, commandes secondaires sur fond translucide, icônes seules pour les actions compactes. Le focus visible reprend l’accent ; les boutons indisponibles sont estompés.
- **Navigation :** libellé et icône à gauche, compteur à droite ; survol tonal, état actif champagne sur cuivre transparent dans la bibliothèque.
- **Recherche et champs :** recherche intégrée sans cadre ; champs de dialogue sur fond charbon avec bord fin et angles arrondis. Conserver un libellé accessible.
- **Liste musicale :** colonnes alignées, en-tête fixe, pochette, favori et menu par titre. Le morceau courant se distingue par sa teinte chaude ; le fichier absent possède un message explicite.
- **Lecteur :** pochette et titre à gauche, transport et progression au centre, volume à droite. Le bouton lecture circulaire clair sert de repère visuel.

## Do's and Don'ts

### Do:
- **Do** reprendre le logo validé, Inter et les rôles cuivre/charbon de Nolys.
- **Do** garder un focus visible et des libellés accessibles pour les actions à icône.
- **Do** préserver les états vide, sélectionné, en lecture et fichier introuvable.

### Don't:
- **Don't** transformer une extension de fenêtre en nouvelle identité visuelle.
- **Don't** remplacer les variantes de matière et de couleur déjà configurables dans l’Island par une palette imposée.
- **Don't** présenter les titres synthétiques des captures de test comme du contenu utilisateur.
