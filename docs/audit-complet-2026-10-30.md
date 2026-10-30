# Audit transversal de Nolys — 30 octobre 2026

## Conclusion

L’architecture est déjà compartimentée et protège bien plusieurs opérations sensibles : exports sans écrasement, écritures atomiques pour la bibliothèque et les travaux Fichiers, validation des paramètres Replay, limite du tampon vidéo et isolation des grandes vues. Les parcours nominaux testés dans cette conversation fonctionnent.

Les faiblesses les plus urgentes concernent les valeurs limites, les données corrompues, le temps réel et l’ouverture près des bords de l’écran. Un passage réussi sur les pages au centre de la fenêtre ne couvre pas ces cas. **20 constats retenus : 5 P1, 14 P2 et 1 P3. Aucun P0 démontré.** P1 = correction prioritaire ; P2 = correction planifiée ; P3 = amélioration de maintenance.

Cet audit porte sur l’état de travail présent, y compris les modifications de la passe précédente, après le commit repère `1642ae6`. Il ne modifie pas le code applicatif. Il ne certifie pas l’absence de défauts dans toutes les fonctions et configurations matérielles.

## Méthode et preuves

- Lecture des vues, du stockage, du pont Tauri, des permissions et de la CSP, des modules Windows/audio, de Replay, de Fichiers, de la bibliothèque, de la synchronisation du fond d’écran et de la mise à jour.
- Nouvelle exécution des tests : **50 tests JavaScript réussis ; 52 tests Rust réussis et 5 ignorés par défaut** (matériel ou moteur explicite). Les suites navigateur des 13 modules et 11 pages de Réglages réussies plus tôt dans cette conversation constituent les preuves des parcours nominaux ; elles n’ont pas toutes été rejouées pour ce rapport.
- Sondes supplémentaires dans Edge avec vrai frontend et pont natif simulé : volume zéro, stockage corrompu, données de profil invalides, navigation au clavier, interruption du thread UI, et politique de scripts de la release. Les sondes ne lancent aucune capture du bureau ou du micro et ne changent pas le volume Windows.
- Résultats locaux reproductibles dans `.impeccable/runtime/full-audit-probes.json` et script associé, ignorés dans Git. La sonde du minuteur recrée ses boutons après application de la politique de scripts : conserver un gestionnaire déjà compilé aurait donné un faux résultat.
- `npm audit --json` et contrôle du graphe de dépendances installées. `cargo audit` n’est pas installé : aucune conclusion n’est fournie sur les avis de sécurité transitifs Rust.
- Détecteur Impeccable : 14 signalements `bounce-easing`. Les ressorts font partie de l’identité existante ; ces conseils esthétiques ne sont pas comptés comme 14 défauts. Aucun nouvel ignore n’est ajouté. Le détecteur résout mal deux liens de feuilles `/assets/...` : son analyse de couleurs est incomplète. La conformité des contrastes n’est donc pas déclarée.

### Évaluation indicative de l’interface

| Dimension | Note / 4 | Motif |
|---|---:|---|
| Accessibilité | 1 | Tuiles non accessibles au clavier, menus et curseurs personnalisés incomplets. |
| Performance | 2 | Plusieurs limites existent, mais copies volumineuses et historiques croissants ; pas de profilage prolongé. |
| Thème et cohérence | 3 | Identité et socle partagés, réglages utilisateur respectés ; contraste de toutes les combinaisons non mesuré. |
| Adaptation au bureau Windows | 2 | Formats centraux couverts ; ouverture près des bords non protégée par les limites natives. |
| Robustesse de l’implémentation | 2 | Bons garde-fous locaux, mais plusieurs défaillances reproductibles sur erreurs et valeurs limites. |
| **Total indicatif** | **10 / 20** | Priorité à la fiabilité et à l’accessibilité. |

Cette note est un jugement de revue, pas une mesure de performance ni une certification WCAG. Nolys cible le bureau Windows : l’absence d’une interface mobile n’est pas comptée comme un défaut.

## P1 — Corrections prioritaires

### 1. Baisser le volume depuis zéro peut le remonter à 45 %

**Preuve : reproduit.** `src/island/dynamic-island/features/volume.js:10`, branche appelée par `features/events.js:361` lorsque la molette contrôle le volume système. La valeur réelle `0` est remplacée par `50` à cause de `|| 50`. Avec un delta de `-5`, la commande reçoit **45**. Le volume d’application par défaut suit une autre branche ; le constat concerne explicitement le mode système.

