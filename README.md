# MyMongo

> Your MongoDB. Under control.

Panel d’administration MongoDB auto-hébergé : explorateur de bases, collections et documents, éditeur de requêtes et d’agrégations, gestion des index, import/export, statistiques, rôles et journal d’audit.

- **Backend** : Node.js 22, TypeScript, Fastify 5, driver officiel `mongodb` 7, Zod 4.
- **Frontend** : React 19, Vite 8, Tailwind CSS 4, TanStack Query & Table, CodeMirror 6, Radix UI.
- **Style de code** : [Google TypeScript Style](https://github.com/google/gts) (ESLint + Prettier via `gts`).

## Sommaire

1. [Installation avec Docker](#installation-avec-docker)
2. [Créer le premier administrateur](#créer-le-premier-administrateur)
3. [Configurer la connexion MongoDB](#configurer-la-connexion-mongodb)
4. [Reverse proxy HTTPS](#reverse-proxy-https)
5. [Mise à jour](#mise-à-jour)
6. [Sauvegarde et restauration](#sauvegarde-et-restauration)
7. [Variables d’environnement](#variables-denvironnement)
8. [Sécurité](#sécurité)
9. [Développement](#développement)

## Installation avec Docker

Prérequis : Docker Engine 24+ avec le plugin Compose, sur un serveur Linux.

```bash
git clone git@github.com:MikaM06/MyMongo.git
cd MyMongo
cp .env.example .env
chmod 600 .env
```

Éditez `.env` (au minimum `MONGODB_URI` et `MYMONGO_ALLOWED_ORIGINS`), puis :

```bash
docker compose up -d --build
docker compose ps
```

Par défaut, le conteneur n’écoute que sur `127.0.0.1:8088` : il n’est **pas** exposé sur Internet et doit être publié via un reverse proxy HTTPS. Changez `MYMONGO_HOST_PORT` si le port 8088 est déjà utilisé.

Vérification :

```bash
curl -s http://127.0.0.1:8088/api/health
docker compose logs -f mymongo
```

Le déploiement ne crée, ne supprime et ne réinitialise jamais de base MongoDB.

## Créer le premier administrateur

MyMongo n’a aucun compte ni mot de passe par défaut. Créez le premier administrateur depuis le serveur :

```bash
docker compose exec -it mymongo node server/dist/cli.js user add admin --role admin
```

Le mot de passe est demandé de façon masquée (12 caractères minimum, au moins trois types de caractères). Autres commandes :

```bash
docker compose exec mymongo node server/dist/cli.js user list
docker compose exec -it mymongo node server/dist/cli.js user passwd admin
docker compose exec mymongo node server/dist/cli.js user role alice readonly
docker compose exec mymongo node server/dist/cli.js user remove alice
```

Pour un usage non interactif, ajoutez `--password-stdin` et passez le mot de passe sur l’entrée standard. Les comptes suivants peuvent ensuite être gérés dans **Paramètres → Utilisateurs**.

Rôles :

| Rôle       | Droits                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `admin`    | Toutes les opérations : CRUD, index, import, création/suppression de bases et collections, `$out`/`$merge`, utilisateurs, audit |
| `readonly` | Consultation, filtres, agrégations sans écriture, export                                                                        |

## Configurer la connexion MongoDB

Les connexions sont définies uniquement côté serveur, dans `.env`. Les URI et identifiants ne sont jamais envoyés au navigateur et ne peuvent pas être saisis depuis l’interface (pas de risque SSRF).

```dotenv
MONGODB_URI=mongodb://mymongo_app:MOT_DE_PASSE@host.docker.internal:27017/?authSource=admin
MONGODB_LABEL=Production
```

Plusieurs connexions :

```dotenv
MYMONGO_CONNECTION_ANALYTICS_URI=mongodb+srv://user:pass@cluster0.example.mongodb.net/
MYMONGO_CONNECTION_ANALYTICS_LABEL=Analytics (Atlas)
```

Chaque variable `*_URI` accepte une variante `*_URI_FILE` pointant vers un fichier secret (Docker secrets).

Selon l’emplacement de MongoDB :

- **MongoDB installé sur l’hôte** : utilisez `host.docker.internal` (déjà mappé dans `compose.yaml`) et vérifiez que `mongod` écoute sur une interface accessible depuis le bridge Docker (`bindIp`).
- **MongoDB dans un autre projet Compose** : ajoutez un fichier `compose.override.yaml` qui rattache MyMongo au réseau existant, puis utilisez le nom du service dans l’URI :

  ```yaml
  services:
    mymongo:
      networks:
        - mongo_net
  networks:
    mongo_net:
      external: true
      name: monprojet_default
  ```

### Compte MongoDB à privilèges minimaux

N’utilisez pas `root`. Exemple dans `mongosh` pour un compte capable d’administrer les données :

```javascript
use admin
db.createUser({
  user: 'mymongo_app',
  pwd: passwordPrompt(),
  roles: [
    {role: 'readWriteAnyDatabase', db: 'admin'},
    {role: 'dbAdminAnyDatabase', db: 'admin'},
    {role: 'clusterMonitor', db: 'admin'},
  ],
});
```

Pour gérer les utilisateurs MongoDB depuis MyMongo (page **Utilisateurs MongoDB**, avec l’option « Créer une base portant le même nom et accorder tous les privilèges »), ajoutez `{role: 'userAdminAnyDatabase', db: 'admin'}`. Ce rôle permet d’attribuer n’importe quel rôle : ne l’accordez que si cette fonction est utile.

Pour un panel en lecture seule : `readAnyDatabase` + `clusterMonitor`. Pour limiter MyMongo à certaines bases, attribuez `readWrite`/`dbAdmin` sur ces bases uniquement : MyMongo liste seulement les bases autorisées et affiche « Indisponible » pour les statistiques non accessibles. Le renommage de collection nécessite le privilège `renameCollectionSameDB`.

## Reverse proxy HTTPS

Dans `.env` :

```dotenv
MYMONGO_TRUST_PROXY=true
MYMONGO_SECURE_COOKIES=true
MYMONGO_ALLOWED_ORIGINS=https://mymongo.example.com
```

**Nginx** : un exemple complet est fourni dans [`deploy/nginx/mymongo.conf`](deploy/nginx/mymongo.conf).

```bash
sudo cp deploy/nginx/mymongo.conf /etc/nginx/sites-available/mymongo.conf
sudo ln -s /etc/nginx/sites-available/mymongo.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

**Cloudflare Tunnel** : pointez le service du tunnel vers `http://127.0.0.1:8088` (ou vers `http://mymongo:8080` si `cloudflared` tourne dans le même réseau Docker). Protégez idéalement l’accès avec Cloudflare Access en plus de l’authentification MyMongo.

## Mise à jour

```bash
cd MyMongo
git pull
docker compose up -d --build
docker image prune -f
```

Les comptes et le journal d’audit sont conservés dans le volume `mymongo-data`. Les sessions sont fermées au redémarrage : les utilisateurs doivent se reconnecter.

## Sauvegarde et restauration

### Données de MyMongo

Le volume `mymongo-data` contient `users.json` (comptes, mots de passe hachés en scrypt), `avatars/` (photos de profil envoyées, PNG/JPEG/WebP ≤ 512 Ko) et `audit.log`.

```bash
docker run --rm -v mymongo_mymongo-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/mymongo-data-$(date +%F).tar.gz -C /data .

docker compose stop mymongo
docker run --rm -v mymongo_mymongo-data:/data -v "$PWD":/backup alpine \
  sh -c 'tar xzf /backup/mymongo-data-AAAA-MM-JJ.tar.gz -C /data && chown -R 1000:1000 /data'
docker compose start mymongo
```

### Données MongoDB

MyMongo n’est pas un outil de sauvegarde : utilisez les outils officiels.

```bash
mongodump --uri="mongodb://user:pass@127.0.0.1:27017/?authSource=admin" --gzip --archive=mongo-$(date +%F).gz
mongorestore --uri="mongodb://user:pass@127.0.0.1:27017/?authSource=admin" --gzip --archive=mongo-AAAA-MM-JJ.gz
```

L’export JSON/NDJSON de MyMongo conserve les types BSON (Extended JSON) et peut servir à des sauvegardes ponctuelles de collections.

## Variables d’environnement

| Variable                         | Défaut                          | Rôle                                                                        |
| -------------------------------- | ------------------------------- | --------------------------------------------------------------------------- |
| `MONGODB_URI`                    | —                               | URI de la connexion principale (`mongodb://` ou `mongodb+srv://`)           |
| `MONGODB_URI_FILE`               | —                               | Fichier contenant l’URI (alternative à `MONGODB_URI`)                       |
| `MONGODB_LABEL`                  | `MongoDB`                       | Nom affiché de la connexion principale                                      |
| `MYMONGO_CONNECTION_<NOM>_URI`   | —                               | Connexion supplémentaire (`_URI_FILE` accepté)                              |
| `MYMONGO_CONNECTION_<NOM>_LABEL` | `<nom>`                         | Nom affiché de la connexion supplémentaire                                  |
| `MYMONGO_BIND_ADDRESS`           | `127.0.0.1`                     | Interface hôte publiée par Compose                                          |
| `MYMONGO_HOST_PORT`              | `8088`                          | Port hôte publié par Compose                                                |
| `HOST` / `PORT`                  | `127.0.0.1` / `8080`            | Écoute du serveur Node (`0.0.0.0` dans le conteneur)                        |
| `MYMONGO_DATA_DIR`               | `./data` (`/data` en conteneur) | Comptes et journal d’audit                                                  |
| `MYMONGO_TRUST_PROXY`            | `false`                         | Faire confiance aux en-têtes `X-Forwarded-*`                                |
| `MYMONGO_SECURE_COOKIES`         | `true` en production            | Cookie de session `Secure` (préfixe `__Host-`)                              |
| `MYMONGO_ALLOWED_ORIGINS`        | —                               | Origines autorisées pour les requêtes d’écriture, séparées par des virgules |
| `MYMONGO_SESSION_TTL_MINUTES`    | `480`                           | Durée maximale d’une session                                                |
| `MYMONGO_SESSION_IDLE_MINUTES`   | `60`                            | Expiration après inactivité                                                 |
| `MYMONGO_MAX_IMPORT_MB`          | `16`                            | Taille maximale d’un fichier importé                                        |
| `MYMONGO_MAX_EXPORT_DOCS`        | `100000`                        | Nombre maximal de documents par export                                      |
| `MYMONGO_QUERY_TIMEOUT_MS`       | `15000`                         | `maxTimeMS` appliqué aux requêtes et agrégations                            |
| `MYMONGO_LOG_LEVEL`              | `info`                          | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`                |

## Sécurité

- Authentification obligatoire ; aucun compte par défaut ; mots de passe hachés avec scrypt.
- Sessions côté serveur, cookie `HttpOnly`, `SameSite=Strict`, `Secure` et préfixe `__Host-` derrière HTTPS ; expiration absolue et sur inactivité ; sessions invalidées au changement de mot de passe ou à la suppression du compte.
- Protection CSRF : jeton par session exigé sur chaque requête d’écriture + contrôle de l’en-tête `Origin`.
- Limitation des tentatives de connexion (par compte et par IP) avec message générique.
- En-têtes de sécurité (CSP stricte sans script inline, `frame-ancestors 'none'`, HSTS en HTTPS).
- Aucune exécution de JavaScript : filtres et pipelines analysés par un parseur dédié (pas d’`eval`) ; `$where`, `$function` et `$accumulator` refusés ; `$out`/`$merge` réservés aux administrateurs.
- Validation Zod de toutes les entrées, requêtes bornées (`maxTimeMS`, pagination serveur, limites d’export, d’import et d’agrégation).
- Confirmation par saisie du nom pour toute suppression de base, collection, index ou suppression en masse ; bases système protégées ; index `_id_` non supprimable.
- Journal d’audit des opérations administratives, sans mot de passe, jeton ni contenu de document.
- Conteneur non-root, système de fichiers en lecture seule, capacités Linux retirées, `no-new-privileges`.

## Développement

Prérequis : Node.js 22+.

```bash
npm install
cp .env.example .env
```

Dans `.env`, pour le développement local : `NODE_ENV=development`, `MYMONGO_SECURE_COOKIES=false`, `MYMONGO_TRUST_PROXY=false` et un `MONGODB_URI` local. Puis :

```bash
npm run user --workspace server -- user add admin --role admin
npm run dev --workspace server
npm run dev --workspace web
```

L’interface est servie sur `http://127.0.0.1:5173` (Vite relaie `/api` vers `http://127.0.0.1:8080`).

| Commande            | Effet                                                                             |
| ------------------- | --------------------------------------------------------------------------------- |
| `npm test`          | Tests unitaires et d’intégration (MongoDB en mémoire via `mongodb-memory-server`) |
| `npm run typecheck` | Vérification TypeScript des deux workspaces                                       |
| `npm run lint`      | ESLint + Prettier (configuration `gts`)                                           |
| `npm run fix`       | Correction automatique du style                                                   |
| `npm run build`     | Build du frontend puis du serveur                                                 |

Structure :

```
server/src
  auth/        mots de passe, sessions, limitation des tentatives, comptes
  lib/         erreurs, parseur de requêtes, sérialisation BSON, garde-fous, audit, import/export
  modules/     routes : auth, utilisateurs, serveur, bases, documents, agrégations, index, import/export, audit
  mongo/       registre des connexions
web/src
  components/  interface, éditeur JSON, rendu BSON, panneaux et dialogues
  lib/         API, contexte d’authentification, requêtes, thème
  pages/       tableau de bord, base, documents, requêtes, index, import/export, statistiques, paramètres
```
