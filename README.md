# Rendement

Minuteur de temps non-productif pour l'atelier, installable sur iPhone (PWA).

Trois compteurs de base (on peut en ajouter), un seul geste :

- **TEMPS CMS**
- **TEMPS CF**
- **TEMPS RÉPARATION**

Touche un poste pour démarrer le chrono, touche-le à nouveau pour l'arrêter. Toucher un autre poste bascule directement le chrono dessus. Le poste en cours s'allume dans sa couleur, comme un voyant andon. Chaque poste affiche son cumul du jour en minutes, et les minutes minutées s'affichent en bas.

## Calcul du rendement

L'onglet **Calcul** part de la base de 455 min (modifiable) :

- **Temps de production** = 455 − minutes minutées (reprises automatiquement du minuteur)
- **Minutes produites** = somme, pour chaque matière (Pôles, Pôles 80/100A, S1, Liaisons, Cages, MFV, + matières ajoutées), de la quantité × sa cadence (« X pièces en Y min », ex. Cages 470 en 60 min). Les cadences sont mémorisées ; seules les quantités sont à saisir chaque jour.
- **Rendement** = minutes produites ÷ temps de production

« Enregistrer la journée » archive les minutes par catégorie et le rendement dans l'onglet **Historique**, puis remet les compteurs à zéro.

Tout est stocké en local sur le téléphone (aucune donnée envoyée sur internet) et l'app fonctionne hors-ligne une fois installée. Le chrono continue de tourner même si l'app est fermée : il est basé sur l'heure de démarrage, pas sur un compteur actif.

## Design

Refonte réalisée avec le skill `ui-ux-pro-max` (`.claude/skills/ui-ux-pro-max`) :

- **Style** : minimalisme suisse (recommandé pour les outils professionnels) : grille, contraste fort, pas d'effet décoratif.
- **Couleurs** : palette « ardoise industrielle » en variables CSS, thème clair par défaut (lisible sous l'éclairage de l'atelier) et thème sombre automatique selon le réglage de l'iPhone. Toutes les paires texte/fond ≥ 4,5:1, bordures de champs ≥ 3:1.
- **Voyants andon** : chaque poste a un ton (bleu, violet, orange…) ; le poste en cours devient un bloc plein de sa couleur.
- **Icônes** : [Phosphor](https://github.com/phosphor-icons/core) (MIT), intégrées en SVG dans `index.html`, sans dépendance.
- **Police** : police système de l'iPhone (pas de police web : hors-ligne et suit la taille de texte réglée).
- **Accessibilité** : cibles tactiles ≥ 44 pt, taille de texte d'iOS, Réduire les animations, Augmenter le contraste, VoiceOver.

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
index.html            page unique (onglets Minuteur / Calcul / Historique)
css/style.css          système de design (variables clair/sombre, composants)
js/app.js              logique (chrono, cumuls, calcul du rendement, stockage local)
manifest.json          manifeste PWA
service-worker.js      cache hors-ligne
icons/                 icônes PWA / écran d'accueil iOS
```

Le déploiement sur GitHub Pages est automatique à chaque push sur `main` (`.github/workflows/deploy-pages.yml`).