**Impact :** son soudain alors que l’utilisateur demande une baisse. **Correction :** distinguer zéro d’une réponse absente, valider le nombre et sérialiser les ajustements rapides. Ajouter un contrôle de régression zéro, 100 et réponse indisponible.

### 2. Un réglage illisible peut empêcher toute initialisation

**Preuve : reproduit.** `src/island/dynamic-island/DynamicIsland.js:76` et `:81`. Les lectures `JSON.parse` du thème et du placement ne sont pas protégées. Mettre `{broken` dans l’une de ces clés provoque une exception et empêche la création des fonctionnalités de l’Island. D’autres lectures similaires existent dans `ThemeService.js`.

**Impact :** application visuellement inutilisable et récupération manuelle nécessaire. **Correction :** lecture tolérante avec validation, conservation de la valeur défectueuse, valeurs par défaut et démarrage d’un écran de récupération. Un JSON syntaxiquement valide de mauvais type, par exemple `null`, doit aussi être traité.

### 3. L’import de réglages accepte des structures qui cassent une vue

**Preuve : reproduit.** `src/settings/state/useSettings.js:119`, `src/settings/state/storage.js:263` et `views/control-center.js:71`. Un profil contenant `settings.shortcuts: [null]` est accepté et enregistré ; le rendu du centre de contrôle échoue ensuite avec `Cannot read properties of null (reading 'name')`. Les valeurs de mauvais type sont également conservées. Cela ne signifie pas que chaque valeur extrême est dangereuse : le nombre effectif de barres du visualiseur est borné ailleurs.

**Impact :** une sauvegarde incompatible ou endommagée peut dégrader durablement l’application. L’import modifie aussi profils/historique avant validation de l’ensemble. **Correction :** valider type et version du document, types et limites de chaque champ, puis appliquer le tout dans une transaction ; conserver une sauvegarde de récupération avant l’import. Aucun besoin de supposer une attaque pour reproduire ce défaut.

### 4. Une grande vue peut s’ouvrir en partie hors de l’écran

**Preuve : déduction directe du calcul de placement, pas essai sur écran physique.** `src-tauri/src/island/layout.rs:131` garde seulement une petite zone de pilule visible. Les dimensions de la vue ouverte ne servent pas à repositionner la fenêtre. À l’extrémité gauche, avec une fenêtre de 720 px et une échelle de 1, la position autorisée est environ `x = -300`. Les Réglages de 680 px commencent alors vers `x = -280` sur l’écran.

**Impact :** boutons et contenu coupés après ouverture près d’un bord, même si le rendu tient parfaitement dans la fenêtre WebView. Le bas de l’écran et les grandes échelles sont également concernés. **Correction :** distinguer position compacte mémorisée et placement temporaire de la vue ouverte, tenir compte de la zone de travail et rétablir la position compacte au repli. Valider avec DPI mixtes et écran débranché.

### 5. Le chrono/minuteur compte les rappels, pas le temps écoulé

**Preuve : reproduit.** `src/island/dynamic-island/features/loops.js:142`. Une interruption volontaire du thread UI pendant 3,2 secondes fait avancer le chrono d’**une seconde seulement**. Le code ajoute ou soustrait exactement un à chaque rappel. La veille et le bridage des rappels sont des cas supplémentaires à tester, non reproduits physiquement ici.

**Impact :** durées inexactes et alarme potentiellement retardée. **Correction :** stocker une origine ou une échéance temporelle, calculer l’affichage à partir de celle-ci, conserver séparément l’état de pause et définir la politique de reprise après veille/redémarrage.

## P2 — Robustesse, accessibilité et maintenance produit

### 6. Personnaliser une durée par clic droit est bloqué par la CSP de release

**Preuve : reproduit dans Edge sous la directive de scripts de release, pas dans un nouvel installateur.** `views/system.js:255` place `oncontextmenu="..."` dans le HTML. `src-tauri/tauri.conf.json` interdit les scripts en ligne en release. La sonde compte une édition avec la politique de développement et zéro après création des boutons sous la politique de release.

**Correction :** événement délégué ou `addEventListener`, et commande de personnalisation également disponible au clavier. Ne pas assouplir la CSP pour contourner ce défaut. Ce cas explique pourquoi un contrôle uniquement dans Vite peut manquer un problème de l’application distribuée.

