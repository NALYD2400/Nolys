# Bibliothèque intégrée — preuves de vérification

Les captures 18 à 21 montrent la véritable interface dans un navigateur, avec un pont Tauri simulé et des titres synthétiques. Le lecteur HTMLAudio est réel. Le parcours reproductible est `tools/tests/library.browser.cjs` ; il utilise le serveur Vite local et Playwright.

`native-library.png` est une capture du WebView de l’application Windows compilée, avec sa collection vide. L’ouverture se fait dans la fenêtre Island existante, sans fenêtre Bibliothèque séparée. Les fichiers PNG portent leur origine dans leurs métadonnées.

La revue indépendante a demandé deux corrections : contenir la barre latérale à petite hauteur et empêcher Échap de replier l’Island depuis un dialogue. Les deux ont été corrigées et jugées résolues lors du verdict suivant.

Les contrôles natifs ont confirmé l’ouverture à environ 1062 × 722 px visibles, le retour au menu dans la fenêtre de 620 × 600 px, la réouverture et Échap depuis le dialogue de création. Un WAV Blob synthétique en sourdine a continué de jouer pendant un changement de mode, avec les événements natifs de lecture. Ce test substituait uniquement la source, sa vérification et la pause des lecteurs externes ; il ne vérifie pas l’import natif ni la lecture d’un véritable fichier autorisé. Les substitutions ont été restaurées sans importer de titre de test.

La géométrie en écran secondaire et au zoom de 150 % est couverte par des tests Rust ; le matériel à DPI mixtes et les sélecteurs Windows restent à vérifier manuellement.
