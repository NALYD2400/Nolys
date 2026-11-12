# Audit final de Nolys — 6 novembre 2026

Audit de l’arbre de travail local après `36f5309` (version publiée 2.6.6). Les corrections de cet audit sont locales : aucun commit, installateur ou publication supplémentaire n’a été créé.

## Résultat

Aucun échec de vérification ne reste ouvert dans le périmètre exécuté. L’audit a permis de corriger cinq cas limites de l’interface et un défaut du serveur HTTP de test. Il reste des avertissements de maintenance et des scénarios matériels non exécutés ; ce rapport ne certifie pas une absence universelle de bugs.

## Corrections effectuées pendant cet audit

| Constat | Correction et preuve |
|---|---|
| Glisser interrompu par Échap, perte de capture ou de focus | Nettoyage des écouteurs et de la capture, fin unique du glisser, annulation de la frame en attente. Le cœur natif ignore début/mouvement/flèches hors du mode placement et termine le glisser avant d’en sortir. Régression navigateur avec vraie séquence souris + Échap, puis vérification native des commandes tardives. |
| Débordement de Fichiers dans une fenêtre étroite sans coordonnées natives | Largeur de secours responsive ; cadre de 1080 px réservé au cas où le viewport natif est effectivement connu. Le parcours Fichiers repasse avec ses réductions de fenêtre à 520 et 640 px ; les positions natives conservent leur cadre fixe. |
| Fermeture de Fichiers après une ouverture depuis le clic droit ou un raccourci | L’état d’origine est mémorisé avant l’ouverture. Les deux lanceurs retrouvent la capsule compacte ; une ouverture depuis une vue déjà dépliée peut toujours revenir à cette vue. Régressions ajoutées au parcours Fichiers. |
| Menu des modules écrasé près du bord inférieur | Dimensions calculées à partir de la zone utile du moniteur et de l’échelle choisie, plutôt que du seul espace sous la capsule. Même hauteur vérifiée en haut et en bas, en navigateur et dans le binaire Windows. |
| Module demandé pendant un repli | L’état déplié est appliqué dans la transition mise en attente, en même temps que le changement de mode. Le test reproduisant l’ouverture de Contrôle pendant le repli échoue avant correction et réussit ensuite. |
| Test HTTP local intermittent sous Windows | La connexion acceptée est explicitement remise en mode bloquant avant la lecture bornée des en-têtes. Le client HTTP applicatif reste inchangé. Suite Rust complète réussie, puis cinq passages consécutifs du test réseau. |

## Vérifications exécutées

| Vérification | Résultat |
|---|---|
| Tests JavaScript | 91 réussis, aucun échec. |
| Tests Rust standards | 93 réussis, 7 ignorés par défaut. |
| Deux tests Rust vidéo opt-in | Réussis avec le FFmpeg embarqué : miniature décodable/cache/invalidation ; récupération de vidéos synthétiques complètes et tronquées avec conservation des sources. Total exécuté : 95 tests Rust distincts réussis. |
| Parcours navigateur | 13 suites réussies : Accessibilité, Contrôle, Fichiers, Fluidité, Halo, Interface, Bibliothèque, Menus, Placement, Replay, Réglages, Aperçu source et Minuteurs. Après les corrections, les parcours touchés ont été rejoués, dont Fichiers, Menus, Contrôle et l’interruption du placement. |
| Compilation | Interface Vite et exécutable Windows à ressources embarquées construits. |
| Clippy, tous les targets du projet | Réussi avec sept avertissements de code existants : fonction inutilisée, simplifications et position de modules de tests. Aucun ajout d’ignore pour masquer une erreur. |
| Audit npm | Aucune vulnérabilité signalée. |
| Audit RustSec | Aucune vulnérabilité bloquante signalée ; sept avertissements informatifs détaillés ci-dessous. |
| Contrôle de diff | Aucune erreur d’espacement détectée. |

Les parcours navigateur utilisent le vrai frontend et un pont Windows simulé. Les erreurs synthétiques affichées pendant les tests de refus/réessai de Contrôle sont intentionnelles : les résultats de ces scénarios sont réussis, sans erreur JavaScript non traitée.

## Vérifications Windows sur les ressources embarquées

Instance séparée, données et profil WebView isolés ; aucune publication ni modification des données de l’utilisateur. Le binaire de diagnostic utilise le profil de compilation debug et `tauri/custom-protocol`. Le code de Tauri 2.12.1 sélectionne la CSP de production quand cette fonctionnalité est active : ces essais n’utilisent pas le serveur Vite.

