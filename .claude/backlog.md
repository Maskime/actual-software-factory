# Backlog — Points modérés

## EPIC-05 / US-01 (Agent Worker — Setup container #77)

- [US-1 EPIC-05] M1 : Conflit potentiel de namespace Temporal entre `agent-worker` (namespace `factory`) et `mcp-temporal` (configuré sur `factory-test`) — si des activités agents appellent `mcp-temporal` pour interroger/signaler des workflows, les appels échoueront (namespace mismatch). À corriger lors de l'EPIC-05+ en paramétrant le namespace de `mcp-temporal` via une variable d'environnement ou en documentant la limitation.
- [US-1 EPIC-05] M2 : Healthcheck absent sur `agent-worker` — voir issue GitLab dédiée (créée dans le ticket #77)

## EPIC-02 / US-01 (MCP GitLab — Scaffolding)

- [EPIC-02/US-01] M1 : `moduleResolution: NodeNext` + `module: NodeNext` préférable à `Node16` pour les packages ESM TypeScript 5.0+ (évite les imports `.js` manuels)
- [EPIC-02/US-01] M2 : Ajouter un timeout Axios global (10 s) pour éviter un blocage indéfini si `GITLAB_API_URL` pointe vers un hôte inaccessible
- [EPIC-02/US-01] M3 : Implémenter un `retryDelay` custom dans `axios-retry` pour lire le header `Retry-After` sur 429 (non supporté nativement par la librairie)
- [EPIC-02/US-01] M4 : Extraire `GitLabAuthError` dans un fichier `src/errors.ts` dédié pour préparer `GitLabNotFoundError`, `GitLabRateLimitError` (US-02/03/04)
- [EPIC-02/US-01] M5 : Documenter la procédure de test de connexion MCP dans le README du package (`npx @modelcontextprotocol/inspector`)

- [US-01] M1 : Ajouter une contrainte mémoire (`mem_limit: 4g`) sur le service GitLab pour éviter un OOM kill en co-déploiement avec SonarQube/Elasticsearch
- [US-01] M2 : Épingler l'image `gitlab/gitlab-ce` sur un tag de version stable plutôt que `latest` pour garantir la reproductibilité des déploiements
- [US-01] M3 : Documenter la commande de création explicite du réseau `factory-network` (`docker network create factory-network`) pour les cas où GitLab n'est pas le premier service déployé
- [US-01] M4 : Ajouter un `healthcheck` sur le service GitLab (test : `curl -f http://localhost/-/health`, start_period 120s) pour que les services futurs utilisant `depends_on` sachent quand GitLab est réellement prêt

## US-02

- [US-02] M1 : Remplacer `depends_on: gitlab` par `depends_on: {gitlab: {condition: service_healthy}}` sur `gitlab-runner` une fois le healthcheck GitLab ajouté (lié à US-01 M4)
- [US-02] M2 : Le runner `factory-runner` s'accumule en cas de re-runs multiples du script — ajouter une logique de nettoyage des runners obsolètes via `DELETE /api/v4/runners/:id`
- [US-02] M3 : Le PAT `setup-token` créé par le script doit être révoqué en fin de script si la sécurité l'exige (actuellement conservé sans expiration pour idempotence)

## EPIC-02 / US-02 (MCP GitLab — Issues)

- [EPIC-02/US-02] M1 : Champ `labels` exposé en `z.string()` (format CSV opaque) — préférer `z.array(z.string())` avec jointure virgule côté handler pour un contrat plus clair avec les agents LLM
- [EPIC-02/US-02] M2 : `gitlab_update_issue` avec uniquement `project_id`+`issue_iid` envoie un `PUT {}` silencieux — ajouter un `.refine()` Zod ou une vérification en handler pour rejeter l'appel si aucun champ optionnel n'est fourni
- [EPIC-02/US-02] M3 : `gitlab_create_issue` retourne `id` (global) et `iid` (intra-projet) sans distinguer leur usage — documenter dans la description de l'outil que seul `iid` doit être réutilisé dans les appels suivants
- [EPIC-02/US-02] M4 : `gitlab_close_issue` retourne `closed: issue.state === "closed"` mais ne signale pas explicitement si l'issue était déjà fermée avant l'appel — ajouter un champ `already_closed` pour distinguer les deux cas

## US-03

- [US-03] M1 : `ulimits` incomplet sur le service `sonarqube` — ajouter `nproc: 4096` et `memlock: unlimited` pour couvrir tous les prérequis Elasticsearch (seul `nofile: 65536` est présent)
- [US-03] M2 : Volume `sonarqube_conf` absent — `/opt/sonarqube/conf` (contient `sonar.properties`) n'est pas persisté ; une personnalisation de configuration sera perdue lors d'un `docker compose down -v`
- [US-03] M3 : Images `sonarqube:community` et `postgres:15` non épinglées sur un tag de version précis — risque de régression silencieuse lors d'un `docker compose pull`
- [US-03] M4 : Le script `setup-sonarqube.sh` ne vérifie pas la présence des dépendances `curl` et `python3` en tête de script (pratique standard établie, cohérence avec `setup-gitlab.sh`)

## US-04

- [US-04] M1 : `sonar-project.properties` exclut seulement `sonar-project.properties` — ajouter `sonar.exclusions=sonar-project.properties,**/*.sh` pour éviter que le scanner analyse les fichiers shell et génère des faux positifs dans les résultats
- [US-04] M2 : Le script `setup-sonarqube-analysis.sh` résout le chemin absolu du répertoire source via `cd ... && pwd` au démarrage, mais si le répertoire `sonarqube-test` est absent au moment du sourcing, le script échoue avec un message cryptique — ajouter une vérification explicite de son existence avant l'appel Docker
- [US-04] M3 : Le poll `/api/ce/activity` (étape 5) ne filtre pas par `type=REPORT` — si plusieurs tasks existent, la plus récente (potentiellement `FAILED` d'un run précédent) masque l'analyse en cours ; affiner avec `&type=REPORT&status=SUCCESS,FAILED,IN_PROGRESS`
- [US-04] M4 : La révocation du token `factory-scanner` est inconditionnelle — si un système externe détient ce token et l'utilise en parallèle, il sera invalidé silencieusement ; la révocation conditionnelle (`/api/user_tokens/search` avant de révoquer) serait plus sûre

## US-05

- [US-05] M1 : Épingler `temporalio/auto-setup` et `temporalio/ui` sur un tag de patch précis (ex: `1.26.2`, `2.34.0`) pour garantir la reproductibilité des déploiements
- [US-05] M2 : Ajouter `mem_limit` sur les services Temporal (`temporal`, `temporal-db`, `temporal-worker-test`) pour protéger le co-déploiement avec GitLab et SonarQube
- [US-05] M3 : La variable `TEMPORAL_EXTERNAL_URL` est documentée dans `.env.example` mais pas consommée dans le Compose — l'utiliser dans le résumé du script `setup-temporal.sh` ou la passer à `temporal-ui` via `TEMPORAL_PUBLIC_ADDR`
- [US-05] M4 : `setup-temporal.sh` ne valide pas que `TEMPORAL_DB_PASSWORD` est défini et non égal au placeholder avant de démarrer — ajouter une vérification cohérente avec `setup-sonarqube.sh`
- [US-05] M5 : `temporalio==1.7.0` dans `requirements.txt` devra être mis à jour lors de l'implémentation des agents (EPIC-05–09) pour rester aligné avec la version du serveur Temporal 1.26

## US-06

- [US-06] M1 : Consolider les deux tokens SonarQube (`factory-scanner` de setup-sonarqube-analysis.sh et `gitlab-ci-scanner` de setup-network.sh) en un seul token partagé pour éviter la prolifération de credentials
- [US-06] M2 : Le poll de pipeline (section 6) ne distingue pas les jobs `allow_failure: true` — inspecter le statut individuel des jobs `sonarqube-scan` et `notify-temporal` pour une vérification explicite des critères AC-1 et AC-2
- [US-06] M3 : Images CI non épinglées sur un tag précis (`sonarsource/sonar-scanner-cli:latest`) — épingler sur une version stable pour reproductibilité (`curlimages/curl:7.88.1` déjà épinglé dans `notify-temporal`)
- [US-06] M4 : Le scan de logs (section 7) n'est pas un échec dur alors que AC-4 l'exige — documenter comme limitation connue ou durcir si l'environnement est stable
- [US-06] M5 : Le PAT `network-setup-token` créé par le script n'est pas révoqué en fin d'exécution — cohérence à maintenir avec la politique de révocation des autres scripts

## EPIC-02 / US-04 (MCP GitLab — Branches & Commits)

- [EPIC-02/US-04] M1 : `gitlab_commit_files` n'expose pas `last_commit_id` dans les actions `update` — sans ce guard d'optimisme, deux agents éditant simultanément le même fichier s'écrasent silencieusement (pas de 409 de GitLab sans ce champ)
- [EPIC-02/US-04] M2 : `gitlab_list_branches` retourne au plus 100 entrées sans exposer de signal de troncature ni le total de pages (headers GitLab `X-Total-Pages` non accessibles via `GitLabClient.get<T>()`) — ajouter un champ `has_more` si `branches.length === 100`
- [EPIC-02/US-04] M3 : `errorResponse` et `projectPath` sont dupliqués dans trois fichiers tools (`issues.ts`, `merge_requests.ts`, `branches.ts`) — extraire dans `src/tools/utils.ts` pour éviter de propager les correctifs en trois endroits
- [EPIC-02/US-04] M4 : `gitlab_get_repository_tree` avec `recursive: true` sur un grand dépôt peut retourner des milliers d'entrées tronquées à 100 par l'absence de pagination — exposer un paramètre `page?` ou documenter la limite

## EPIC-02 / US-03 (MCP GitLab — Merge Requests)

- [EPIC-02/US-03] M1 : `gitlab_get_mr` retourne `merge_status` (déprécié depuis GitLab 15.6) mais pas `detailed_merge_status` (`mergeable`, `discussions_not_resolved`, `ci_must_pass`, etc.) — exposer les deux champs pour une décision LLM plus précise
- [EPIC-02/US-03] M2 : `gitlab_get_mr` récupère les notes avec `per_page=100` sans exposer `total_count` ni champ de troncature — ajouter un champ `has_more_comments` si `notes.length === 100` pour signaler que la liste est incomplète
- [EPIC-02/US-03] M3 : `gitlab_merge_mr` ne gère pas le cas où la MR est déjà en état `merged` avant l'appel (GitLab renvoie 406) — actuellement intercepté comme `GITLAB_MERGE_BLOCKED` mais sans distinction explicite du cas "déjà fusionné"
- [EPIC-02/US-03] M4 : `gitlab_add_mr_inline_comment` utilise `file_path` pour `new_path` et `old_path` simultanément — pour les MR qui renomment un fichier, `old_path` et `new_path` diffèrent ; exposer un paramètre optionnel `old_file_path` distinct

## EPIC-02 / US-05 (MCP SonarQube)

- [EPIC-02/US-05] M1 : `sonar_get_issues` n'expose pas de paramètre `pullRequest` — l'API SonarQube distingue `branch` (long-lived) et `pullRequest` (PR analysis) ; les analyses de PR ne sont pas accessibles sans ce paramètre
- [EPIC-02/US-05] M2 : `sonar_get_measures` utilise une liste de métriques fixes (`coverage`, `duplicated_lines_density`, `sqale_index`) — rendre la liste configurable via un paramètre `metrics` optionnel pour permettre aux agents de récupérer d'autres métriques sans modifier le code

## EPIC-02 / US-06 (MCP Temporal — Wrapper)

- [EPIC-02/US-06] M1 : `payload` de `temporal_send_signal` accepte `z.record(z.unknown())` — si un agent passe un payload incompatible avec le handler Temporal (ex. : tableau attendu), l'erreur gRPC retournée est opaque ; documenter la convention dans la description de l'outil
- [EPIC-02/US-06] M2 : `temporal_list_workflows` sanitise `workflow_type` en supprimant les guillemets mais ne protège pas contre les autres caractères spéciaux de la Temporal Visibility Query Language (AND, OR, parenthèses) — ajouter une validation stricte du nom de type (regex `^[A-Za-z0-9_-]+$`)
- [EPIC-02/US-06] M3 : `temporal_list_workflows` ne retourne pas de signal de troncature (`has_more`) quand `results.length === page_size` — ajouter un champ `has_more: boolean` pour signaler que des résultats supplémentaires existent
- [EPIC-02/US-06] M4 : `TemporalConnectionError` est différenciée de l'erreur générique dans `index.ts` mais les deux branches du `catch` produisent le même format de message — envisager d'exposer `err.cause` pour un meilleur diagnostic (TLS vs. adresse injoignable vs. namespace inexistant)
- [EPIC-02/US-06] M5 : Les certificats TLS sont validés à la lecture (`readFileSync`), mais leur contenu (format PEM valide, cohérence cert/clé) n'est pas vérifié avant la tentative de connexion — une erreur de certificat invalide produit un message gRPC peu informatif

## US-07

- [US-07] M1 : Installation du hook pre-commit non automatisée — ajouter un `make install-hooks` ou instruction dans README pour que `check-secrets.sh` soit effectivement installé par chaque développeur
- [US-07] M2 : Les secrets transversaux dans `.env.example` (`ANTHROPIC_API_KEY`, `GITLAB_API_TOKEN`, etc.) sont requis dès EPIC-02 mais non validés au lancement de `docker compose up` — ajouter un guard de présence dans les scripts de setup qui en dépendent
- [US-07] M3 : `SONARQUBE_AGENT_TOKEN` dans `.env.example` coexiste avec les tokens SonarQube existants (`factory-scanner`, `gitlab-ci-scanner`) — consolider en un seul token partagé lors de l'implémentation EPIC-07

## Ticket #24 (US-07 — Décomposition automatique en issues GitLab)

- [Ticket-24] M1 : Aucun test unitaire couvrant la validation Zod (`min(2)`, `max(8)`), le label `agent-ready`, et l'affichage du bloc `technical_notes` dans la description d'issue
- [Ticket-24] M2 : Erreurs de création d'issues silencieuses côté client — l'API retourne HTTP 200 avec `issues: []` même en cas d'échec ; envisager un champ `errors: [{title, status}]` dans la réponse pour informer le frontend

## EPIC-02 / US-07 (Tests round-trip MCP)

- [US-07] M1 : Absence de health-check préalable à la connexion MCP — un serveur non disponible produit un FAIL indiscernable d'un vrai échec fonctionnel pour GitLab et Temporal (SonarQube bénéficie d'un SKIP, les deux autres non)
- [US-07] M2 : Idempotence GitLab non garantie en cas d'échec partiel avant le bloc finally — un crash dans `createMcpClient` avant le try ne nettoie pas les ressources partiellement créées
- [US-07] M3 : `GITLAB_TEST_PROJECT_PATH` doit pointer sur un projet isolé dédié aux tests — si le projet `root/factory-test` est partagé avec d'autres usages, les branches/issues test peuvent entrer en conflit
- [US-07] M4 : Timeout Temporal de 30s non configurable — sur une machine chargée ou si le worker met du temps à démarrer, le workflow peut ne pas se compléter à temps ; exposer `TEMPORAL_TEST_TIMEOUT_MS` (déjà en place dans le code, documenter dans .env.example)
- [US-07] M5 : Endpoint de `mcp-sonarqube` non documenté — l'image officielle `mcp/sonarqube` peut exposer `/mcp`, `/sse` ou `/message` selon la version ; si la connexion échoue, le test est SKIP avec un message clair mais la cause exacte n'est pas diagnostiquée
