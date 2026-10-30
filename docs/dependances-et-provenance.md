# Dépendances et provenance de Nolys

## Retrait du 30 octobre 2026

Le commit `29f31cb` sauvegarde l’état précédant ce nettoyage. Le paquet `@glass-sdk/liquid-glass` était encore déclaré, mais n’était plus importé par le code applicatif. Son retrait avec npm a supprimé 27 paquets, notamment sa chaîne VGPU/MCP/Zod. Aucune copie de ces bibliothèques n’a été déplacée dans le code de Nolys.

L’interface actuelle utilise les composants HTML/CSS présents dans le projet. Le nettoyage ne remplace pas le rendu actuel et ne constitue pas une réécriture de React ou du moteur natif. L’audit complet daté du même jour décrit l’état antérieur au retrait : ses alertes npm ne représentent plus l’arbre installé après ce nettoyage.

## Composants tiers conservés et identifiés

| Composant | Rôle |
|---|---|
| React et React DOM | Affichage et état des pages de Réglages. |
| Vite et son plugin React | Construction de l’interface et serveur de développement. |
| Tauri, ses plugins et WebView2 | Fenêtre Windows, pont JavaScript/Rust, raccourcis et mise à jour. |
| Bibliothèques Rust de `src-tauri/Cargo.toml` | Sérialisation, images, tags musicaux, synchronisation, dialogues et accès Windows. |
| FFmpeg | Capture/encodage vidéo et génération des vignettes Replay. |
| RNNoise via `nnnoiseless` | Réduction de bruit du retour micro. |
| Phosphor | Polices d’icônes présentes dans les ressources. |
| Inter, Outfit et Fira Code | Polices présentes dans les ressources ; leur présence ne signifie pas que chaque police est utilisée partout. |
| Iconify, Deezer, iTunes et Open-Meteo | Services réseau référencés pour des icônes, pochettes de secours ou la météo. |

Les versions exactes sont conservées dans `package-lock.json` et `src-tauri/Cargo.lock`. Les licences et auteurs des composants conservés restent ceux de leurs projets respectifs. L’utilisation de ces composants ne permet pas de présenter chaque ligne et chaque ressource du produit comme écrite ou créée par l’auteur de Nolys.

Le composant MCP transitif supprimé n’était pas la connexion MCP de l’assistant de développement : les outils de l’assistant et les dépendances de l’application sont deux environnements différents.

## Audit et corrections du chantier du 30 octobre 2026

`npm audit --json` sur le graphe nettoyé donne **0 vulnérabilité** parmi les 56 dépendances recensées par npm (dont les paquets de développement et optionnels). Ce résultat remplace l’ancien constat des quatre entrées élevées MCP/Zod ; ce retrait avait déjà eu lieu avant ce chantier. Aucun `npm audit fix --force` n’a été exécuté.

`cargo-audit` 0.22.2 a été installé comme outil isolé dans `.impeccable/runtime/audit-tools`, sans ajout au graphe applicatif. La base RustSec contient 1 395 avis au commit `2295466c4e9df26647fd67d8fa1c705ac2fc7f81` (mise à jour du 30 octobre 2026). L’analyse initiale du lockfile complet, toutes cibles confondues, trouvait **9 avis de vulnérabilité** et **7 avertissements informatifs**, pour 565 entrées. Ce sont des correspondances de versions ; une exploitation de Nolys n’a pas été démontrée.

