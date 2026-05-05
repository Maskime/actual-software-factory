# Software Factory

Pipeline de développement automatisé : de la qualification du besoin au merge, orchestré par des agents Claude.

```
Besoin utilisateur → GitLab (issues) → Temporal → Agent dev → Agent review
                                                             → Agent fix review
                                                             → SonarQube → Agent fix static
                                                                         → Merge
```

## Prérequis

- Docker + Docker Compose
- `jq` (utilisé par les scripts de setup)

## Démarrage

### 1. Configuration

```bash
cp infrastructure/.env.example infrastructure/.env
```

Édite `infrastructure/.env` :

```env
# GitLab
GITLAB_EXTERNAL_URL=http://localhost
GITLAB_ROOT_PASSWORD=ton_mot_de_passe_fort
GITLAB_TEST_PROJECT_NAME=factory-test

# SonarQube
SONARQUBE_EXTERNAL_URL=http://localhost:9000
SONARQUBE_ADMIN_PASSWORD=ton_mot_de_passe_fort
SONARQUBE_DB_PASSWORD=ton_mot_de_passe_db
SONARQUBE_TEST_PROJECT_KEY=factory-test

# Temporal
TEMPORAL_EXTERNAL_URL=http://localhost:8080
TEMPORAL_DB_PASSWORD=ton_mot_de_passe_db_temporal

# Secrets transversaux (requis dès EPIC-02 — agents LLM)
ANTHROPIC_API_KEY=sk-ant-...
GITLAB_API_TOKEN=glpat-...
SONARQUBE_AGENT_TOKEN=squ_...
GITLAB_WEBHOOK_SECRET=$(openssl rand -hex 32)
```

> **Sécurité :** `infrastructure/.env` est gitignored — ne jamais le commiter. Toutes les clés attendues sont documentées sans valeur dans `infrastructure/.env.example`.

### 1b. Vérification des secrets (optionnel)

Avant de commiter, vérifier qu'aucun secret n'est exposé :

```bash
bash infrastructure/scripts/check-secrets.sh
```

Pour l'installer comme pre-commit hook Git :

```bash
cp infrastructure/scripts/check-secrets.sh .git/hooks/pre-commit
chmod +x .git/hooks/pre-commit
```

### 2. Lancer les services

Les serveurs MCP GitLab et Temporal sont buildés localement — compile le TypeScript avant le premier `up` (et après chaque modification des sources) :

```bash
cd mcp/gitlab && npm install && npm run build && cd -
cd mcp/temporal && npm install && npm run build && cd -
```

Lance ensuite toute la stack :

```bash
docker compose -f infrastructure/docker-compose.yml up -d
```

GitLab prend environ **3 à 5 minutes** à démarrer, SonarQube **2 à 4 minutes** supplémentaires. Tu peux suivre :

```bash
docker logs -f gitlab
docker logs -f sonarqube
```

### 3. Prérequis hôte — SonarQube (une fois par machine)

SonarQube embarque Elasticsearch, qui utilise massivement les fichiers mappés en mémoire (`mmap`) pour ses index. Le noyau Linux limite par défaut ce nombre à ~65 530, ce qui est insuffisant — Elasticsearch refuse de démarrer en dessous de 524 288.

`vm.max_map_count` est un **paramètre noyau** (`sysctl`) : il ne peut pas être modifié depuis l'intérieur d'un container (les containers partagent le noyau de l'hôte et n'ont pas ce privilège). La commande doit donc être lancée **sur l'hôte** — sous WSL2, c'est dans la VM WSL2 elle-même.

```bash
sudo sysctl -w vm.max_map_count=524288
# Persister au reboot (nécessaire sous WSL2 dont la VM se réinitialise à chaque redémarrage Windows) :
echo 'vm.max_map_count=524288' | sudo tee /etc/sysctl.d/sonarqube.conf
```

### 4. Bootstrap GitLab (première fois uniquement)

```bash
bash infrastructure/scripts/setup-gitlab.sh
```

Ce script :
- Attend que GitLab soit healthy
- Crée un Personal Access Token root temporaire
- Crée le projet de test (`factory-test` par défaut)
- Enregistre un runner Docker (`factory-runner`)
- Pousse un `.gitlab-ci.yml` minimal et attend que le pipeline passe

Le script est idempotent — safe à relancer.

### 5. Bootstrap SonarQube (première fois uniquement)

```bash
bash infrastructure/scripts/setup-sonarqube.sh
```

