# Audit de fluidité et de fiabilité de Nolys — 31 octobre 2026

> Constat avant corrections. Les six points prioritaires ont ensuite été traités ; les modifications, mesures après correction et limites sont consignées dans le [bilan de fluidité](bilan-fluidite-2026-10-31.md).

## Verdict

Le socle de l'application est cohérent : modules séparés, identité cuivre commune, travail natif déplacé hors du thread d'interface, rafraîchissements réduits au repos, chargement différé des Réglages et garde-fous sur les fichiers. Les parcours automatisés actuels passent. Le détecteur n'a produit que 14 conseils sur les ressorts d'animation, qui font partie de l'identité voulue ; ils ne sont pas comptés comme des bugs.

Il reste des améliorations concrètes avant la commercialisation : surtout les grandes bibliothèques, la latence des ouvertures, les traitements inutiles lorsque la fenêtre est masquée et les erreurs audio mal remontées. **Six constats retenus : un P1 et cinq P2 ; aucun P0 démontré.** Les anciens défauts corrigés dans le chantier du 30 octobre ne sont pas réintroduits dans ce bilan.

L'audit ne modifie aucun code applicatif. Les cinq fichiers déjà modifiés au début de la revue, notamment le traitement audio Replay, ont été examinés dans leur état présent et conservés. Les sondes et leurs résultats restent dans `.impeccable/runtime/`, ignoré dans Git.

## Ce qui a été vérifié

- `npm run check` : tests JavaScript réussis, compilation de production Vite réussie, **87 tests Rust réussis, 6 ignorés** par défaut.
- `npm run check:browser` : **sept suites Edge réussies**, pour accessibilité, Fichiers, Bibliothèque, menus, Replay, Réglages et minuteurs. Le frontend est réel, les commandes Windows sont simulées.
- `npm run check:audit` : aucune vulnérabilité connue signalée par npm ou RustSec au moment du passage. Six avertissements Rust restent visibles, dont des composants non maintenus et un avis `unsound` ; ne pas confondre succès de la commande et disparition de tous les avis. Le détail est conservé dans le journal local et dans le document de provenance existant.
- Lecture ciblée des boucles UI, animations, visualiseur, halo, pont Tauri, bibliothèque, Replay, volume, placement, gestion des fichiers, arrêt et mise à jour ; prise en compte des rapports de corrections existants.
- Mesures supplémentaires sur le **build de production servi localement**, Edge 156.0.4314.56 en mode headless, fenêtre de 900 × 700 pixels CSS. Aucune capture du bureau ou du microphone personnel, aucun changement du volume Windows.
- Inspection de captures actuelles du menu, des Réglages et de la bibliothèque, en complément des parcours des sept suites.

Les compteurs CDP mesurent le travail du renderer dans ce banc d'essai. **Ce ne sont ni le pourcentage CPU de Nolys, ni ses FPS à l'écran, ni sa mémoire totale avec Rust/WebView2/FFmpeg.** Les intervalles rAF observés suivent une cadence élevée et sont perturbables par l'instrumentation : ils ne permettent pas de promettre « 60 FPS constants » dans l'app native.

### Résultats utiles

| Scénario | Observation |
|---|---|
| Capsule compacte en pause, fenêtre de 2,2 s | Environ 2 à 2,2 ms de travail du thread principal ; aucun long task enregistré dans cette fenêtre. |
| Menu et commandes ordinaires | Contenu créé autour de 300–315 ms ; fin du redimensionnement autour de 714–718 ms, en mouvement normal. |
| Réglages, plusieurs ouvertures | Contenu disponible autour de 714–718 ms dans les sondes ; la suite de parcours indépendante rapporte 741 ms. |
| Musique, Island visible, fenêtre de 2,2 s | 26 demandes de niveau audio. |
| Même état, Island marquée masquée, fenêtre de 2,2 s | Encore 23 à 25 demandes de niveau audio. Le dessin et la respiration diminuent, mais le sondage continue. |
| Bibliothèque synthétique de 3 000 titres, ordre non trié | Certains appels de recherche prennent environ 90 ms de JavaScript synchrone ; les extensions de liste prennent 92–142 ms dans le gestionnaire. |
| Bibliothèque après neuf extensions | 1 500 lignes présentes, environ 21 090 éléments dans la racine de la bibliothèque, contre 150 lignes et 2 190 éléments au départ. |
| Replay, trois notifications sans changement | 27 mutations `childList` dans le panneau malgré un état inchangé. |
| Replay, index synthétique de 10 000 clips | Environ 1,32 Mo de JSON pour un instantané complet, sans les octets vidéo. Cette taille est un essai de croissance, pas une description de la bibliothèque actuelle de l'utilisateur. |
| Préférence système de réduction des animations | Requête bien détectée par Edge, mais capsule encore à 0,62 s et entrée du menu à 0,5 s avec le réglage par défaut `motion-fluid`. |