### 7. Plusieurs fonctions ne sont pas utilisables entièrement au clavier

**Preuve : reproduit et confirmé dans le code.** Les six tuiles Wi-Fi/Bluetooth/DND/Focus/Éco/Micro de `views/control-center.js:179` sont des `div`, sans rôle et avec `tabIndex = -1`. Dans `src/settings/components/controls.jsx:207`, ouvrir un `listbox` garde le focus sur le déclencheur et Flèche bas ne déplace pas la sélection. Les curseurs de volume et de seuil micro de `views/mic-monitor.js` reposent sur des gestes sans commandes clavier équivalentes dans cette vue.

**Correction :** boutons natifs et états `aria-pressed`/switch appropriés ; vrai comportement de liste clavier et restitution du focus ; curseurs natifs ou comportements complets. Catégorie accessibilité : contrôle clavier et nom/rôle/valeur, notamment WCAG 2.1.1 et 4.1.2. Aucune conformité globale n’est prétendue.

### 8. Les téléchargements de pochettes ne sont pas bornés par l’application

**Preuve : code.** `platform/http.rs:15` et `:21` attendent des opérations WinRT et lisent les réponses complètes, sans plafond de taille ni délai/annulation propres à Nolys. `wallpaper/mod.rs:262` garde `apply_lock` pendant le téléchargement et le rendu ; la restauration du bureau prend le même verrou.

**Impact :** un service lent ou une réponse volumineuse peut immobiliser un worker, retarder la restauration du bureau et la fermeture qui l’attend. Les limites internes de Windows ne sont pas mesurées ici. **Correction :** plafond d’octets, délai applicatif, annulation des demandes périmées, décodage image borné et verrou limité à la publication finale. Le module Fichiers possède déjà des limites à prendre comme exemple.

### 9. Installer une mise à jour ne suit pas la fermeture contrôlée des captures

**Preuve : code.** `src-tauri/src/updater.rs:194` restaure le fond d’écran puis lance l’installeur. Le chemin `lib.rs::quit` arrête et attend Replay et Fichiers ; il n’est pas appelé ici, et l’interface de mise à jour ne bloque pas une installation pendant REC.

**Impact potentiel :** l’installeur peut interrompre une capture ou un travail en cours. Les fragments de récupération réduisent le risque mais ne remplacent pas la finalisation. **Correction :** un même coordinateur de fermeture pour Quitter et Installer, avec retour visible pendant la finalisation. L’interruption d’un véritable enregistrement par un installeur n’a pas été exécutée durant cet audit.

### 10. Une sauvegarde de réglages refusée reste invisible à l’utilisateur

**Preuve : code.** `src/shared/settings-store.js:34` capture les erreurs d’écriture avec un simple `console.warn`. L’état local et l’interface continuent comme si les réglages étaient enregistrés. La première reprise d’une session suivante peut rétablir le fichier plus ancien.

**Impact :** perte apparente de préférences après redémarrage, notamment dossier non accessible ou disque plein. **Correction :** état « enregistrement en cours / non enregistré », file de réessai bornée et récupération explicite. Tester un refus disque avec un faux store ou un dossier temporaire, sans remplir le disque réel.

### 11. « Exporter les réglages » ne couvre pas tous les réglages

**Preuve : code.** `useSettings.js:101` appelle `toSnapshot(settings)` sans placement ; `storage.js:220` ne comprend notamment pas la ville météo ni le choix des effets sonores. Les paramètres Replay et retour micro sont gérés séparément et ne sont pas intégrés à cet export.

**Impact :** réinstallation ou migration partielle alors que l’utilisateur pense avoir une sauvegarde complète. **Correction :** expliciter le périmètre et fournir un export versionné de toutes les préférences souhaitées ; bibliothèque et vidéos référencées doivent avoir une stratégie distincte clairement annoncée.

### 12. La recherche de pochettes partage les métadonnées sans choix dédié

**Preuve : code.** `media/cover_lookup.rs:57` envoie artiste et titre à Deezer puis iTunes lorsqu’une recherche de secours est demandée par le suivi média. Ce choix ne dispose pas d’un interrupteur dédié dans les réglages Musique. Des icônes d’applications sont aussi chargées depuis Iconify (`helpers/media-art.js`). Les journaux enregistrent des titres et des chemins locaux.

