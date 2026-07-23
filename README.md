# Rendement

Minuteur de temps non-productif pour l'atelier, installable sur iPhone (PWA).

Trois compteurs, un seul geste :

- **TEMPS CMS**
- **TEMPS CF**
- **TEMPS RÉPARATION**

Appuie sur une catégorie pour démarrer le chrono, appuie à nouveau pour l'arrêter. Appuyer sur une autre catégorie bascule directement le chrono dessus. Chaque catégorie cumule son temps de la journée, et le total non-productif s'affiche en bas. Un bouton remet tout à zéro en fin de poste.

Tout est stocké en local sur le téléphone (aucune donnée envoyée sur internet) et l'app fonctionne hors-ligne une fois installée. Le chrono continue de tourner même si l'app est fermée : il est basé sur l'heure de démarrage, pas sur un compteur actif.

## Installer sur iPhone

1. Ouvre https://kevingarnier67-commits.github.io/Rendement/ dans **Safari**.
2. Bouton **Partager** → **"Sur l'écran d'accueil"** → **Ajouter**.

## Développement local

Fichiers statiques, aucune dépendance ni build :

```bash
python3 -m http.server 8080
```

## Structure

```
index.html            page unique (minuteur)
css/style.css          styles
js/app.js              logique (chrono, cumuls, stockage local)
manifest.json          manifeste PWA
service-worker.js      cache hors-ligne
icons/                 icônes PWA / écran d'accueil iOS
```

Le déploiement sur GitHub Pages est automatique à chaque push sur `main` (`.github/workflows/deploy-pages.yml`).