- **32 ouvertures/replis à 150 %** : Musique, Menu des modules, Contrôle, Retour micro, Minuteur, Bibliothèque, Réglages et Fichiers, aux quatre coins du moniteur. Les vues restent dans la zone utile, la configuration enregistrée est conservée et la capsule revient à son ancrage compact. Écart du halo mesuré : 0 px sur ces états stabilisés. Le menu des modules garde la même hauteur aux quatre coins. Aucune erreur UI non traitée relevée.
- **Placement à 65 %, 100 % et 150 %**, depuis le bouton Déplacer du vrai menu : déplacement mesuré nul à l’entrée et au relâchement ; écart maximal de 0,008 px pendant la validation avec aperçu ouvert ; écart maximal du halo de 0,016 px. Haut et bas accessibles selon la limite de bande visible. Le satellite micro garde sa taille et son espacement proportionnels.
- **Commandes tardives** : début/mouvement/fin et déplacement clavier envoyés hors du mode placement ne changent pas la configuration.
- **CSP embarquée** : styles HTML des vues appliqués (sonde de 137 × 19 px) ; script en ligne bloqué avec violation `script-src-elem`, aucune violation de style. Le script de sonde ne s’exécute pas.
- Le contrôle natif du menu clic droit, exécuté avant les derniers ajustements de navigation, couvrait aussi douze positions (quatre coins × trois échelles), 38 raccourcis puis un menu minimal : déplacement nul à l’ouverture/fermeture et position enregistrée conservée. Ces derniers ajustements ne changent pas le calcul du menu clic droit.

Les essais d’ancrage au relâchement utilisent un déplacement clavier suivi du début et de la fin du glisser, avec curseur Windows immobile. Ils sont complétés par le calcul de delta absolu testé en Rust et par les séquences de souris du navigateur ; ils ne constituent pas un essai manuel complet sur tous les écrans.

## Avertissements de dépendances

RustSec remonte cinq paquets non maintenus (`paste`, `proc-macro-error`, `zbus_names`, `zvariant`, `zvariant_derive`), un avis d’unsoundness sur `glib` et un paquet retiré du registre (`async-executor`).

Le graphe `cargo tree --target x86_64-pc-windows-msvc` confirme que six de ces paquets ne font pas partie du graphe Windows. `paste` reste une dépendance de compilation de `lofty`, utilisée pour ses macros ; sa maintenance est un point de suivi, pas une vulnérabilité d’exécution démontrée de Nolys. Aucun lockfile ni règle d’ignore de sécurité n’a été modifié pendant cet audit.

Sources primaires consultées : [avis RustSec sur glib](https://rustsec.org/advisories/RUSTSEC-2024-0429.html), [arrêt de maintenance de paste](https://rustsec.org/advisories/RUSTSEC-2024-0436.html). Les autres avertissements proviennent de la base RustSec récupérée par l’outil d’audit le jour du contrôle.

## Limites et vérifications restantes

Cinq tests opt-in n’ont pas été exécutés : ouverture des vrais périphériques micro/sortie (deux tests), capture réelle du bureau, préflight avec source de capture réelle, aller-retour dans la Corbeille Windows. Les deux tests vidéo purement synthétiques ont, eux, été exécutés.

Restent aussi à vérifier sur matériel : déplacement entre moniteurs à DPI différents, débranchement d’écran/périphérique, veille/reprise, capture longue avec audio et consommation CPU/GPU/mémoire sur une longue durée. Les parcours de fluidité vérifient des invariants ciblés ; ils ne remplacent pas un profilage prolongé.

Le nouvel installateur signé, son installation et la mise à jour depuis une ancienne version n’ont pas été construits/testés pendant cet audit. La CSP a été contrôlée sur le binaire à ressources embarquées décrit ci-dessus.

## Journaux locaux

Les journaux et fixtures de diagnostic sont conservés dans le dossier ignoré `.impeccable/runtime/`, préfixe `final-audit-` : audits des dépendances et graphes Windows, tests JS/Rust/HTTP, parcours navigateur, Clippy, construction, 32 vues natives, CSP et placement natif. Les premiers passages en échec restent dans les journaux ; ce rapport distingue leurs causes et les contrôles réussis après correction.