**Impact :** le fonctionnement n’est pas entièrement hors ligne et certains utilisateurs voudront contrôler ces transmissions ou les traces de diagnostic. **Correction :** réglage « recherches de pochettes en ligne », explication courte des services, mode hors ligne, ressources d’icônes locales et option d’export de diagnostic expurgé. Ce constat ne prétend pas qu’une clé secrète a été divulguée.

### 13. Quatre entrées de dépendances sont signalées à sévérité élevée

**Preuve : audit du registre npm au moment de la revue.** Graphe : `@glass-sdk/liquid-glass@0.0.1 → vgpu@0.5.0 → @modelcontextprotocol/server@2.0.0` et `zod@4.6.5`. npm rapporte quatre entrées élevées ; certaines sont la propagation du même problème à des paquets parents, pas quatre failles indépendantes de Nolys.

**Portée :** l’avis [du SDK MCP](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-jm63-cq47-j5jp) concerne des serveurs HTTP partagés entre clients. Aucun serveur MCP HTTP de Nolys ni chemin exploitable correspondant n’a été trouvé ; les marqueurs recherchés n’ont pas été retrouvés dans les bundles distribués examinés. Il ne faut donc pas présenter cette alerte comme une compromission démontrée de l’application.

**Correction :** mettre à jour ou isoler les dépendances pertinentes, vérifier ce qui est réellement embarqué et intégrer l’audit des dépendances au processus de livraison. Ne pas exécuter `npm audit fix --force` sans revue de compatibilité. Le contrôle des avis Rust reste ouvert, faute de `cargo audit` installé.

### 14. Un historique Fichiers corrompu bloque le module sans parcours de réparation

**Preuve : code et test existant de préservation du manifeste.** `files/mod.rs` conserve le fichier illisible et met `inner.error`; `persist` refuse alors les écritures et `start` refuse les nouveaux travaux. `forget` ne peut pas réparer le journal car son écriture est elle-même refusée.

**Impact :** protection des données correcte, mais usage bloqué jusqu’à une intervention manuelle. **Correction :** action de récupération explicite : conserver l’original, ouvrir son emplacement, reconstruire un journal neuf après choix de l’utilisateur ; proposer un diagnostic et retrouver les exports déjà présents. Ne pas remplacer silencieusement les données corrompues.

### 15. La consommation disque et le coût des historiques n’ont pas de politique globale

**Preuve : code.** Le cache `replay-thumbnails` n’a pas de rétention disque. Les pochettes de bibliothèque sont créées sous `music-covers` sans nettoyage lors des suppressions. Les travaux Fichiers ne sont pas automatiquement bornés ; chaque progression sérialise/publie l’historique complet.

**Impact :** accumulation d’aperçus et coût croissant après une utilisation prolongée. Aucune croissance sur plusieurs semaines n’est mesurée. **Correction :** quotas pour les caches générés, comptage visible, nettoyage des seuls fichiers générés devenus orphelins et pagination de l’historique. Ne pas appliquer une purge automatique aux originaux ou aux clips personnels.

### 16. Certains fichiers de dossiers synchronisés peuvent être ignorés à l’import musical