Ce script :
- Vérifie `vm.max_map_count` et bloque si insuffisant
- Attend que SonarQube soit en statut `UP`
- Remplace le mot de passe admin par défaut (`admin`) par `SONARQUBE_ADMIN_PASSWORD`

Le script est idempotent — safe à relancer.

### 6. Bootstrap Temporal (première fois uniquement)

```bash
bash infrastructure/scripts/setup-temporal.sh
```

Ce script :
- Attend que le serveur Temporal soit healthy
- Crée le namespace `factory-test` (avec une rétention de 3 jours)
- Attend que le worker de test soit connecté (pollers visibles sur `factory-test-queue`)
- Exécute `HealthCheckWorkflow` en vérification end-to-end

Le script est idempotent — safe à relancer.

> **Note :** le conteneur `temporal-worker-test` démarre en boucle retry tant que le namespace `factory-test` n'existe pas. C'est le comportement attendu avant que ce script soit exécuté.

### 7. Analyse de test SonarQube (première fois uniquement)

```bash
bash infrastructure/scripts/setup-sonarqube-analysis.sh
```

Ce script (prérequis : `setup-sonarqube.sh` déjà exécuté) :
- Crée le projet de test (`SONARQUBE_TEST_PROJECT_KEY`) dans SonarQube
- Génère un token scanner dédié (`factory-scanner`)
- Lance `sonarsource/sonar-scanner-cli` via Docker sur `infrastructure/sonarqube-test/`
- Attend la fin de l'analyse et vérifie que l'API retourne des issues pour `branch=main`
- Affiche l'URL du tableau de bord et le statut du quality gate

Le script est idempotent — safe à relancer.

### 8. Intégration GitLab ↔ SonarQube (configuration manuelle)

Après le bootstrap complet (scripts individuels ou `setup-all.sh`), la connexion DevOps Platform entre SonarQube et GitLab doit être configurée manuellement dans l'interface SonarQube :

**SonarQube → Administration → General Settings → DevOps Platform Integration → GitLab**

| Champ | Valeur |
|---|---|
| GitLab API URL | `http://gitlab/api/v4` |
| Personal Access Token | PAT GitLab avec scope `api` |

> **Prérequis :** un Personal Access Token GitLab est requis pour enregistrer ce paramètre. Tu peux en créer un via **GitLab → User Settings → Access Tokens**.

## Services

| Service | URL | Credentials |
|---|---|---|
| GitLab CE | http://localhost | `root` / `GITLAB_ROOT_PASSWORD` |
| GitLab SSH | ssh://localhost:2222 | — |
| SonarQube | http://localhost:9000 | `admin` / `SONARQUBE_ADMIN_PASSWORD` |
| Temporal UI | http://localhost:8080 | — (pas d'auth par défaut) |
| Temporal gRPC | localhost:7233 | — (workers et clients) |
| Portainer CE | https://localhost:9443 | créé au premier accès |
| MCP GitLab | http://localhost:3001/mcp | token via `GITLAB_API_TOKEN` |
| MCP SonarQube | http://localhost:3002/mcp | token via `SONARQUBE_AGENT_TOKEN` |
| MCP Temporal | http://localhost:3003/mcp | — (réseau interne) |

### Architecture MCP

Les serveurs MCP tournent en containers persistants sur `factory-network` et exposent un endpoint HTTP (`StreamableHTTP`) consommable par les agents Temporal et par Claude Code.

| Serveur | Image | Variables requises |
|---|---|---|
| `mcp-gitlab` | buildée depuis `mcp/gitlab/` | `GITLAB_API_TOKEN`, `GITLAB_API_URL` (auto-configuré) |
| `mcp-sonarqube` | `mcp/sonarqube` (SonarSource officiel) | `SONARQUBE_AGENT_TOKEN` |
| `mcp-temporal` | buildée depuis `mcp/temporal/` | `TEMPORAL_ADDRESS`, `TEMPORAL_NAMESPACE` (auto-configurés) |

Configuration Claude Code (`.mcp.json` à la racine du projet) :

```json
{
  "mcpServers": {
    "gitlab":    { "type": "http", "url": "http://localhost:3001/mcp" },
    "sonarqube": { "type": "http", "url": "http://localhost:3002/mcp" },
    "temporal":  { "type": "http", "url": "http://localhost:3003/mcp" }
  }
}
```

## Tests MCP (round-trip)

Les tests valident de bout en bout que chaque serveur MCP répond correctement à des séquences réalistes de création / lecture / modification / nettoyage, exactement comme un agent Claude le ferait.

