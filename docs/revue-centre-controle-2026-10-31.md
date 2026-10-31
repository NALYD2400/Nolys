# Revue du centre de contrôle Nolys — 31 octobre 2026

Method: dual-agent (A: /root/control_design_review · B: /root/control_functional_review)

Revue de l’interface, de ses actions et de leur cohérence avec Nolys, suivie des corrections. Les choix visuels ont été affinés selon les retours de l’utilisateur : réglage intégré au widget, accès au mélangeur en en-tête, pourcentage du volume sans fond noir.

## Verdict

Le centre conserve la capsule sombre, les formes arrondies et les accents cuivrés de Nolys. Il est maintenant plus cohérent avec le reste de l’app. Le principal problème initial était fonctionnel : plusieurs commandes visibles ne recevaient jamais leur clic, et certaines tuiles pouvaient annoncer un état différent de celui du système.

La structure reste pertinente : commandes système, lecture en cours, widget personnel et volume permanent. L’accès aux réglages est contextuel. Les libellés distinguent désormais les alertes Windows, le focus de Nolys et le retour micro.

## Avant / après

| Élément | Avant | Après |
|---|---|---|
| Réglages, modules, lecture et mute du mini-mélangeur | Clic arrêté par le conteneur avant les gestionnaires communs | Actions transmises correctement, y compris au clavier |
| Wi-Fi, Bluetooth et alertes | Lectures doublées ; une ancienne réponse pouvait annuler l’état affiché | Lecture unique, action en attente, confirmation du système, réponses obsolètes ignorées |
| Radio absente ou verrouillée | État peu clair et bouton encore utilisable | État explicite, commande désactivée, récupération lors d’un prochain sondage |
| Retour micro | Une écriture refusée pouvait laisser le faux état optimiste | Relecture ou restauration de la dernière configuration confirmée, message visible |
| Mini-mélangeur | Applications anonymes ; volume clavier sans effet ; mute non focalisable | Noms, curseurs nommés, vrai bouton mute, réglage clavier envoyé au système |
| Échec des sessions audio | Chargement permanent | État indisponible, réessai, conservation du bouton lors des sondages en échec |
| Anciennes mesures et lectures de volume | Réponses tardives susceptibles de remplacer un nouvel affichage | Portée limitée au conteneur d’origine et protection des écritures plus récentes |
| DND / Micro / Éteindre | Portée ambiguë ou incorrecte | Alertes PC / Retour micro / Quitter Nolys, avec explication de leur portée |
| Confirmation de fermeture | Pas de rôle de dialogue, de gestion du focus ni d’Échap | Dialogue nommé, focus initial sur Annuler, cycle Tab, Échap, retour au déclencheur |
| Réglage du widget | Texte isolé sous la carte | Icône de réglage dans l’en-tête de la carte, nom accessible et infobulle |
| Tous les flux | Petit bouton isolé en bas à droite | Accès en haut du mélangeur, avec nombre de flux et flèche de navigation |
| Volume système | Pourcentage sur un rectangle noir | Texte sans fond, contraste adapté au remplissage clair ou sombre |
| Raccourcis | Icônes seules, puis noms par défaut tronqués | Libellés courts visibles et noms complets accessibles |
| Météo | Configuration et erreur difficiles à résoudre | Réglage de ville et réessai dans l’en-tête, réponse d’une ancienne ville ignorée |

## Matrice des actions examinées