**Preuve : filtre confirmé, portée Windows à valider sur un vrai dossier synchronisé.** `library/mod.rs:156` ignore sans comptage tous les éléments marqués `0x400` avant de distinguer leurs tags. L’attribut couvre aussi des types Cloud/OneDrive, en plus des liens symboliques. [Documentation Microsoft sur les tags](https://learn.microsoft.com/en-us/windows/win32/fileio/reparse-point-tags).

**Impact potentiel :** import vide ou incomplet selon les attributs réellement exposés à Nolys par Windows. Ce n’est pas une affirmation que tous les dossiers OneDrive échouent. **Correction :** différencier les tags, conserver les protections contre les boucles, rendre compte des éléments ignorés et tester les fichiers disponibles localement et à la demande.

### 17. Les anciens clips sortent de la liste au-delà de 200 sans réindexation

**Preuve : code.** `replay/mod.rs:90` tronque l’historique à 200. Les MP4 restent sur disque et le bouton de dossier permet de les retrouver ; aucune lecture du dossier ne les réintègre dans la liste.

**Impact :** un ancien clip peut sembler disparu et la liste ne constitue pas une vraie bibliothèque complète. **Correction :** rendre la limite explicite, ajouter recherche/pagination et réindexation/relocalisation des clips, en conservant les vidéos existantes.

### 18. Consulter l’état d’une mise à jour copie aussi l’installeur en mémoire

**Preuve : code.** `UpdateStatus` dérive `Clone` et contient `bytes: Option<Vec<u8>>`. `updater.rs:60` clone la structure pour produire l’état public. `serde(skip)` évite la sérialisation, mais pas le clonage du vecteur. L’installeur local 2.6.1 pèse environ 63,5 millions d’octets ; son téléchargement conservé en mémoire représente donc une copie coûteuse.

**Correction :** séparer l’état public des données privées, garder le fichier téléchargé sur disque ou partager le tampon sans copie. Aucun pic mémoire effectif n’est annoncé sans profilage.

### 19. Une mesure indisponible peut être présentée comme une vraie valeur

**Preuve : code.** Le centre de contrôle initialise CPU/RAM à 12 % / 45 %, batterie à 100 % et disque à 150 Go libres ; les mesures réelles les remplacent lorsqu’elles arrivent, mais un échec peut laisser ces valeurs. `commands/system.rs` utilise aussi des valeurs numériques de secours. Les températures et l’activité disque de `platform/system.rs:106` sont simulées ; elles ne doivent pas être exposées comme des mesures natives.

**Correction :** états distincts chargement, mesure valide et indisponibilité ; afficher « — » plutôt qu’une valeur d’exemple. La mise à jour Réseau de la passe précédente améliore la vue, mais une réponse native de secours numériquement valide n’est pas distinguée d’un vrai zéro.

## P3 — Prévention des régressions

### 20. Les vérifications utiles ne sont pas regroupées dans un parcours de livraison

**Preuve : dépôt.** `package.json` n’expose pas de commande `test` ou de contrôle complet et aucune configuration CI n’a été trouvée. Les tests existent dans `tools/tests`, mais plusieurs sélecteurs de suites avaient vieilli avant leur actualisation dans la passe précédente. La CSP release dispose d’un test natif distinct.

**Correction :** une commande documentée pour tests JS/Rust et compilation, des parcours navigateur de release, audit des dépendances, puis essais matériels explicitement séparés. Inclure les valeurs limites révélées ici et les ouvertures aux bords de l’écran. Une compilation réussie ne suffit pas pour ce widget Windows.

## Points positifs à préserver

- Originaux conservés et publication sans écrasement pour Fichiers et Replay ; vérification de source modifiée pendant un travail.
- Paramètres de capture validés côté Rust ; microphone Replay désactivé par défaut ; sauvegarde des fragments en cas d’échec.
- Bibliothèque enregistrée atomiquement, erreurs de corruption conservées ; renommage des clips avec gestion de collision et retour arrière.
- CSP de release qui bloque le JavaScript en ligne, permissions de fenêtre limitées et protocole de médias initialement sans portée globale.
- États d’erreur, focus et actions de recours présents dans les grandes vues ; bonne séparation des styles dans le Shadow DOM.
- Tests existants sur la concurrence, l’annulation, les exports, la suppression ciblée et la conservation des données.

## Ordre proposé pour les corrections

1. Volume zéro, démarrage tolérant aux données invalides, import transactionnel.
2. Chrono fondé sur le temps et placement de la vue ouverte aux bords ; clic droit compatible avec la CSP release.
3. Clavier et curseurs accessibles, retour visible sur l’enregistrement des préférences, export réellement défini.
4. Délais réseau, arrêt commun avant mise à jour, réparation des historiques, quotas des caches.
5. Dépendances, confidentialité explicite, compatibilité Cloud Files et consolidation des vérifications de livraison.

Pour la passe interface, les axes correspondants sont `/impeccable harden`, `/impeccable adapt`, `/impeccable optimize`, puis `/impeccable polish` après les corrections fonctionnelles. Le moteur natif demande ses propres vérifications.

## Matrice restant à exécuter sur Windows

Deux moniteurs à DPI différents ; bords de la zone de travail ; changement de résolution et débranchement d’écran ; sortie/entrée audio qui disparaît ; veille/reprise ; capture prolongée avec PC/micro et contrôle de synchronisation ; manque d’espace simulé sur un emplacement temporaire ; dossier OneDrive ; lecteurs réseau ; installation pendant une session active ; versions installées de WebView2 et CSP réellement embarquée. Aucun changement d’installation, de périphérique, de fond d’écran ou de capture personnelle n’a été provoqué pour cet audit.
