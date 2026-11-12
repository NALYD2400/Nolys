# Diagnostics Windows de Nolys

Ces scripts utilisent un exécutable **debug** à ressources embarquées et un répertoire de données neuf. Ils ne publient ni installateur ni version et ne chargent pas les préférences personnelles.

Depuis la racine du dépôt, dans PowerShell :

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/diagnostics/build-native.ps1 -Name nolys-diagnostic
node tools/diagnostics/replay-selects-native.mjs .impeccable/runtime/nolys-diagnostic.exe
node tools/diagnostics/replay-player-native.mjs .impeccable/runtime/nolys-diagnostic.exe
node tools/diagnostics/windows-layout-native.mjs .impeccable/runtime/nolys-diagnostic.exe
node tools/diagnostics/profile-native.mjs .impeccable/runtime/nolys-diagnostic.exe 3600
```

Après la fin de la mesure, `report-profile.py <dossier diagnostic>` génère un rapport descriptif à partir de `summary.json`, `progress.json` et des échantillons bruts. Il refuse une observation incomplète ou de moins d'une heure. L'option `--plot` ajoute les courbes avec matplotlib ; l'exécuter dans un environnement Python isolé contenant cette dépendance. Sans cette option, le rapport n'utilise que la bibliothèque standard Python. Les médianes des dix premières/dernières minutes distinguent une évolution durable des pics ponctuels ; elles ne prouvent pas à elles seules l'absence ou la présence d'une fuite.

Si l'utilisateur demande une finalisation anticipée, un résumé portant explicitement `stopReason` peut être rendu avec `--allow-short`. Le rapport indique alors la durée réelle et les phases manquantes ; cette option ne permet pas de présenter une mesure écourtée comme une heure complète.

Exécuter les parcours natifs l'un après l'autre. Le profilage dure une heure plus les phases de référence. Ses mesures concernent le binaire debug identifié par SHA-256 dans son manifeste, ses processus WebView2 et la machine présente ; elles ne décrivent pas directement les performances d'une release.

`native-session.mjs` contrôle le manifeste, le hash et l'emplacement du binaire. Il désactive les raccourcis du profil de test et ferme seulement l'instance qu'il a lancée. Chaque diagnostic conserve ses preuves dans `.impeccable/runtime/diagnostic-*` : JSON, captures et journaux.

Le lecteur de clips utilise une mire vidéo synthétique sans audio. Le profilage utilise un WAV silencieux muet et bloque les commandes média externes. Les moteurs de capture sont indisponibles dans ces profils ; aucune capture du bureau n'est lancée. Les tests d'écran déplacent la fenêtre de diagnostic entre les moniteurs présents, sans changer la configuration Windows. Le focus est émulé dans le diagnostic pour permettre de continuer à travailler ailleurs ; le comportement normal de repli à la perte de focus reste vérifié par les tests navigateur.

CPU : 100 % « un cœur » représente un processeur logique occupé ; le pourcentage machine est divisé par le nombre de processeurs logiques. Mémoire : somme privée par processus, sans assimiler le working set additionné à de la mémoire unique. GPU : somme des compteurs 3D des PID possédés, parfois arrondis à zéro ; absence de compteur et zéro mesuré sont distingués. Le GPU de composition DWM reste hors périmètre.