| Zone | Actions et états contrôlés | Résultat / portée |
|---|---|---|
| En-tête | Réglages, menu des modules | Navigation fonctionnelle ; réglages ouverts sur Centre de contrôle |
| Fermeture | Ouvrir, annuler, Échap, Tab, confirmer | Dialogue accessible ; une seule commande de sortie simulée |
| Wi-Fi / Bluetooth | Lecture, activation, refus, absence, clics répétés, réponse tardive | Affichage confirmé, erreurs et indisponibilité gérées |
| Alertes PC | Lecture et bascule | Pilote l’interrupteur global des notifications Windows, distinct de son mode Ne pas déranger |
| Focus Nolys / Économie | Bascule, persistance, réouverture | État et préférence cohérents avec les fonctions de Nolys |
| Retour micro | Bascule, ouverture du module, refus d’écriture | Retour d’écoute uniquement ; ne promet pas de couper le micro dans les autres applications |
| Lecture en cours | Précédent, lecture/pause, suivant | Commandes vers le lecteur local ou le média système selon la source |
| Volume système | Souris, flèches, début/fin, zéro, erreur, ancienne lecture rejetée | Valeur et ARIA cohérentes ; commandes limitées pendant le glissement |
| Raccourcis | Commandes Windows autorisées, raccourci Lecteur, refus de lancement | Exécution ou navigation ; erreur visible en cas d’échec |
| Performance | CPU/RAM disponibles, zéro, indisponibilité | Mesures réelles de la passerelle ou tiret ; pas de faux zéro |
| Batterie et disque | Secteur, batterie indisponible, disque, navigation pendant une lecture | Valeurs ou tiret ; ancienne carte sans effet sur la nouvelle |
| Météo | Ville absente, configurée, longue, échec, réessai, réglage | Présentation contenue et récupération disponible |
| Mélangeur | Volume souris/clavier, mute, nouveaux flux, liste vide, panne, réessai, liste complète | Trois applications au maximum dans l’aperçu, nombre total et accès au module complet |
| Réglages du centre | Cinq widgets, ville, raccourcis, préférences | Persistance et rendu à la réouverture vérifiés dans la revue ; parcours des réglages couvert aussi par la suite générale |

Les essais d’interface utilisent une passerelle Tauri simulée : aucune radio, sortie audio, entrée micro ni fermeture réelle de l’application n’a été déclenchée.

## Évaluation UX

Échelle de Nielsen : 0 à 4 par critère. Cette appréciation est une revue experte, pas une mesure issue d’utilisateurs réels. La contre-revue attribue **30/40**, contre **25/40** initialement. Les dernières demandes visuelles ne donnent pas lieu à une hausse artificielle de la note.

| Critère | Avant | Après | Constat |
|---|---:|---:|---|
| État du système visible | 3 | 3 | Confirmation, attente et erreurs explicites |
| Correspondance avec l’action réelle | 2 | 3 | Alertes PC, Retour micro et Quitter Nolys clarifiés |
| Contrôle et liberté | 2 | 3 | Annulation et clavier du dialogue réparés |
| Cohérence | 3 | 3 | Palette Nolys et en-têtes intégrés aux widgets |
| Prévention des erreurs | 3 | 3 | Commandes en attente protégées et états indisponibles désactivés |
| Reconnaissance | 2 | 3 | Noms d’applications et raccourcis visibles |
| Efficacité | 3 | 3 | Curseurs clavier et accès au mélangeur complet |
| Sobriété visuelle | 3 | 3 | Réglage et navigation regroupés dans les cartes |
| Récupération après erreur | 2 | 3 | Réessai audio/météo et restauration micro |
| Aide contextuelle | 2 | 3 | Infobulles et portée des commandes précisées |
| **Total** | **25/40** | **30/40** | Base solide ; pas une certification d’accessibilité |

Points forts : volume toujours disponible, hiérarchie compacte stable, widget personnel sans multiplier les écrans. Le parcours demande moins d’interprétation : action, attente, résultat ou erreur deviennent distincts.

Risques pour les profils examinés :

- **Usage fréquent** : le mini-mélangeur reste volontairement limité à trois applications ; le lien indique le total et ouvre le module complet.
- **Premier usage / confidentialité** : Retour micro ne coupe pas l’enregistrement des autres logiciels ; Alertes PC agit sur les notifications globales. Ces limites sont maintenant expliquées.
- **Clavier / basse vision** : curseurs et dialogue corrigés, mais interface toujours dense. Une validation réelle NVDA et à grande échelle d’affichage reste distincte.

Observations mineures issues de la revue :

1. **P3 — Ville météo très longue** : le texte tient dans la carte mais reste petit. Une adaptation typographique dédiée pourrait mieux présenter les noms extrêmes (`/impeccable typeset`).
2. **P3 — Mélangeur vide — corrigé lors du suivi** : la capsule suit désormais la hauteur naturelle du contenu. L’espace réservé pour trois applications a été supprimé ; les blocs conservent un écart de 10 px, y compris avec zéro ou un flux. La hauteur réagit aussi à l’ajout et à la disparition de sessions audio. Le curseur système reste aligné avec le bas du widget.

