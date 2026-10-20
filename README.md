# Nolys

<p><img src="branding/icon-source.png" alt="Logo Nolys : N en verre cuivre" width="160"></p>

**Votre musique. Votre bureau. À portée de clic.**

Nolys est le nouveau nom de Liquid Dynamic Island. La version **2.6.0** rend l’Island plus fluide et plus sûre, aux coins façon Liquid Glass, avec des réglages partagés entre toutes les versions. [Télécharger la dernière version Windows](https://github.com/NALYD2400/Nolys/releases/latest).

Widget « Dynamic Island » pour Windows : musique (Spotify, navigateurs…), mixeur audio par application, centre de contrôle, notifications, synchronisation du fond d'écran.

Le cœur Tauri 2 / Rust remplace l’ancien assemblage Electron, .NET et PowerShell. La pilule est écrite en JavaScript/CSS ; les réglages utilisent React et Liquid Glass.

## Au quotidien

- Lecteur musical : suivi des sessions Windows, pochette, progression, volume et historique.
- [Bibliothèque personnelle](docs/bibliotheque.md) : import de fichiers ou de dossiers sans copie, playlists, favoris et lecture locale qui continue quand l’Island se replie.
- Fichiers : conversions PNG/JPG/WebP/BMP, dimensions, compression JPG, copies et exports, activité et aperçu des images dans l’Island. Les originaux sont conservés.
- Replay & REC : sauvegarde des dernières secondes et enregistrement continu, capture écran ou fenêtre, réglages vidéo et audio PC/micro, lecture intégrée, renommage et corbeille des clips. Le moteur FFmpeg compatible est embarqué dans l’installateur.
- Mixeur audio par application, périphériques de sortie et d’entrée.
- Retour micro : ta voix dans le casque en direct, avec anti-bruit RNNoise, porte de bruit, coupe-bas et latence réglable.
- Centre de contrôle : commandes Windows, raccourcis, météo et mesures système.
- Chronomètre, notifications compactes, placement et taille sur plusieurs écrans.
- Réglages → Menus : boutons visibles, ordre et raccourcis personnels pour les modules et le clic droit ; la bulle adapte sa taille au contenu.
- Matériaux, transparence, flou, halos et couleurs personnalisables ; synchronisation avec les pochettes et le fond d’écran.

## Identité

Le N en verre teinté cuivre est partagé par l’app, la barre système, l’installateur et le portfolio. Palette : cuivre `#D49460`, champagne `#EDBC89`, charbon `#17151B`, ivoire `#F5EFE7`. Les préférences enregistrées et les couleurs des pochettes restent prioritaires. [Sources et exports de la marque](branding/README.md).

Le dépôt GitHub et l’identifiant `com.nalyd.liquid-dynamic-island` sont conservés pour assurer la continuité des données et du canal de mise à jour.

## Aperçu de la nouvelle identité

La Bibliothèque est accessible depuis le menu des modules. Capture de développement avec des morceaux de test et un pont natif simulé :

![Bibliothèque musicale Nolys](docs/screenshots/19-bibliotheque.png)

Captures historiques du code source 2.0.2, rendues avec un pont Tauri de démonstration. Musique, météo et données Windows sont simulées ; la matière, les contrôles et le logo viennent de l’interface réelle.

| Lecteur musical | Centre de contrôle |
|---|---|
| ![Lecteur](docs/screenshots/02-lecteur-musical.webp) | ![Centre de contrôle](docs/screenshots/03-centre-de-controle.webp) |

| Apparence | À propos |
|---|---|
| ![Personnalisation](docs/screenshots/12-apparence.webp) | ![Nolys 2.0.2](docs/screenshots/17-mises-a-jour.webp) |

## Prérequis

- [Rust](https://rustup.rs) (1.89 ou plus récent, MSVC)
- Node.js 22.12+ ou 24 LTS (Vite et CLI Tauri)
- WebView2 (déjà présent sur Windows 10/11)

```bash
npm install
```

## Commandes

| Commande | Rôle |
|---|---|
| `npm run dev` | Lance l'app en développement (serveur Vite + rechargement à chaud) |
| `npm run build` | Compile l'interface et le cœur, puis génère l'installeur NSIS (`src-tauri/target/release/bundle/nsis/`) |

## Structure

```
src/                         Interface, construite par Vite (vite.config.js) dans dist/
├─ public/assets/            Logo, polices et icônes embarquées (aucun CDN)
├─ shared/
│  ├─ ipc.js                 Pont interface <-> Rust (canaux nommés -> commandes Tauri)
│  ├─ cover-bus.js           Pochette en cours, publiée par l'Island pour les Réglages
│  └─ window-drag.js         Déplacement des fenêtres sans bordure (-webkit-app-region)
├─ services/                 Visualiseur audio, sons, thème
├─ island/                   Fenêtre de l'Island (JavaScript sans framework, très léger)
│  ├─ main.js                Point d'entrée
│  ├─ hit-region.js          Zone survolable envoyée au cœur (clic traversant)
│  ├─ styles/                CSS découpé par écran (ordre fixé par index.css)
│  └─ dynamic-island/
│     ├─ DynamicIsland.js    Classe principale (état initial)
│     ├─ features/           Logique : lecture, volume, mixeur, thème…
│     ├─ views/              Rendu des écrans : repos, lecteur, centre de contrôle…
│     └─ helpers/            Fonctions utilitaires (couleurs, formats, pochettes)
└─ settings/                 Réglages, un mode de l'Island (React + @glass-sdk/liquid-glass, voir docs/reglages.md)
   ├─ mount.jsx              Montage dans la capsule (shadow DOM), chargé à la demande
   ├─ App.jsx                Barre latérale, fond réfracté, navigation
   ├─ pages/                 Général, Apparence, Musique, Fond d'écran, Centre de contrôle, Position, À propos
   ├─ components/            Cartes, lignes et contrôles en verre
   └─ state/                 Lecture/écriture des réglages et envoi à l'Island

src-tauri/src/               Cœur natif (Rust)
├─ lib.rs                    Démarrage, plugins, enregistrement des commandes
├─ commands/                 Commandes appelées par l'interface
├─ island/                   Fenêtre de l'Island : position, premier plan, clic traversant, écrans
├─ media/                    Suivi du morceau en cours, pochettes de secours (Deezer / iTunes)
├─ wallpaper/                Synchronisation et rendu du fond d'écran (flou, cinématique)
├─ platform/                 Accès Windows : WASAPI, SMTC, radios, registre, icônes, réseau…
├─ migration.rs              Reprise des réglages de la version Electron
├─ tray.rs / shortcut.rs     Icône de notification, raccourcis globaux (Alt+I par défaut, configurables)
└─ updater.rs                Mises à jour via les releases GitHub
```

## Publier une mise à jour

1. Aligner la version dans `package.json`, `package-lock.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` et `src-tauri/Cargo.lock`.
2. Compiler en signant les fichiers de mise à jour (la clé privée est dans `keys/`, jamais dans git) :

   ```powershell
   $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content keys\updater.key -Raw
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
   npm run build
   ```

3. Créer une release GitHub sur `NALYD2400/Nolys` (tag `vX.Y.Z`) et y joindre, depuis `src-tauri/target/release/bundle/nsis/` :
   - `Nolys_X.Y.Z_x64-setup.exe`
   - `Nolys_X.Y.Z_x64-setup.exe.sig`
   - un fichier `latest.json` (modèle ci-dessous)

Le moteur Replay est préparé avant le build. Distribuer aussi sa licence, son README et sa provenance (`src-tauri/resources/replay/`) et joindre l’archive source FFmpeg correspondante à la release. Pour le binaire Gyan embarqué en 2.5.0, la référence exacte est indiquée dans `SOURCES.txt`. Un autre build FFmpeg nécessite des informations de provenance correspondantes.

Après génération de `latest.json`, `node tools/verify-release.mjs` vérifie les versions, la signature de mise à jour avec la clé publique existante, le manifeste et les ressources Replay. Publier d’abord une release brouillon avec tous les assets, vérifier tailles et SHA-256, puis la rendre publique comme dernière version.

```json
{
  "version": "X.Y.Z",
  "notes": "Nouveautés…",
  "pub_date": "2026-10-08T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "<contenu du fichier .sig>",
      "url": "https://github.com/NALYD2400/Nolys/releases/download/vX.Y.Z/Nolys_X.Y.Z_x64-setup.exe"
    }
  }
}
```

Les applications installées détectent la mise à jour au démarrage (carte « Mise à jour » des réglages).

> ⚠️ Si la clé `keys/updater.key` est perdue, les versions déjà installées ne pourront plus se mettre à jour automatiquement. Garde-en une copie en lieu sûr.

## Données utilisateur

`%APPDATA%\com.nalyd.liquid-dynamic-island\` : position de l'Island, journal `liquid-core.log`, fichiers du fond d'écran.
Au premier lancement, la position, le fond d'écran d'origine et tous les réglages de l'ancienne version Electron sont repris automatiquement.
