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

### 1c. Chargement automatique des variables d'environnement (optionnel — direnv)

Le fichier `.envrc` à la racine du projet est conçu pour fonctionner avec [direnv](https://direnv.net/). Il charge automatiquement `infrastructure/.env` dans ton shell dès que tu entres dans le répertoire du projet, sans avoir à sourcer manuellement le fichier à chaque session.

**Pourquoi c'est utile :** les scripts de bootstrap, les commandes `docker compose`, et les outils CLI (comme `tctl`) s'appuient sur les variables d'environnement définies dans `infrastructure/.env`. Sans direnv, il faut préfixer chaque commande ou sourcer manuellement le fichier — avec direnv, tout est disponible automatiquement.

**Installation de direnv :**

```bash
# Ubuntu / Debian / WSL2
sudo apt install direnv

# macOS
brew install direnv
```

Ajoute ensuite le hook dans ton shell (une seule fois) :

```bash
# Pour bash — ajoute dans ~/.bashrc
echo 'eval "$(direnv hook bash)"' >> ~/.bashrc && source ~/.bashrc

# Pour zsh — ajoute dans ~/.zshrc
echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc && source ~/.zshrc
```

Puis autorise le `.envrc` du projet :

```bash
direnv allow .
```

À partir de là, les variables de `infrastructure/.env` sont chargées automatiquement à chaque `cd` dans le projet, et déchargées quand tu en sors.

### 2. Lancer les services

Les serveurs MCP GitLab et Temporal sont buildés localement — compile le TypeScript avant le premier `up` (et après chaque modification des sources) :

```bash
npm install   # installe toutes les dépendances (workspaces npm)
npm run build # compile tous les packages (mcp/gitlab, mcp/temporal, …)
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

## Application web de qualification (Chat UI)

Interface conversationnelle permettant de qualifier un besoin et de générer des tickets GitLab.

**Prérequis :** Node 22+

### Configuration

Copier le fichier d'exemple et le remplir :

```bash
cp apps/chat/.env.example apps/chat/.env
```

| Variable | Obligatoire | Description |
|---|---|---|
| `NUXT_ANTHROPIC_API_KEY` | ✅ | Clé API Anthropic (`sk-ant-…`) — récupérable sur [console.anthropic.com](https://console.anthropic.com) |
| `NUXT_ANTHROPIC_MODEL` | Non | Modèle Claude à utiliser (défaut : `claude-sonnet-4-6`) |
| `NUXT_ANTHROPIC_SYSTEM_PROMPT` | Non | System prompt injecté côté serveur (défaut intégré si absent) |
| `NUXT_PORT` | Non | Port d'écoute du serveur Nuxt (défaut : `3000`) |

> **Sécurité :** `apps/chat/.env` est gitignored. La clé `NUXT_ANTHROPIC_API_KEY` n'est jamais transmise au navigateur — elle est lue exclusivement côté serveur.

### Démarrage

```bash
# Démarrage dev (hot-reload)
make dev-chat
# ou directement :
npm run dev --workspace=apps/chat
```

URL par défaut : `http://localhost:3000`

En production (Docker), le service est inclus dans `docker-compose.yml` :
```bash
docker compose -f infrastructure/docker-compose.yml up -d chat
```

---

## Services

| Service | URL | Credentials |
|---|---|---|
| Chat UI | http://localhost:3000 | — (accès local, pas d'auth) |
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

```bash
make test-mcp
```

Valide de bout en bout que chaque serveur MCP répond correctement (GitLab, SonarQube, Temporal). Si un serveur n'est pas joignable, sa suite s'affiche `⚠ SKIPPED` et les autres continuent.

Voir [docs/mcp-tests.md](docs/mcp-tests.md) pour le détail des suites, le résultat attendu et les variables optionnelles.

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

Voir [docs/troubleshooting.md](docs/troubleshooting.md).