Un premier diagnostic utilisait le mauvais nom interne `mic-monitor` : ce résultat est exclu ; le module réel `mic` a été exercé ensuite. Une sonde supplémentaire a aussi rencontré un mauvais sélecteur du banc de test, puis le seul scénario concerné a été repris avec la bonne racine. Ces incidents du diagnostic ne sont pas comptés comme des défauts de Nolys.

## Constats prioritaires

### 1. [P1] La bibliothèque peut bloquer le thread UI sur une collection importante

**Preuve : mesurée sur le frontend de production, avec 3 000 titres synthétiques.** La frappe des premières lettres déclenche environ 90 ms de traitement synchrone ; les clics d'extension atteignent environ 142 ms dans le gestionnaire, avant les coûts de rendu suivants. Ce n'est pas une mesure sur des milliers de vrais fichiers audio : les métadonnées sont des fixtures, sans lecture ni import de fichiers.

**Localisation :** `src/library/model.js:7`, `src/library/controller.js:98`, `:115`, `:441` et `:494`.

Le filtrage et le tri sont recalculés à la saisie. Les comparaisons utilisent `localeCompare` avec options dans le comparateur. « Afficher plus » reconstruit les lignes déjà présentes avec `innerHTML` et conserve une limite toujours croissante. Après neuf clics, la liste comporte 1 500 lignes, bien que quelques-unes seulement soient visibles.

**Impact :** retards de frappe, accrochages lors de l'ajout de lignes et défilement plus coûteux sur une grande bibliothèque, particulièrement sur des machines moins rapides. Le comportement est correct fonctionnellement mais dégrade la sensation de qualité.

**Recommandation :** conserver un `Intl.Collator`, mettre en cache les tris et les chaînes de recherche normalisées, éviter de reconstruire les lignes existantes et borner les lignes réellement montées par une fenêtre de rendu ou une pagination fixe. Mesurer aussi la navigation clavier et la restauration du focus après modification.

**Commande adaptée :** `/impeccable optimize`.

### 2. [P2] L'ouverture attend le ressort et donne une impression de lenteur

**Preuve : code et plusieurs ouvertures mesurées.** Les Réglages deviennent disponibles environ 0,7 seconde après la commande, même lorsque leur code est déjà préchargé.

**Localisation :** `src/island/dynamic-island/features/navigation.js:23`, `:37`, `:50`, `:64` ; `src/island/dynamic-island/views/settings.js:52` ; `src/island/styles/motion.css:16`.

La navigation attend d'abord 90 ms, puis une fraction du redimensionnement avant d'injecter le contenu. Les Réglages attendent en plus la fin du ressort de largeur/hauteur. L'animation normale de taille dure 620 ms. Ce choix réduit la concurrence entre construction de la vue et animation, mais retarde volontairement l'accès au panneau.

**Impact :** une interface peut sembler lente alors que le calcul du contenu est court. La latence est distincte d'une chute de FPS.

**Recommandation :** garder l'identité du ressort, mais préparer davantage la vue au repos, raccourcir le délai avant le premier contenu utile et comparer une ouverture plus courte. Ne pas déplacer aveuglément tout le montage pendant le redimensionnement : cela pourrait réintroduire des saccades. Vérifier les navigations rapides et les notifications concurrentes.

**Commande adaptée :** `/impeccable animate`, avec mesure par `/impeccable optimize`.

### 3. [P2] Le visualiseur continue de sonder l'audio quand la fenêtre est masquée

**Preuve : reproduite deux fois dans le banc de test.** Pour 2,2 secondes, 26 appels de niveau audio en état visible et encore 23 à 25 après `setWindowHidden(true)`.

**Localisation :** `src/island/dynamic-island/features/glow-halo.js:108` ; `src/island/dynamic-island/features/visualizer.js:29`, `:52` ; `src/services/AudioVisualizerService.js:132`, `:155`.

Le drapeau masqué interrompt le dessin du canvas et arrête le halo, mais l'activité du service reste liée à l'existence du canvas. Le compteur continue donc à être demandé au pont natif.

**Impact :** réveils et appels Windows inutiles lorsque rien n'est visible. Le banc démontre les appels ; il ne quantifie pas les watts économisables ni le coût CPU natif.

**Recommandation :** prendre la visibilité native en compte dans l'activation du visualiseur, arrêter sa planification en arrière-plan puis relire un niveau frais au retour. Conserver séparément la détection des changements de morceau et les services nécessaires aux captures actives.

