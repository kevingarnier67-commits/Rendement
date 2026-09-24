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
- **Rendement** = minutes produites ÷ temps de production, exprimé sur 1 (ex. 0,93 ; 1 = objectif plein), affiché dans un anneau (vert quand l'objectif est atteint)
- **Objectif** (1 par défaut, modifiable) : l'app indique combien de minutes de production il reste pour l'atteindre

« Enregistrer la journée » archive les minutes par catégorie et le rendement dans l'onglet **Historique**, puis remet les compteurs à zéro.

L'onglet **Historique** montre un graphique des 7 dernières journées avec la moyenne et la ligne d'objectif. Chaque journée peut être **partagée** (Messages, WhatsApp, mail… ou copiée). Tout en bas, **Exporter / Importer une sauvegarde** permet de garder ses données à l'abri ou de les passer sur un autre téléphone.

**Pause** : touche le poste en cours (ou le bouton Pause sous le chrono) pour le mettre en pause ; le chrono se fige et le poste reste sélectionné. « Reprendre » repart du même temps, « Arrêter » termine le poste. Les minutes déjà faites restent comptées dans tous les cas.

Quand un chrono tourne, une pastille de la couleur du poste apparaît sur l'onglet Minuteur (fixe quand il est en pause).

Tout est stocké en local sur le téléphone (aucune donnée envoyée sur internet) et l'app fonctionne hors-ligne une fois installée. Le chrono continue de tourner même si l'app est fermée : il est basé sur l'heure de démarrage, pas sur un compteur actif.

## Design

Apparence d'une app iOS native (iOS 26/27, Liquid Glass), puis audit avec le skill `apple-design` (`.claude/skills/apple-design`) :

- **Structure iOS** : grands titres, listes groupées à coins arrondis, chrono façon app Horloge, barre d'onglets flottante en verre, feuilles avec poignée (glisser vers le bas pour fermer), boutons ronds × / ✓, menus d'action pour les suppressions.
- **Liquid Glass** uniquement sur la couche de commandes (barre d'onglets, feuilles, alertes, messages), jamais sur le contenu. Effet de bord de défilement en haut et en bas à la place d'une barre opaque.
- **Couleurs système iOS** (fonds groupés, gris, teintes des postes) en clair et en sombre automatique. Bleu, rouge et gris secondaire en variantes lisibles : tout le texte ≥ 4,5:1.
- **Enregistrer la journée** ne demande plus de confirmation : un message « Journée enregistrée · Annuler » permet de revenir en arrière.
- **Accessibilité** : taille de texte de l'iPhone (les valeurs passent à la ligne aux très grandes tailles, sans couper les mots), cibles ≥ 44 pt, VoiceOver, Réduire la transparence (barres opaques), Augmenter le contraste, Réduire les animations.
- **Icônes** : [Phosphor](https://github.com/phosphor-icons/core) (MIT), intégrées en SVG dans `index.html`, sans dépendance.

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
