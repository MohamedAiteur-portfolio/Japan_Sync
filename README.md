# 🗼 Japan_Sync

**[➡️ Voir le site en ligne](https://mohamedaiteur-portfolio.github.io/Japan_Sync/)**

Une Progressive Web App développée pour organiser de A à Z un voyage de 25 jours au Japon (Tokyo, Kyoto, Osaka) à deux, avec synchronisation en temps réel entre les téléphones : dès que l'un modifie quelque chose (un vol, une dépense, une étape du programme), l'autre le voit apparaître instantanément, sans rafraîchir.

Projet personnel, développé avec l'assistance de l'IA (Claude) et **entièrement piloté, débogué et sécurisé par moi** : audit de sécurité complet, correction de failles réelles, choix d'architecture et itérations fonctionnelles au fil de la préparation du voyage. Le code (un seul fichier `index.html` de plus de 4000 lignes) et l'historique des commits témoignent du travail effectué.

---

## 📸 Captures d'écran

### 1. Vue d'ensemble & Accueil
<img width="215" height="466" alt="imagesscreen1" src="https://github.com/user-attachments/assets/54029b78-5ab1-41b1-9333-325c0cef3dc3" />

### 2. Itinéraire du Voyage
<img width="215" height="466" alt="imagesscreen2" src="https://github.com/user-attachments/assets/94d6ce0b-ff46-4e5b-a09b-30749fafc4b1" />

### 3. Checklist de Voyage
<img width="215" height="466" alt="imagesscreen3" src="https://github.com/user-attachments/assets/81614aa6-d63b-4e79-b508-ed1ecf95c8f8" />

### 4. Budget & Convertisseur de Devises
<img width="215" height="466" alt="imagesscreen4" src="https://github.com/user-attachments/assets/a81dd1aa-7506-4920-b3f7-920717efd6e7" />

### 5. Infos utiles & Cartographie
<img width="215" height="466" alt="imagesscreen5" src="https://github.com/user-attachments/assets/b6e7522d-4cae-4b56-9380-9a35d0e1a393" />

---

## 🚀 Fonctionnalités

**Accueil**
- Suivi des vols (compagnie, escales, sièges, PNR) et des trajets en train (Shinkansen…)
- Carte "Aujourd'hui" : affiche automatiquement le prochain vol/train/activité du jour, avec la météo en direct basée sur la position GPS
- Compte à rebours avant le départ

**Programme (itinéraire)**
- Une entrée par destination (ville, hôtel, dates) avec un planning jour par jour (heure, activité, lien Google Maps)
- Tout est modifiable en place, sans supprimer/recréer

**Checklist**
- Checklist générale du voyage + une checklist par destination

**Budget**
- Convertisseur EUR/JPY bidirectionnel avec taux de change en direct
- Suivi des dépenses par catégorie (transport, hébergement, activités, nourriture, shopping), statut payé/à payer, totaux calculés automatiquement

**Infos utiles**
- Cartes libres modifiables (numéros d'urgence, JR Pass, wifi, adresses…)
- Visualisation de l'itinéraire à pied entre l'hôtel et l'activité sélectionnée, sans clé API Google payante
- Dossier "Billets & Tickets" pour Universal Studios, DisneySea, musées, temples

**Technique**
- Installable comme une vraie app sur le téléphone (PWA, icône, écran d'accueil), fonctionne hors-ligne
- Aucune clé API payante utilisée (change, météo, cartes) — 100% gratuit à héberger et faire tourner

---

## 🔒 Sécurité

Point sur lequel j'ai particulièrement travaillé :

- **Audit du code initial** et suppression de code suspect
- **Base de données ouverte à tous corrigée** : la base Firestore était accessible en lecture/écriture par n'importe qui sur internet — j'ai mis en place une authentification anonyme Firebase et des règles de sécurité Firestore strictes pour ne restreindre l'accès qu'aux deux utilisateurs du voyage
- **Protection contre les injections XSS** : toutes les données utilisateur affichées passent par une fonction d'échappement (`esc()`) avant insertion dans le DOM, pour empêcher l'exécution de code arbitraire

---

## 🛠️ Stack technique

| Domaine | Techno |
|---|---|
| Front-end | HTML5, CSS3, JavaScript (ES6+, vanilla — sans framework) |
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

Le site est accessible directement ici : **https://mohamedaiteur.github.io/Japan_Sync/**

Sur mobile, il peut être installé comme une application via "Ajouter à l'écran d'accueil".

---

## 👤 Auteur

**Mohamed Aiteur** — Étudiant BTS SIO option SLAM (rentrée 2026), actuellement en recherche d'alternance.
