# Vérifier Nolys

Prérequis : Windows avec outils C++ de Visual Studio, Rust stable et Node.js 24 ; dépendances installées avec `npm ci`. Les scripts utilisent les lockfiles existants et n’installent aucun paquet applicatif.

```powershell
npm run check         # Tests JS + compilation Vite + tests Rust, arrêt au premier échec
npm test              # Seulement les tests JS purs
node tools/verify.mjs --ui --rust
npm run check:audit   # npm + RustSec ; accès réseau nécessaire pour les bases d’avis
```

Le contrôle commun exclut tous les tests Rust marqués `ignore` : capture réelle écran/micro, Corbeille Windows et tests dépendant du moteur. Il ne construit ni ne publie d’installateur. La CI Windows dans `.github/workflows/verify.yml` reproduit ce contrôle et les audits ; sa présence dans Git ne prouve pas qu’un passage distant a déjà réussi.

Pour RustSec, `cargo-audit` 0.22.2 peut être installé comme **outil local** sans modifier les dépendances de Nolys :

```powershell
cargo install cargo-audit --version 0.22.2 --locked --root .impeccable/runtime/audit-tools
npm run check:audit
```

Une autre installation peut être fournie par `NOLYS_CARGO_AUDIT`, sinon le script essaie `cargo audit` sur le PATH. Un audit refusé ou indisponible fait échouer la commande ; il n’est jamais annoncé comme réussi.

## Parcours navigateur facultatifs

```powershell
$env:NOLYS_PLAYWRIGHT_MODULE = 'C:\chemin\vers\node_modules\playwright'
$env:NOLYS_FFMPEG = 'C:\chemin\vers\ffmpeg.exe'
npm run check:browser
```

Playwright est un outil de test fourni séparément, hors du graphe applicatif. Microsoft Edge doit être installé ; Replay nécessite FFmpeg uniquement pour créer des médias synthétiques. Le script démarre son propre Vite sur un port libre, avec HMR désactivé pour conserver les fixtures pendant les tests, exécute toutes les suites `tools/tests/*.browser.cjs`, puis arrête ce serveur. Il conserve le serveur de développement personnel. Le pont natif est simulé : aucun enregistrement de bureau ou de microphone n’est lancé par ces parcours. Certains scripts produisent des captures dans `.impeccable/review` ou un dossier de diagnostic local.

## Vérifications distinctes de livraison et de matériel

`node tools/tests/release-csp.native.mjs` nécessite un vrai exécutable **release** ouvert volontairement avec le port de diagnostic WebView2 indiqué dans ce script. Il contrôle la politique de styles/scripts embarquée ; Vite seul ne la prouve pas. `node tools/verify-release.mjs` contrôle un installateur signé déjà construit et ses ressources ; aucune signature ni publication n’est déclenchée par ce contrôle.

Les captures longues, audio, reprise de veille, périphériques débranchés et DPI mixtes restent décrits dans [la matrice Replay](../tools/tests/replay-validation.md) et dans l’audit transversal. Une compilation ou un parcours navigateur à pont simulé ne valide pas ces scénarios matériels.
