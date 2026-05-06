# Tests MCP (round-trip)

Les tests valident de bout en bout que chaque serveur MCP répond correctement à des séquences réalistes de création / lecture / modification / nettoyage, exactement comme un agent Claude le ferait.

## Prérequis

Les trois serveurs MCP doivent être démarrés et les builds TypeScript à jour :

```bash
# Build (une fois, ou après modification des sources)
npm install   # installe toutes les dépendances (workspaces npm)
npm run build # compile tous les packages

# Démarrer les services
docker compose -f infrastructure/docker-compose.yml up -d \
  gitlab sonarqube temporal temporal-worker-test \
  mcp-gitlab mcp-sonarqube mcp-temporal
```

## Lancer les tests

```bash
make test-mcp
```

Les variables d'environnement sont chargées automatiquement depuis `infrastructure/.env`. Les trois suites s'exécutent séquentiellement.

## Ce que testent les suites

| Suite | Serveur | Ce qui est vérifié |
|---|---|---|
| **GitLab** | `localhost:3001` | create / read / update issue → create branch → commit → get file → list tree → create MR → comment → read MR → read diff → cleanup |
| **SonarQube** | `localhost:3002` | découverte des outils disponibles, appel issues / quality gate / measures avec le projet `SONARQUBE_TEST_PROJECT_KEY` |
| **Temporal** | `localhost:3003` | démarrage `PingWorkflow` → list workflows → get status → send signal "ping" → attente complétion → vérification état `Completed` |

## Résultat attendu

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

## Variables optionnelles

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