| Composant initial | Avis exacts et portée | Correction conservée |
|---|---|---|
| rustls 0.23.45 | [2026-0346](https://rustsec.org/advisories/RUSTSEC-2026-0346.html) : secrets dans certains `Debug` ; [0347](https://rustsec.org/advisories/RUSTSEC-2026-0347.html) : données après refus ECH ; [0348](https://rustsec.org/advisories/RUSTSEC-2026-0348.html) : allocation Brotli ; [0349](https://rustsec.org/advisories/RUSTSEC-2026-0349.html) : prédiction du groupe d’échange. Les conditions de chaque avis restent distinctes. | Patch 0.23.46 dans Cargo.lock. Chaîne Windows : plugin updater → reqwest/rustls. |
| rustls-webpki 0.103.15 | [2026-0382](https://rustsec.org/advisories/RUSTSEC-2026-0382.html) : intermédiaires emSign désormais non fiables. | Patch 0.103.16. |
| webpki-root-certs 1.0.9 | [2026-0383](https://rustsec.org/advisories/RUSTSEC-2026-0383.html) : racine emSign correspondante. | Patch 1.0.10. |
| zip 4.6.1 | [2026-0367](https://rustsec.org/advisories/RUSTSEC-2026-0367.html), [0368](https://rustsec.org/advisories/RUSTSEC-2026-0368.html), [0369](https://rustsec.org/advisories/RUSTSEC-2026-0369.html) : permissions Unix et liens pendant extraction ; correctif annoncé à partir de 9.0.0. | Fonction optionnelle `zip` désactivée dans le même plugin updater 2.13.2 ; TLS Rustls et proxy système conservés. Nolys Windows distribue un installateur **NSIS `.exe` direct**, confirmé par tauri.conf et verify-release.mjs. Le plugin conserve son installation `.exe` et n’extrait plus d’archives ZIP. Aucun passage à Tauri 3 alpha ni remplacement local de zip. |
| tokio 1.53.2 | [2026-0386](https://rustsec.org/advisories/RUSTSEC-2026-0386.html), avertissement `unsound` concernant `io::unix::AsyncFd`. | Patch 1.53.3 ; pas d’appel Unix concerné dans l’application Windows. |

Après ces changements, `npm run check:audit` réussit : **0 vulnérabilité npm et 0 vulnérabilité RustSec**, avec **6 avertissements Rust informatifs encore visibles**, pour 562 entrées du lockfile. Aucun avis n’est ignoré ou masqué dans une configuration d’audit.

| Avertissement conservé | Version et chemin | Suivi |
|---|---|---|
| [RUSTSEC-2024-0436](https://rustsec.org/advisories/RUSTSEC-2024-0436.html), non maintenu | paste 1.0.15 ← lofty 0.25.4 ← Nolys ; présent dans le graphe Windows. | Suivre la migration amont de Lofty. Aucune vulnérabilité précise n’est annoncée par cet avis de maintenance. |
| [RUSTSEC-2024-0370](https://rustsec.org/advisories/RUSTSEC-2024-0370.html), non maintenu | proc-macro-error 1.0.4 ; absent du graphe `x86_64-pc-windows-msvc`. | Maintenu dans le lockfile des autres cibles transitives ; ne pas forcer une nouvelle API de macros dans le socle. |
| [RUSTSEC-2026-0371](https://rustsec.org/advisories/RUSTSEC-2026-0371.html), [0370](https://rustsec.org/advisories/RUSTSEC-2026-0370.html), [0372](https://rustsec.org/advisories/RUSTSEC-2026-0372.html), non maintenus | zbus_names 4.3.4, zvariant 5.15.0, zvariant_derive 5.15.0 ; absents du graphe Windows. | Les remplacements appartiennent aux nouvelles API D-Bus amont, utilisées par d’autres cibles. |
| [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html), `unsound` | glib 0.18.5 ; absent du graphe Windows, correctif amont ≥0.20.0. | Reste un problème connu des cibles GTK ; Nolys cible Windows. Ne pas présenter le lockfile toutes plateformes comme entièrement exempt de problèmes. |

Reproduction et CI : [docs/verification.md](verification.md). Les rapports JSON locaux complets sont conservés sous `.impeccable/runtime/cargo-audit-2026-10-30.json` et `cargo-audit-after-2026-10-30.json`, hors Git. Un audit mesure les avis connus de sa base au moment du contrôle ; il ne certifie ni le binaire FFmpeg tiers ni l’absence d’erreurs applicatives. Les tests réels d’installation, de capture longue et d’appareils restent distincts.

## Étape suivante à définir

Pour réduire davantage les dépendances, une décision séparée est nécessaire : remplacer seulement les ressources et services externes, réécrire les Réglages sans React, ou changer également le socle natif. Ce nettoyage ne présume pas cette décision. Une réécriture complète doit conserver les fonctions actuelles et faire l’objet d’un état sauvegardé avant modification.