**Commande adaptée :** `/impeccable optimize`.

### 4. [P2] Replay réexpédie trop d'état et réécrit des éléments inchangés

**Preuve : code, taille d'instantané et mutations observées.** Trois mises à jour identiques produisent 27 mutations `childList`. Avec 10 000 clips de test, l'instantané complet représente environ 1,32 Mo de JSON.

**Localisation :** `src/replay/store.js:6` ; `src/replay/model.js:37` ; `src/replay/controller.js:123`, `:125`, `:135` ; `src-tauri/src/replay/mod.rs:174` ; `src-tauri/src/replay/engine.rs`, émission périodique via `shared.notify()`.

Le moteur envoie un événement de statut environ une fois par seconde pendant une capture. L'écouteur redemande alors l'instantané complet, dont l'historique des clips. En vue Clips, sa signature est recalculée avec `JSON.stringify` de toute la liste. En vue Capture, les libellés et icônes de boutons sont reconstruits même sans changement.

**Impact :** coût croissant avec l'historique et modifications DOM évitables. Aucun blocage du moteur de capture ni reset visible d'un bouton n'est affirmé sur cette seule preuve.

**Recommandation :** séparer télémétrie et catalogue des clips, transmettre une révision de catalogue, ne relire les clips qu'à leur modification, et actualiser les boutons seulement si leur état change. Conserver le bornage et la pagination existants.

**Commande adaptée :** `/impeccable optimize`.

### 5. [P2] Le mode par défaut ne suit pas la réduction des animations de Windows

**Preuve : reproduite.** Après activation de `prefers-reduced-motion: reduce`, le corps reste en `motion-fluid`, les transitions de la capsule restent à 620 ms et l'entrée des éléments du menu à 500 ms.

**Localisation :** `src/island/styles/motion.css:118`, `src/island/dynamic-island/features/glow-halo.js:116`, règles de mouvement des vues en Shadow DOM.

Un mode sobre interne existe, mais il n'est pas choisi automatiquement à partir de la préférence système. Le commentaire du code indique que l'ancien traitement système figeait toute l'Island : réintroduire un arrêt global des animations serait donc une mauvaise correction.

**Impact :** l'utilisateur qui réduit les mouvements dans Windows doit découvrir et modifier un second réglage dans Nolys. Les animations de redimensionnement et de flou peuvent rester inconfortables.

**Recommandation :** prévoir « Suivre Windows » par défaut, une variante courte et sans ressort/flou pour la réduction des mouvements, et conserver le choix explicite de l'utilisateur. Garder les retours d'état et les indicateurs de progression utiles.

**Commande adaptée :** `/impeccable harden`, puis `/impeccable animate`.

### 6. [P2] Certaines erreurs audio sont présentées au frontend comme des réussites

**Preuve : lecture directe du chemin natif ; débranchement physique non exercé.** La lecture du volume renvoie 70 % si l'accès au périphérique échoue. Les fonctions de modification ignorent les erreurs des appels COM, renvoient `()` et les commandes Tauri renvoient ensuite `true` après validation du paramètre.

**Localisation :** `src-tauri/src/platform/audio.rs:78`, `:86`, `:266`, `:273` ; `src-tauri/src/commands/audio.rs:21`, `:46`, `:55`.

**Impact :** une sortie indisponible ou une session disparue peut laisser l'interface annoncer un volume modifié alors que Windows n'a rien appliqué. Les tests navigateur ne découvrent pas ce cas, car leur pont natif est simulé. La correction antérieure du volume zéro côté JavaScript est bien présente ; il s'agit d'un défaut différent.

**Recommandation :** remonter un résultat explicite depuis WASAPI/COM, distinguer valeur indisponible et vraie mesure, et confirmer l'écriture avant le retour optimiste final. Tester sortie absente, session terminée et changement de périphérique.

**Commande adaptée :** `/impeccable harden` pour l'état visible, avec correction du contrat natif.

## Points à profiler ou valider séparément

