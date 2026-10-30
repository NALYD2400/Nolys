# Suivi du chantier complet Nolys

Autorisation : « tu peut tout faire ». Commit préalable : `4fbe5eb` ; base précédente `97d2071`.
Périmètre : corrections de l’audit + compléments des modules et idées acceptées dans la conversation ; aucune nouvelle dépendance MCP/SDK.

## Répartition et critères

- [x] Parent — `features/volume.js` : zéro et rafales de molette corrects.
- [x] Parent — `shared/safe-storage.js`, démarrage et thème : JSON invalide ou mauvais type conservé et remplacé par valeurs sûres.
- [x] Parent — stockage/import/export des Réglages : validation, transaction/retour arrière, sauvegarde complète versionnée, récupération et réinitialisation par page.
- [x] Parent — `shared/settings-store.js`, interface Réglages : enregistrement visible, réessai, aucun écrasement silencieux après erreur.
- [x] Parent — `island/layout.rs`, commandes et navigation : vue ouverte repositionnée dans la zone de travail, position compacte conservée.
- [x] timers — modèle temporel pur, `system.js`, `loops.js`, `timer.css` : temps écoulé réel, veille/reprise, plusieurs minuteurs nommés, état persistant, édition clavier/CSP.
- [x] timers — `controls.jsx`, centre de contrôle et micro : navigation clavier et valeurs ARIA utilisables.
- [x] files_library — `platform/http.rs`, `wallpaper/*` : délais, plafond d’octets et verrou limité à la publication.
- [x] Parent + replay — `lib.rs`, `updater.rs` : arrêt commun avant installation et état public sans copie d’installeur.
- [x] files_library — `files/*`, `library/*` JS/Rust : sélection cumulative native, liste complète, retrait individuel, réessai des échecs, préférences et rétention sans supprimer exports.
- [x] files_library — réparation d’historique conservant original ; annulation import musical ; Cloud Files distingués des liens ; nettoyage sûr des pochettes orphelines.
- [x] replay — `replay/*` JS/Rust et vue : recherche/tri/filtres/pages/sélection multiple, index complet/relocalisation, récupération guidée des fragments conservés.
- [x] replay — quota et usage cache JPEG ; aperçu de source et vérification audio à la demande sans capture automatique.
- [x] Parent — confidentialité : recherches de pochettes désactivables, icônes sans requêtes cachées.
- [x] Parent — mesures absentes explicitement indisponibles, suppression des valeurs fictives.
- [x] Parent — diagnostics expurgés, aide de première utilisation, profils micro par appareil et espace utilisé par caches/exports.
- [x] Parent — commande de vérification commune et CI ; état des dépendances npm/Rust documenté.
- [x] Intégration — commandes Tauri enregistrées uniquement par le parent dans `lib.rs`, aucun agent ne crée de commit.
- [x] Validation — tests ciblés significatifs, compilations UI/Rust, tests navigateur sur modules et erreurs ; matrice Windows matérielle distincte, pas de certification sans essai.

## Coordination

Agents : `/root/files_library`, `/root/replay`, `/root/timers`. Ils modifient uniquement leurs modules attribués et transmettent leurs contrats de commandes au parent. Le parent gère Réglages, démarrage, intégration native, mise à jour et vérification d’ensemble. Aucun déplacement ou effacement d’original utilisateur. Toute opération destructive offerte dans l’app demande une action explicite de son utilisateur.

## État

Implémentation des lots terminée. Le checkpoint `dab82f6` conserve aussi tout le chantier avant la correction demandée ensuite sur le menu déroulant Replay. La vérification finale rassemble les tests JS/Rust et les parcours Edge ; les essais matériels restent séparés et ne sont pas cochés comme accomplis.

Le menu Replay natif a été remplacé par une liste bornée dans la capsule : les titres de fenêtres très longs ne déterminent plus sa largeur. Le nouveau parcours vérifie les titres externes, le choix souris/clavier et Échap. Un défaut de focus après désactivation du bouton d’annulation d’import musical a été corrigé pendant cette validation.

Aucun outil de lint ni typecheck JavaScript n’était configuré dans ce projet : la validation disponible combine le build Vite, les tests JS et la vérification de types Rust par compilation. La relecture finale couvre la validation des entrées, l’échappement des titres externes, les erreurs de persistance, les courses d’arrêt et la conservation des originaux. Aucun fichier n’a franchi 1 000 lignes dans ce chantier. Pas de publication ni de changement d’auteur/licence des fondations tierces.


## Résultats finaux

- 77 tests JavaScript réussis ; aucun échec ni test JS ignoré.
- 82 tests Rust réussis ; 6 ignorés par défaut (matériel, Corbeille ou moteur explicite). Aucune nouvelle erreur de compilation.
- Build Vite réussi ; avertissements existants sur les sélecteurs Shadow DOM `:host-context` conservés et documentés.
- 7 suites Edge réussies via `npm run check:browser` avec serveur isolé sans HMR : accessibilité, Fichiers, Bibliothèque, Menus, Replay, Réglages et Minuteurs.
- Les 13 modes et 11 pages des Réglages sont parcourus ; les dimensions natives sont testées par calcul sur bords/petites zones/échelles multiples. Aucun essai physique multi-écran prétendu.
- `npm run check:audit` réussi : 0 vulnérabilité npm, 0 vulnérabilité RustSec ; 6 avertissements Rust informatifs conservés sans exclusion.
- `git diff --check` réussi. Aucun installateur publié et aucune capture personnelle effectuée.

Voir [le bilan détaillé](bilan-corrections-2026-10-30.md), [la vérification reproductible](verification.md) et [la provenance des dépendances](dependances-et-provenance.md).
