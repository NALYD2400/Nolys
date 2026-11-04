# Revue du code — 3 novembre 2026

Le projet possède une structure modulaire et une couverture de tests utile, mais ne peut pas encore être qualifié de totalement propre. Deux défauts fonctionnels ont été reproduits et les contrôles de qualité Rust échouent. Cette revue conserve les modifications applicatives présentes au début du contrôle ; aucune correction fonctionnelle n'a été appliquée.

## Constats à traiter

### P2 — Une préférence de fond mal formée empêche le démarrage

Emplacement : `src/island/dynamic-island/views/idle.js:34–36`, appelé par le constructeur dans `DynamicIsland.js:102`.

Avec `liquid_island_config = {"bgImage":123}`, `readRecord` accepte l'objet, puis `renderIdle` appelle `.replace()` sur le nombre. Une navigation neuve reproduit `TypeError: islandConfig.bgImage.replace is not a function` et le lecteur local n'est jamais initialisé. La récupération actuelle vérifie la structure extérieure du JSON, sans valider ce champ.

Correction proposée : normaliser et vérifier le type des champs de configuration avant leur utilisation, utiliser la même lecture sûre dans les vues et conserver la valeur originale dans la récupération. Tester un démarrage avec des champs mal typés, en complément des tests sur un JSON invalide ou de mauvais type à la racine. Le défaut a été reproduit avec une préférence persistée ; une importation complète de sauvegarde n'a pas été utilisée pour cette reproduction.

### P2 — Le fond personnalisé contourne le mode hors ligne

Emplacements : `src/services/ThemeService.js:106–109` et `src/island/dynamic-island/views/idle.js:34–36`.

Avec `liquid_offline_mode = "true"` et un fond HTTPS dans `liquid_island_config.bgImage`, une requête image part encore au démarrage. La sonde Edge intercepte et confirme la requête vers `https://offline-probe.invalid/background.svg`, sans accès à un serveur extérieur. Le filtre `offlineArt` existe et est employé ailleurs, notamment dans `cover-theme.js`, mais ces deux chemins appliquent directement l'URL.

Correction proposée : faire passer aussi ces fonds par `offlineArt` et vérifier l'absence effective de requêtes dans un test navigateur. Le libellé du réglage Musique promet explicitement de couper les images en ligne.

### P3 — Les contrôles de qualité Rust ne passent pas

`cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` signale des différences dans 48 fichiers Rust.

`cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` échoue avec sept diagnostics distincts :

- fonction `collect` inutilisée dans `library/mod.rs:173` ;
- clone évitable dans `files/mod.rs:567` ;
- code situé après les modules de tests dans `platform/http.rs:83`, `platform/system.rs:178` et `wallpaper/render.rs:117` ;
- conditions imbriquées simplifiables dans `platform/system.rs:99` et `updater.rs:358`.

Ces diagnostics ne sont pas sept bugs fonctionnels. Ils empêchent néanmoins un contrôle strict sans avertissements. La CI actuelle exécute les tests et les audits, sans vérifier le formatage ni Clippy. Le projet ne définit pas non plus de commande de lint JavaScript/React.

### P3 — Un test HTTP est intermittent

Le premier `npm run check` échoue dans `platform::http::tests::streamed_replies_enforce_size_and_timeout_against_a_local_server`, à `platform/http.rs:125` : la réponse courte attendue vaut `None`. Bilan de cette passe : 89 réussites, un échec, sept tests ignorés.

Le même test réussit isolément, puis la suite entière réussit deux fois, dont une fois par la commande officielle `node tools/verify.mjs --rust` : 90 réussites, zéro échec, sept tests ignorés. La cause de l'intermittence n'est pas établie. Vérifier les conditions d'initialisation et les délais du serveur local avant de modifier les assertions ; conserver les garanties de taille et de délai de la requête.

## Maintenance complémentaire

- Vite compile l'interface avec des avertissements Lightning CSS sur `:host-context` dans les feuilles Shadow DOM. Les parcours Edge vérifient le comportement ciblé ; ces avertissements ne prouvent pas une panne. Une partie des règles `.glass-controls` subsiste alors que `features/glass.js` désactive ce mécanisme et ne fournit plus que des méthodes de compatibilité.
- `npm audit --audit-level=high` ne trouve aucune vulnérabilité connue.
- RustSec termine sans vulnérabilité bloquante, avec sept avertissements autorisés : cinq dépendances non maintenues (`paste`, `proc-macro-error`, `zbus_names`, `zvariant`, `zvariant_derive`), un avertissement de sûreté mémoire sur `glib` et une version retirée du registre pour `async-executor`. Le rapport porte sur le lockfile ; il ne démontre pas l'exposition de chacune de ces dépendances dans le binaire Windows.

## Vérifications et preuves

| Contrôle | Résultat |
|---|---|
| Tests JavaScript | 86 réussites, zéro échec |
| Compilation Vite | Réussie, avertissements CSS décrits ci-dessus |
| Tests Rust | 90 réussites et sept ignorés à la confirmation ; premier passage intermittent décrit ci-dessus |
| Parcours Edge | 12 suites réussies : accessibilité, centre de contrôle, fichiers, fluidité, halo, interface, bibliothèque, menus, Replay, réglages, aperçu des sources, minuteurs |
| Audits npm et RustSec | Réussis avec les réserves RustSec décrites ci-dessus |
| Formatage Rust | Échec, 48 fichiers concernés |
| Clippy strict | Échec, sept diagnostics distincts |
| `git diff --check` | Réussi |

Journaux locaux : `.impeccable/check-code-2026-11-03.log`, `.impeccable/rust-final-code-2026-11-03.log`, `.impeccable/browser-code-2026-11-03.log`, `.impeccable/audit-code-2026-11-03.log`, `.impeccable/fmt-code-2026-11-03.log` et `.impeccable/clippy-code-2026-11-03.log`.

Environnement de contrôle : Windows, Node.js 22.16.0, Cargo 1.95.0 et Clippy 0.1.95. Les captures documentaires régénérées par la suite Bibliothèque ont été remises à leur contenu initial après les tests ; leurs versions générées sont conservées dans le dossier local de diagnostic.

Reproduction des deux défauts : `node .impeccable/runtime/probe-code-2026-11-03.mjs`. Résultats dans `.impeccable/runtime/probe-code-2026-11-03.json`. Cette sonde emploie l'installation Playwright locale déjà disponible et un pont natif simulé ; elle ne change pas les préférences de l'application installée.

Les tests navigateur utilisent le vrai frontend et un pont natif simulé. Les captures longues, les périphériques réels, les écrans à DPI mixtes, l'installation et la CSP du binaire release n'ont pas été validés par cette revue. La lecture ciblée du code et les tests ne garantissent pas l'absence de tout autre défaut.