Aucun P0/P1 restant identifié dans les parcours examinés. Les P1 initiaux concernent les actions bloquées, les états asynchrones, le micro et le mélangeur clavier ; ils sont corrigés. Cela ne démontre pas l’absence de défauts hors du périmètre testé.

Le détecteur a renvoyé zéro résultat sur le JSX des réglages et le HTML rendu du centre. Il n’a pas détecté les défauts fonctionnels trouvés par les essais. Aucun faux positif émis. L’injection d’un affichage de diagnostic dans le navigateur intégré était indisponible ; aucune surcouche utilisateur n’est revendiquée.

Questions skipped: 1 Priority Issue mineure restante après le suivi ; corrections demandées et choix d’intégration confiés par l’utilisateur.

Suivi demandé après cette critique : les grands espaces verticaux ont été corrigés pour les cinq widgets, sans nouvelle notation UX. La mesure observe uniquement l’en-tête et la colonne de contenu, ignore les transformations d’entrée et se déconnecte à la fermeture du centre. Les captures de ce suivi sont dans `.impeccable/review/control-spacing-2026-10-31/` ; les parcours et leur résultat sont dans `.impeccable/runtime/control-spacing-browser-2026-10-31.log`.

Validation du suivi : compilation réussie, 21 scénarios du centre de contrôle et suite d’accessibilité réussis. Les cinq widgets présentent des écarts de 10 px et un curseur système aligné. Avec 0 → 1 → 3 → 1 flux, la hauteur observée de la capsule passe par 380 → 383 → 465 → 383 px. Les 17 captures du suivi ne montrent aucun débordement.

Suivi du mode économie : le clic recréait son bouton pendant la propagation de l’événement. La fermeture au clic extérieur voyait ensuite une cible détachée et repliait la capsule à tort. La détection utilise désormais le chemin d’origine du clic et le bouton économie retrouve son focus après actualisation. Un scénario reproduit la fermeture avant correction et vérifie ensuite activation/désactivation à la souris, avec Espace et Entrée, maintien de la vue et du focus, puis fermeture sur un véritable clic extérieur. Logs : `.impeccable/runtime/control-eco-before-2026-10-31.log` et `control-eco-after-2026-10-31.log`.

## Validation et preuves

- `npm run check` : 80 tests JavaScript, compilation Vite réussie, 89 tests Rust réussis, 6 tests matériels ignorés.
- `tools/tests/control-center.browser.cjs` : 20 scénarios principaux et 2 cas asynchrones supplémentaires, sans erreur JavaScript non gérée. Ils incluent le dimensionnement des cinq widgets et les bascules du mode économie à la souris et au clavier.
- Captures finales : 17 états à 720 × 600, cinq widgets, erreurs, contenu long, dialogue et réglages ; aucun contrôle en dehors de la capsule.
- Captures : `.impeccable/review/control-design-final-2026-10-31/`.
- Résultats détaillés : `.impeccable/runtime/control-center-browser-results.json` et `control-center-browser-results-edges.json`.
- `npm run check:browser` : neuf suites réussies (accessibilité, centre de contrôle, fichiers, fluidité, bibliothèque, menus, Replay, réglages et minuteries). Résultat conservé dans `.impeccable/runtime/controle-final-browser-2026-10-31.log`.

Les essais Edge et les tests Rust ne remplacent pas une manipulation matérielle de la version Windows : radio réelle, permissions Windows, écoute du retour micro, lecteur d’écran et binaire final WebView2 restent à valider séparément. Aucun engagement de performance native chiffrée n’est déduit des captures.

Références du contrat Windows consultées : [Radio.SetStateAsync](https://learn.microsoft.com/en-us/uwp/api/windows.devices.radios.radio.setstateasync?view=winrt-26100), [notifications et Ne pas déranger](https://support.microsoft.com/en-us/windows/experience/notifications-and-do-not-disturb-in-windows?pp=env).
