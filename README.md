# 🧭 Cap Commun

**[➡️ Voir le site en ligne](https://getready-app.github.io/getready/)**

Une Progressive Web App pour organiser un séjour à plusieurs : itinéraire, transports, préparatifs, budget partagé, réservations et informations utiles. Cap Commun s'adapte aux vacances, week-ends, voyages professionnels, événements et groupes variés. Son scénario de démonstration suit quatre amies à Lisbonne et Sintra.

**Édition :** aucun mot de passe n'est demandé. Les modifications sont enregistrées dans le stockage local du navigateur utilisé ; elles ne sont pas synchronisées automatiquement avec les autres appareils. La section « Carnet pratique » permet de télécharger une sauvegarde JSON et de la réimporter sur un autre appareil. Le connecteur Firebase historique n'est plus chargé par l'application. Une synchronisation partagée en direct nécessiterait un système de comptes et des règles Firestore adaptés.

**Aperçu du scénario :** ajoutez `?demo=lisbonne` à l'URL pour découvrir et modifier le séjour fictif de quatre amies entre Lisbonne et Sintra. L'aperçu est enregistré séparément dans le navigateur, ne contacte pas Firebase et précise que les horaires, vols et budgets sont des exemples. Pour repartir du scénario initial, ouvrez une fois `?demo=lisbonne&reset=1` ; le lien se nettoie ensuite automatiquement pour conserver les modifications suivantes.

Projet personnel développé avec l'assistance de l'IA (Claude), piloté, débogué et sécurisé par son auteur. L'application est maintenant organisée par responsabilité pour que l'interface, les styles, les fonctionnalités, la synchronisation et le mode hors ligne puissent évoluer séparément.

## 🗂️ Structure du projet

| Fichier | Rôle |
|---|---|
| `index.html` | Structure des pages, navigation et formulaires |
| `css/styles.css` | Identité visuelle, composants et adaptations mobile |
| `js/app.js` | Données du séjour, affichage et interactions |
| `js/currency.js` | Conversion multidevise et cache des taux |
| `js/firebase-sync.js` | Ancien connecteur Firebase, conservé mais débranché |
| `js/pwa.js` | Enregistrement du service worker |
| `sw.js` | Cache et fonctionnement hors ligne |
| `flight-api/` | Relais Cloudflare Worker pour la recherche de vols par numéro (configuration facultative) |

---

## 🚀 Fonctionnalités

**Accueil**
- Suivi des vols et des transports (train, métro, bus, voiture, bateau ou autre)
- Préremplissage d'un vol à partir de son numéro et de sa date ; nécessite la configuration du relais Cloudflare et une clé fournisseur (voir [`flight-api/README.md`](flight-api/README.md))
- Carte "Aujourd'hui" : affiche automatiquement le prochain vol/train/activité du jour, avec la météo en direct basée sur la position GPS
- Compte à rebours avant le départ

**Programme (itinéraire)**
- Sélection horizontale des villes enregistrées, puis des dates de l'étape ; le planning de la journée choisie s'affiche directement
- Les dates de début et de fin d'une nouvelle étape remplissent automatiquement les journées, que l'on peut ensuite modifier ou compléter
- Activités par heure avec lien Maps, ajout et modification sur place
- Tout est modifiable en place, sans supprimer/recréer

**Checklist**
- Checklist générale du voyage + une checklist par destination

**Budget**
- Convertisseur multidevise : devises source et cible sélectionnables, taux indicatifs mis à jour chaque jour
- Dépenses saisies dans leur devise d'origine et totaux convertis dans une devise de référence au choix
- Suivi par catégorie et par participant, statut payé/à payer et répartition des dépenses

**Présentation**
- Identité visuelle Cap Commun et accueil adapté au type de séjour et au groupe (solo, couple, amis, famille ou équipe)
- Tableau de bord avec aperçu des étapes, activités, budget et préparatifs
- Navigation mobile simplifiée et mise en page adaptée aux écrans larges

**Infos utiles**
- Cartes libres modifiables (adresses, transports, accès, contacts et notes de groupe…)
- Sauvegarde locale exportable et importable pour transférer un séjour entre appareils
- Visualisation de l'itinéraire à pied entre l'hôtel et l'activité sélectionnée, sans clé API Google payante
- Dossier « Billets & Réservations » pour les visites, trajets et activités du séjour

**Technique**
- Installable comme une vraie app sur le téléphone (PWA, icône, écran d'accueil), fonctionne hors-ligne
- Les fonctions existantes de change, météo et cartes n'exposent aucune clé API dans le navigateur. La recherche de vols est facultative et dépend des quotas et conditions du fournisseur choisi.

---

## 🔒 Sécurité

Point sur lequel j'ai particulièrement travaillé :

- **Audit du code initial** et suppression de code suspect
- **Accès Firestore protégé** : le connecteur Firebase n'est pas chargé dans la version actuelle. Les règles Firestore existantes restent en place et ne sont pas assouplies pour autoriser des écritures publiques.
- **Protection contre les injections XSS** : toutes les données utilisateur affichées passent par une fonction d'échappement (`esc()`) avant insertion dans le DOM, pour empêcher l'exécution de code arbitraire

---

## 🛠️ Stack technique

| Domaine | Techno |
|---|---|
| Front-end | HTML5, CSS3, JavaScript natif en modules ES (sans framework) |
| Backend / temps réel | Firebase (Firestore + Authentication anonyme) |
| App | PWA (Service Worker, manifest.json, mode hors-ligne) |
| APIs gratuites | Géolocalisation navigateur, météo, taux de change, itinéraires à pied |
| Hébergement | GitHub Pages |

---

## 💡 Ce que ce projet démontre

- Capacité à **auditer et sécuriser** une base de données mal configurée (règles Firestore, authentification)
- Compréhension et prévention des failles **XSS**
- Développement front-end complet en JavaScript natif, sans dépendance à un framework
- Intégration d'API tierces gratuites (météo, change, cartes) sans clé payante
- Construction d'une **PWA** installable et fonctionnelle hors-ligne
- Autonomie sur un projet réel, de bout en bout : cahier des charges personnel, développement, débogage, itérations sur plusieurs semaines (voir l'historique des commits)

---

## 📱 Essayer l'application

Le site est accessible directement ici : **https://getready-app.github.io/getready/**

Sur mobile, il peut être installé comme une application via "Ajouter à l'écran d'accueil".

---

## 👤 Auteur

**Mohamed Aiteur** — Étudiant BTS SIO option SLAM (rentrée 2026), actuellement en recherche d'alternance.