### Prérequis

Les trois serveurs MCP doivent être démarrés et les builds TypeScript à jour :

```bash
# Build (une fois, ou après modification des sources)
cd mcp/gitlab && npm install && npm run build && cd -
cd mcp/temporal && npm install && npm run build && cd -

# Démarrer les services
docker compose -f infrastructure/docker-compose.yml up -d \
  gitlab sonarqube temporal temporal-worker-test \
  mcp-gitlab mcp-sonarqube mcp-temporal

# Installer les dépendances du package de tests (une fois)
cd mcp/tests && npm install && cd -
```

### Lancer les tests

```bash
make test-mcp
```

Les variables d'environnement sont chargées automatiquement depuis `infrastructure/.env`. Les trois suites s'exécutent séquentiellement.

### Ce que testent les suites

| Suite | Serveur | Ce qui est vérifié |
|---|---|---|
| **GitLab** | `localhost:3001` | create / read / update issue → create branch → commit → get file → list tree → create MR → comment → read MR → read diff → cleanup |
| **SonarQube** | `localhost:3002` | découverte des outils disponibles, appel issues / quality gate / measures avec le projet `SONARQUBE_TEST_PROJECT_KEY` |
| **Temporal** | `localhost:3003` | démarrage `PingWorkflow` → list workflows → get status → send signal "ping" → attente complétion → vérification état `Completed` |

### Résultat attendu

```
=== MCP Round-Trip Tests ===
  GitLab   : http://localhost:3001/mcp
  SonarQube: http://localhost:3002/mcp
  Temporal : http://localhost:3003/mcp

[GitLab MCP]
  ✓ gitlab_create_issue
  ✓ gitlab_get_issue
  ...
  Summary: 13 passed, 0 failed

[SonarQube MCP]
  ✓ list available tools
  ✓ sonar_search_issues
  ...

[Temporal MCP]
  ✓ start PingWorkflow (SDK direct)
  ✓ temporal_list_workflows
  ✓ temporal_get_workflow_status
  ✓ temporal_send_signal
  ✓ wait for PingWorkflow completion
  ✓ temporal_get_workflow_status (final)
  Summary: 6 passed, 0 failed

=== Global: 25 passed, 0 failed ===
```

Si un serveur n'est pas joignable, sa suite s'affiche `⚠ SKIPPED` et les autres continuent.

### Variables optionnelles

| Variable | Défaut | Description |
|---|---|---|
| `GITLAB_TEST_PROJECT_PATH` | `root/factory-test` | Chemin du projet GitLab utilisé pour les tests |
| `SONARQUBE_TEST_PROJECT_KEY` | `factory-test` | Clé du projet SonarQube analysé |
| `TEMPORAL_ADDRESS` | `localhost:7233` | Adresse gRPC Temporal (pour démarrer les workflows) |
| `TEMPORAL_NAMESPACE` | `factory-test` | Namespace Temporal des workflows de test |
| `TEMPORAL_TEST_TIMEOUT_MS` | `30000` | Timeout (ms) d'attente de complétion du workflow |
| `MCP_GITLAB_URL` | `http://localhost:3001/mcp` | URL du serveur MCP GitLab |
| `MCP_SONARQUBE_URL` | `http://localhost:3002/mcp` | URL du serveur MCP SonarQube |
| `MCP_TEMPORAL_URL` | `http://localhost:3003/mcp` | URL du serveur MCP Temporal |

## Rotation des secrets

Changer un secret ne nécessite pas de redémarrer toute la stack — seul le ou les conteneurs affectés sont recréés :

```bash
# Exemple : rotation du mot de passe BDD SonarQube
vim infrastructure/.env   # 1. Mettre à jour SONARQUBE_DB_PASSWORD
docker compose -f infrastructure/docker-compose.yml \
  up -d --force-recreate sonarqube-db sonarqube   # 2. Recréer uniquement les services affectés
```

La procédure détaillée par type de secret est dans [`docs/secret-rotation.md`](docs/secret-rotation.md).

## Arrêt

```bash
# Arrêter sans supprimer les données
docker compose -f infrastructure/docker-compose.yml down

# Arrêter et supprimer les volumes (repart de zéro)
docker compose -f infrastructure/docker-compose.yml down -v
```

## Résolution de problèmes

**GitLab ignore `GITLAB_ROOT_PASSWORD` au premier démarrage**

```bash
docker exec gitlab cat /etc/gitlab/initial_root_password
```

