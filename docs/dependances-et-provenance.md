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

## Étape suivante à définir

Pour réduire davantage les dépendances, une décision séparée est nécessaire : remplacer seulement les ressources et services externes, réécrire les Réglages sans React, ou changer également le socle natif. Ce nettoyage ne présume pas cette décision. Une réécriture complète doit conserver les fonctions actuelles et faire l’objet d’un état sauvegardé avant modification.
