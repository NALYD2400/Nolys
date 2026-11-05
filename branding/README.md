# Identité Nolys — Orbite nacrée

Identité choisie le 5 novembre 2026 : deux courbes opposées et une ouverture diagonale, verre blanc nacré, bleu nuit et reflets bleus/violets. La variante avec une capsule au centre a été écartée.

Les sources avec transparence sont `icon-source.png`, `module-sources/*.png` et `module-sources/neutral/*.png`. Création : Imagegen intégré, documentée dans `prompt.md`, `neutral-prompts.json` et `assets.json`.

| Usage | Couleur indicative |
|---|---|
| Bleu nuit | `#080E25` |
| Verre nacré | `#F1F3FF` |
| Nolys | Bleu `#3488FF` → violet `#7947FF` |
| Musique | Bleu `#3488FF` |
| Replay & REC | Rouge `#FF303B` |
| Fichiers | Ambre `#FFBC49` |
| Chrono / minuteur | Turquoise `#34E1CF` |
| Micro | Violet `#9656FF` |

Les thèmes, les préférences enregistrées et les couleurs des pochettes sont conservés.

## Exports et intégration

Le logo est partagé par les réglages, À propos, le lecteur sans pochette, le favicon et les icônes natives Windows. La zone de notification utilise la même icône native.

Les dix modules et le choix « Menu des modules » ont des symboles nacrés neutres, sans tuile ni couleur dans le PNG. Les exports actifs sont dans `src/public/assets/modules/neutral/` (128 px). Le relief vient du PNG et la lumière colorée de `src/shared/module-art.css`, avec une couleur fixe par module dans `src/shared/module-art.js`. À la demande de l’utilisateur, le fond reste entièrement transparent avec un contour arrondi fin portant un petit dégradé coloré. Ce liseré est évidé par un masque CSS : aucun carré sombre ni ombre ne masque le matériau de l’app. La même image alpha sert de masque au reflet inférieur : elle est mise en cache, sans seconde variante colorée à télécharger.

Le menu principal, le menu du clic droit, le lanceur du centre de contrôle et les listes React de personnalisation partagent ce rendu. Le clic droit et le lanceur n’ont aucun contour autour des symboles ; le fin liseré dégradé est conservé dans la grille des modules.

Déplacer, Quitter, Personnaliser, Recherche et les huit raccourcis Windows prédéfinis complètent la famille. Explorateur réutilise le dossier neutre et Paramètres Windows réutilise l’engrenage avec un accent distinct. Les anciens boutons sont reconnus par leur commande exacte, sans réécriture des préférences. Les commandes personnalisées inconnues conservent le pictogramme choisi. Les prompts de cette extension sont dans `utility-prompts.json`.

Aucun effet animé, boucle React, filtre de flou ni traitement d’image continu n’est ajouté. Les petits boutons de lecture, contrôles de réglage et satellites restent en Phosphor. Les premiers exports avec couleur intégrée sont conservés comme sources historiques ; le logo principal reste inchangé.

Exports : `src-tauri/icons/` (32, 64, 128, 256, 512 px et ICO multirésolution), `src/public/assets/app-logo.png` (256 px), `src/public/assets/modules/` (128 px). Les bannières NSIS conservent 150 × 57 et 164 × 314.

Réexport local, sans nouvelle génération :

```powershell
./tools/export-brand-icons.ps1
# Réexporter seulement les modules :
./tools/export-brand-icons.ps1 -ModulesOnly
```

Tauri produit les icônes natives ; les intermédiaires sont dans `.impeccable/runtime/`. Ancienne identité et prompt : `archive/n-cuivre/`. Les captures historiques restent datées de leur version. Le changement de sources ne met pas à jour un exécutable déjà installé.