- Les morphings de largeur/hauteur, le suivi du halo et le recalcul des zones cliquables s'exécutent pendant l'animation. Leur cumul sur un écran 240/360 Hz mérite une trace du vrai WebView2. Les sondes n'isolent pas encore un responsable unique ; ne pas réécrire ces effets sur une intuition.
- 25 déclarations `transition: all` subsistent dans les feuilles de l'Island. C'est une source de transitions involontaires possibles, pas la preuve que ces 25 règles causent chacune une saccade. Les remplacer de façon ciblée lors du chantier d'animation.
- Le registre `_preloadedMediaArt` dans `features/cover-theme.js` conserve les adresses de pochettes sans éviction explicite. Les adresses peuvent inclure des données d'image. Une session longue avec nombreux morceaux doit mesurer la croissance réelle avant de parler de fuite mémoire.
- Les textes tertiaires des Réglages utilisent notamment `rgba(235, 235, 245, 0.36)` à 11,5 px (`src/settings/styles.css:412`). La lisibilité paraît faible dans les captures ; mesurer le contraste sur les fonds composés et les différentes pochettes avant de déclarer une conformité ou un échec global WCAG.
- Les contrôles visuels réussis sont des vues de bureau ; l'absence de version mobile n'est pas un défaut de ce produit. Le vrai enjeu est le zoom, le DPI Windows, les petites zones de travail et le clavier.
- Le sondage natif de survol utilise 30 ms au-dessus de la fenêtre et 80 ms hors fenêtre (`src-tauri/src/island/hit_test.rs:33`). Vérifier physiquement les entrées de souris suivies d'un clic immédiat avant d'en conclure qu'un clic est perdu.

## Évaluation indicative

| Dimension | Note / 4 | Motif |
|---|---:|---|
| Accessibilité | 2 | Parcours clavier vérifiés, mais réduction des mouvements système ignorée et contrastes composés à approfondir. |
| Performance | 2 | Repos sobre et mécanismes utiles ; blocages mesurés sur grandes listes et travail caché évitable. |
| Thème et cohérence | 3 | Identité, composants et couleurs partagés ; pas de certification de toutes les combinaisons. |
| Adaptation au bureau | 3 | Parcours centraux, limites natives et calculs de placement couverts ; matériel multi-DPI encore à tester. |
| Intégrité de l'implémentation | 3 | Tests actuels réussis et erreurs persistantes prises en charge ; contrat audio encore incomplet. |
| **Total indicatif** | **13 / 20** | **Améliorations nécessaires avant une commercialisation exigeante.** |

Cette note est un jugement de revue, pas un benchmark global ni une certification. Elle ne se compare pas mécaniquement à celle de l'ancien audit, dont le périmètre et l'état du code diffèrent.

## Ordre de correction proposé

1. **[P1] `/impeccable optimize`** : bibliothèque, tri/recherche et nombre de lignes montées. Garder une fixture de 3 000 titres pour comparer les temps avant/après.
2. **[P2] `/impeccable harden`** : erreurs audio réelles et états indisponibles ; préférence de mouvement système.
3. **[P2] `/impeccable optimize`** : arrêt du sondage du visualiseur masqué, télémétrie Replay différentielle et mises à jour DOM ciblées.
4. **[P2] `/impeccable animate`** : réduire la latence des ouvertures et les propriétés animées, tout en conservant le style de Nolys.
5. **`/impeccable polish`** : passe finale de lisibilité, focus et cohérence après les corrections mesurées.

Ces corrections peuvent être abordées ensemble ou une par une. Refaire un audit ciblé après leur mise en place, sans relancer indéfiniment les scénarios inchangés.

## Conditions encore nécessaires pour juger l'application installée

- Profilage d'un binaire correspondant exactement au code audité : processus Rust, renderer, GPU et consommation totale, dans les états repos, musique, défilement et Replay.
- Sessions de capture longues avec cadence réellement obtenue, synchronisation audio/vidéo, jeu actif et pression mémoire ; essais des sorties et micros débranchés.
- Veille et reprise réelles, plein écran, plusieurs écrans avec DPI différents, changement de sortie audio et redémarrage après incident.
- Vérification de la CSP du binaire release avec `tools/tests/release-csp.native.mjs`, puis installation/mise à jour dans le canal retenu. La réussite de Vite ne prouve pas ces parcours.

## Preuves locales

- `.impeccable/runtime/audit-fluidite-2026-10-31.json` : première passe de mesures.
- `.impeccable/runtime/audit-fluidite-2026-10-31-confirmation.json` : confirmation des mesures de bibliothèque, visibilité, mouvement et module micro ; fin du scénario supplémentaire invalide exclue comme indiqué plus haut.
- `.impeccable/runtime/audit-replay-cost-2026-10-31.json` : reprise ciblée du scénario de grand index Replay, réussie sans erreur de page.
- `.impeccable/runtime/audit-browser-2026-10-31.log` : sept suites de parcours réussies.
- `.impeccable/runtime/audit-deps-2026-10-31.log` : résultats npm/RustSec.
- `.impeccable/runtime/audit-fluidite-detector-2026-10-31.json` : 14 conseils sur les ressorts ; deux feuilles d'icônes/polices liées n'ont pas été résolues par le détecteur, donc pas de conclusion de contraste tirée de celui-ci.
- `.impeccable/review/audit-fluidite-2026-10-31/` : captures locales des parcours.