Ce fichier est supprimé automatiquement 24h après le premier démarrage.

**Le runner ne s'enregistre pas**

Vérifie que `factory-runner` n'est pas déjà présent :

```bash
docker exec gitlab-runner gitlab-runner list
```

Relance `setup-gitlab.sh` si nécessaire (idempotent).

**SonarQube / Elasticsearch : `vm.max_map_count` trop bas**

```bash
sudo sysctl -w vm.max_map_count=524288
# Pour persister :
echo 'vm.max_map_count=524288' | sudo tee /etc/sysctl.d/sonarqube.conf && sudo sysctl --system
```

**SonarQube ne démarre pas après `docker compose up`**

Vérifie les logs Elasticsearch intégrés :

```bash
docker logs sonarqube | grep -i "error\|exception\|max_map"
```

**Temporal : `tctl cluster health` échoue**

Le serveur Temporal met 30 à 60 secondes à initialiser le schéma PostgreSQL au premier démarrage. Attendre et relancer `setup-temporal.sh`.

```bash
docker logs temporal | tail -20
```

**Temporal : worker en boucle retry (`Namespace not found`)**

C'est le comportement attendu tant que `setup-temporal.sh` n'a pas été exécuté. Lancer le script pour créer le namespace `factory-test` :

```bash
bash infrastructure/scripts/setup-temporal.sh
```

**Temporal : aucun poller visible dans l'UI après le bootstrap**

Vérifier que le conteneur worker tourne et s'est connecté :

```bash
docker logs temporal-worker-test
docker exec temporal tctl --namespace factory-test taskqueue describe --taskqueue factory-test-queue
```

**MCP GitLab : `mcp-gitlab` ne démarre pas**

Le container exige que `mcp/gitlab/dist/` existe. Si le build n'a pas été fait :

```bash
cd mcp/gitlab && npm install && npm run build && cd -
docker compose -f infrastructure/docker-compose.yml up -d --build mcp-gitlab
```

**MCP GitLab : erreur d'authentification au démarrage**

```bash
docker logs mcp-gitlab
```

Vérifier que `GITLAB_API_TOKEN` dans `infrastructure/.env` a les scopes `api` et `read_repository`, et que GitLab est healthy avant de démarrer `mcp-gitlab`.

**MCP SonarQube : container en attente de SonarQube**

`mcp-sonarqube` démarre uniquement après que le healthcheck SonarQube passe. Si SonarQube met du temps, le container attend automatiquement grâce au `depends_on: condition: service_healthy`.

```bash
docker logs mcp-sonarqube
```

**MCP Temporal : `mcp-temporal` ne démarre pas**

Le container exige que `mcp/temporal/dist/` existe. Si le build n'a pas été fait :

```bash
cd mcp/temporal && npm install && npm run build && cd -
docker compose -f infrastructure/docker-compose.yml up -d --build mcp-temporal
```

**Tests MCP : suite Temporal en échec (`PingWorkflow` introuvable)**

Le worker `temporal-worker-test` doit être démarré et connecté au namespace `factory-test` avant de lancer les tests. Vérifier :

```bash
docker logs temporal-worker-test
# Doit afficher : "Worker connected — polling factory-test-queue"
```

Si le namespace n'existe pas encore, lancer `setup-temporal.sh` d'abord.

**Tests MCP : `make test-mcp` échoue avec `Cannot find module`**

Les dépendances du package de tests n'ont pas été installées :

```bash
cd mcp/tests && npm install && cd -
make test-mcp
```

**Tests MCP : suite GitLab en échec (`root/factory-test` introuvable)**

Le projet de test doit exister dans GitLab. Lancer `setup-gitlab.sh` ou définir `GITLAB_TEST_PROJECT_PATH` dans `infrastructure/.env` avec le chemin `namespace/projet` correct.

**Mot de passe admin SonarQube oublié**

Relancer `setup-sonarqube.sh` ne fonctionnera plus si ni `admin` ni le mot de passe configuré n'est connu. Réinitialisation via la base :

```bash
docker exec -it sonarqube-db psql -U sonar -c \
  "UPDATE users SET crypted_password = '\$2a\$12\$uCkkXmhW5ThVK8mpBvnXOOJRLd64LJeHTeCkSKiXELNi5GNL9wd9m', salt='', hash_method='BCRYPT' WHERE login='admin';"
```

(remet le mot de passe à `admin`, puis relancer `setup-sonarqube.sh`)
