# Identité Nolys

Le logo validé est un N en verre teinté cuivre/champagne sur un carré charbon arrondi. `icon-source.png` est la source haute résolution avec transparence extérieure ; `prompt.md` documente sa création avec Imagegen.

## Palette

| Usage | Couleur |
|---|---|
| Cuivre | `#D49460` |
| Champagne | `#EDBC89` |
| Charbon | `#17151B` |
| Ivoire | `#F5EFE7` |

Les couleurs s’appliquent par défaut. La synchronisation avec les pochettes et les personnalisations de l’utilisateur restent disponibles.

## Exports

Les icônes Windows sont dans `src-tauri/icons/` (32, 64, 128, 256 et 512 px, plus ICO multirésolution). Le logo de l’interface est `src/public/assets/app-logo.png` (256 px). Les deux bannières NSIS gardent les dimensions attendues : 150 × 57 et 164 × 314.

Pour refaire les icônes depuis la racine du dépôt :

```powershell
npm run tauri -- icon branding/icon-source.png --output src-tauri/icons
Copy-Item src-tauri/icons/128x128@2x.png src/public/assets/app-logo.png
./tools/update-brand-assets.ps1 -AppRoot $PWD.Path -ProductName Nolys
```

La commande Tauri génère aussi des formats mobiles inutilisés par cette app Windows.
