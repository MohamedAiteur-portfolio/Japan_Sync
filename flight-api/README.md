# Recherche de vols (Worker Cloudflare)

Le site est publié comme une page statique. Ce Worker sert de relais pour garder la clé RapidAPI côté serveur, jamais dans le JavaScript du site.

## Mise en service

1. Crée un compte RapidAPI, abonne-toi à AeroDataBox et récupère ta clé API. Le fournisseur annonce une offre d’essai gratuite, avec des quotas et une couverture qui dépendent de l’offre.
2. Installe Node.js, puis depuis ce dossier lance `npx wrangler login`.
3. Ajoute la clé comme secret (elle sera demandée dans le terminal) : `npx wrangler secret put RAPIDAPI_KEY`.
4. Publie le relais : `npx wrangler deploy`.
5. Copie l’adresse `workers.dev` générée dans `js/flight-api-config.js` :

   `window.CAP_COMMUN_FLIGHT_API_URL = 'https://cap-commun-flight-search.<ton-compte>.workers.dev';`

6. Publie à nouveau le site. En local, lance-le depuis le dossier du site avec `python3 -m http.server 8000`.

Ne colle jamais la clé API dans le code du site, un dépôt public ou cette conversation. Les résultats servent à préremplir un segment ; confirme les horaires auprès de la compagnie aérienne. Les données disponibles et les vols futurs dépendent de l’offre et de la couverture du fournisseur.
