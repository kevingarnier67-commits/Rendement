# Rendement

Bloc-notes iOS (PWA) pour noter ton rendement d'atelier en fin de poste.

L'app fonctionne 100% en local sur ton téléphone (aucune donnée envoyée sur internet, aucun compte) et hors-ligne une fois installée.

## Principe

- Tu renseignes l'heure de début et de fin de ton poste (= temps d'ouverture).
- Dès que tu quittes la production pour une tâche annexe (changement de série, panne, réunion, entraide sur un autre poste...), tu démarres le minuteur "pause" avec le motif correspondant. Tu l'arrêtes quand tu reprends la production.
- En fin de poste, tu saisis la quantité produite et la cadence théorique (pièces/heure).
- L'app calcule automatiquement :
  - **Temps net** = temps d'ouverture − temps non-productif cumulé
  - **Rendement** = (quantité produite ÷ cadence théorique × 60) ÷ temps net × 100

Le temps passé hors production ne vient donc plus pénaliser injustement ton rendement.

Tu peux enregistrer la journée dans l'historique, consulter les jours précédents et exporter le tout en CSV (Excel).

## Installer sur iPhone

1. Héberge les fichiers (le plus simple : active **GitHub Pages** sur ce dépôt — Settings → Pages → Source: "GitHub Actions". Le workflow `.github/workflows/deploy-pages.yml` publie le site automatiquement à chaque push sur `main`).
2. Ouvre l'URL du site dans **Safari** sur iPhone.
3. Appuie sur le bouton Partager (carré avec flèche) puis **"Sur l'écran d'accueil"**.
4. L'icône "Rendement" apparaît sur ton écran d'accueil et s'ouvre en plein écran, comme une vraie app.

## Développement local

Aucune dépendance ni build : ce sont des fichiers statiques.

```bash
python3 -m http.server 8080
```

Puis ouvre `http://localhost:8080` dans un navigateur.

## Structure

```
index.html            page unique (3 onglets : Aujourd'hui / Historique / Réglages)
css/style.css          styles (thème clair/sombre automatique)
js/app.js              logique de l'app (minuteur, calculs, stockage local, export CSV)
manifest.json          manifeste PWA
service-worker.js      cache hors-ligne
icons/                 icônes PWA / écran d'accueil iOS
```

Toutes les données (réglages, brouillon du jour, historique) sont stockées dans le `localStorage` du navigateur, sur l'appareil uniquement.
