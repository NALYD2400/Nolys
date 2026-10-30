# Suivi du chantier complet Nolys

Autorisation : « tu peut tout faire ». Commit préalable : `4fbe5eb` ; base précédente `97d2071`.
Périmètre : corrections de l’audit + compléments des modules et idées acceptées dans la conversation ; aucune nouvelle dépendance MCP/SDK.

## Répartition et critères

- [ ] Parent — `features/volume.js` : zéro et rafales de molette corrects.
- [ ] Parent — `shared/safe-storage.js`, démarrage et thème : JSON invalide ou mauvais type conservé et remplacé par valeurs sûres.
- [ ] Parent — stockage/import/export des Réglages : validation, transaction/retour arrière, sauvegarde complète versionnée, récupération et réinitialisation par page.
- [ ] Parent — `shared/settings-store.js`, interface Réglages : enregistrement visible, réessai, aucun écrasement silencieux après erreur.
- [ ] Parent — `island/layout.rs`, commandes et navigation : vue ouverte repositionnée dans la zone de travail, position compacte conservée.
- [ ] timers — modèle temporel pur, `system.js`, `loops.js`, `timer.css` : temps écoulé réel, veille/reprise, plusieurs minuteurs nommés, état persistant, édition clavier/CSP.
- [ ] Parent — `controls.jsx`, centre de contrôle et micro : navigation clavier et valeurs ARIA utilisables.
- [ ] Parent — `platform/http.rs`, `wallpaper/*` : délais, plafond d’octets et verrou limité à la publication.
- [ ] Parent — `lib.rs`, `updater.rs` : arrêt commun avant installation et état public sans copie d’installeur.
- [ ] files_library — `files/*`, `library/*` JS/Rust : sélection cumulative native, liste complète, retrait individuel, réessai des échecs, préférences et rétention sans supprimer exports.
- [ ] files_library — réparation d’historique conservant original ; annulation import musical ; Cloud Files distingués des liens ; nettoyage sûr des pochettes orphelines.
- [ ] replay — `replay/*` JS/Rust et vue : recherche/tri/filtres/pages/sélection multiple, index complet/relocalisation, récupération guidée des fragments conservés.
- [ ] replay — quota et usage cache JPEG ; aperçu de source et vérification audio à la demande sans capture automatique.
- [ ] Parent — confidentialité : recherches de pochettes désactivables, icônes sans requêtes cachées.
- [ ] Parent — mesures absentes explicitement indisponibles, suppression des valeurs fictives.
- [ ] Parent — diagnostics expurgés, aide de première utilisation, profils micro par appareil et espace utilisé par caches/exports.
- [ ] Parent — commande de vérification commune et CI ; état des dépendances npm/Rust documenté.
- [ ] Intégration — commandes Tauri enregistrées uniquement par le parent dans `lib.rs`, aucun agent ne crée de commit.
- [ ] Validation — tests ciblés significatifs, compilations UI/Rust, tests navigateur sur modules et erreurs ; matrice Windows matérielle distincte, pas de certification sans essai.

## Coordination

Agents : `/root/files_library`, `/root/replay`, `/root/timers`. Ils modifient uniquement leurs modules attribués et transmettent leurs contrats de commandes au parent. Le parent gère Réglages, démarrage, intégration native, mise à jour et vérification d’ensemble. Aucun déplacement ou effacement d’original utilisateur. Toute opération destructive offerte dans l’app demande une action explicite de son utilisateur.

## État

Analyse transversale et répartition terminées. Exécution autorisée par la demande globale de l’utilisateur ; l’exigence du commit avant modification est satisfaite. Les fichiers de suivi remplacent les outils TaskCreate indisponibles dans cet environnement.
