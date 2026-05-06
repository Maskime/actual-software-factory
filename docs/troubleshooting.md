# Résolution de problèmes

## GitLab

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

## SonarQube

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

**Mot de passe admin SonarQube oublié**

Relancer `setup-sonarqube.sh` ne fonctionnera plus si ni `admin` ni le mot de passe configuré n'est connu. Réinitialisation via la base :

```bash
docker exec -it sonarqube-db psql -U sonar -c \
  "UPDATE users SET crypted_password = '\$2a\$12\$uCkkXmhW5ThVK8mpBvnXOOJRLd64LJeHTeCkSKiXELNi5GNL9wd9m', salt='', hash_method='BCRYPT' WHERE login='admin';"
```

(remet le mot de passe à `admin`, puis relancer `setup-sonarqube.sh`)

## Temporal

**`tctl cluster health` échoue**

Le serveur Temporal met 30 à 60 secondes à initialiser le schéma PostgreSQL au premier démarrage. Attendre et relancer `setup-temporal.sh`.

```bash
docker logs temporal | tail -20
```

**Worker en boucle retry (`Namespace not found`)**

C'est le comportement attendu tant que `setup-temporal.sh` n'a pas été exécuté. Lancer le script pour créer le namespace `factory-test` :

```bash
bash infrastructure/scripts/setup-temporal.sh
```

**Aucun poller visible dans l'UI après le bootstrap**

Vérifier que le conteneur worker tourne et s'est connecté :

```bash
docker logs temporal-worker-test
docker exec temporal tctl --namespace factory-test taskqueue describe --taskqueue factory-test-queue
```

## MCP GitLab

**`mcp-gitlab` ne démarre pas**

Le container exige que `mcp/gitlab/dist/` existe. Si le build n'a pas été fait :

```bash
npm install && npm run build
docker compose -f infrastructure/docker-compose.yml up -d --build mcp-gitlab
```

**Erreur d'authentification au démarrage**

```bash
docker logs mcp-gitlab
```

Vérifier que `GITLAB_API_TOKEN` dans `infrastructure/.env` a les scopes `api` et `read_repository`, et que GitLab est healthy avant de démarrer `mcp-gitlab`.

## MCP SonarQube

**Container en attente de SonarQube**

`mcp-sonarqube` démarre uniquement après que le healthcheck SonarQube passe. Si SonarQube met du temps, le container attend automatiquement grâce au `depends_on: condition: service_healthy`.

```bash
docker logs mcp-sonarqube
```

## MCP Temporal

**`mcp-temporal` ne démarre pas**

Le container exige que `mcp/temporal/dist/` existe. Si le build n'a pas été fait :

```bash
npm install && npm run build
docker compose -f infrastructure/docker-compose.yml up -d --build mcp-temporal
```

## Tests MCP

**Suite Temporal en échec (`PingWorkflow` introuvable)**

Le worker `temporal-worker-test` doit être démarré et connecté au namespace `factory-test` avant de lancer les tests. Vérifier :

```bash
docker logs temporal-worker-test
# Doit afficher : "Worker connected — polling factory-test-queue"
```

Si le namespace n'existe pas encore, lancer `setup-temporal.sh` d'abord.

**`make test-mcp` échoue avec `Cannot find module`**

Les dépendances n'ont pas été installées depuis la racine :

```bash
npm install
make test-mcp
```

**Suite GitLab en échec (`root/factory-test` introuvable)**

Le projet de test doit exister dans GitLab. Lancer `setup-gitlab.sh` ou définir `GITLAB_TEST_PROJECT_PATH` dans `infrastructure/.env` avec le chemin `namespace/projet` correct.
