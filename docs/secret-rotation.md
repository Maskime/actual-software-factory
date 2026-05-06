# Rotation des secrets — Software Factory

## Principe

Les secrets sont stockés dans `infrastructure/.env` (jamais commité). Docker Compose injecte ces valeurs comme variables d'environnement au démarrage de chaque conteneur.

**Rotation sans redéploiement complet :** seul le ou les conteneurs qui consomment le secret modifié sont redémarrés. Les autres services restent actifs.

```bash
# Procédure générale
vim infrastructure/.env                  # 1. Modifier la valeur
docker compose -f infrastructure/docker-compose.yml \
  up -d --force-recreate <service>       # 2. Redémarrer uniquement le service concerné
```

`--force-recreate` recrée le conteneur avec les nouvelles variables d'environnement sans toucher aux autres services ni aux volumes de données.

---

## Rotation par secret

### `ANTHROPIC_API_KEY`
**Services affectés :** agents LLM (EPIC-02+, hors périmètre infra actuel)

```bash
# Mettre à jour la clé dans .env, puis redémarrer uniquement les services agents :
docker compose -f infrastructure/docker-compose.yml \
  up -d --force-recreate <nom-service-agent>
```

Obtenir une nouvelle clé : <https://console.anthropic.com/settings/keys>

### `GITLAB_API_TOKEN`
**Services affectés :** agents GitLab (EPIC-02+)

```bash
docker compose -f infrastructure/docker-compose.yml \
  up -d --force-recreate <nom-service-agent-gitlab>
```

Générer un nouveau PAT : GitLab → Préférences → Access Tokens → Révoquer l'ancien, créer le nouveau.

### `GITLAB_ROOT_PASSWORD`
**Services affectés :** `gitlab`

> ⚠ Le mot de passe root GitLab n'est lu qu'à la première initialisation. Pour le changer après démarrage, utiliser l'interface d'administration GitLab ou `gitlab-rails console`.

```bash
# Changement via l'UI (recommandé) :
# GitLab → Admin → Users → root → Edit → Password

# Ou via rails console dans le conteneur :
docker exec -it gitlab gitlab-rails runner \
  "user = User.find_by_username('root'); user.password = 'NouveauMotDePasse!'; user.save!"
```

La variable `GITLAB_ROOT_PASSWORD` dans `.env` n'a d'effet qu'à la création initiale du conteneur.

### `SONARQUBE_ADMIN_PASSWORD`
**Services affectés :** `sonarqube`

Le mot de passe admin SonarQube est géré par l'application, pas par la variable d'environnement après initialisation.

```bash
# Changer via l'API SonarQube :
curl -u admin:"${ANCIEN_MOT_DE_PASSE}" \
  -X POST "${SONARQUBE_EXTERNAL_URL}/api/users/change_password" \
  -d "login=admin&previousPassword=${ANCIEN_MOT_DE_PASSE}&password=${NOUVEAU_MOT_DE_PASSE}"

# Puis mettre à jour .env pour la cohérence de documentation :
# SONARQUBE_ADMIN_PASSWORD=<nouveau>
```

### `SONARQUBE_DB_PASSWORD`
**Services affectés :** `sonarqube-db` et `sonarqube`

> ⚠ Requiert un arrêt bref de SonarQube le temps du changement de mot de passe PostgreSQL.

```bash
# 1. Mettre à jour SONARQUBE_DB_PASSWORD dans .env
# 2. Arrêter SonarQube (pas la DB)
docker compose -f infrastructure/docker-compose.yml stop sonarqube
# 3. Changer le mot de passe dans PostgreSQL
docker exec sonarqube-db psql -U sonar -c \
  "ALTER USER sonar WITH PASSWORD '${NOUVEAU_MOT_DE_PASSE}';"
# 4. Redémarrer les deux services avec les nouvelles variables
docker compose -f infrastructure/docker-compose.yml \
  up -d --force-recreate sonarqube-db sonarqube
```

### `SONARQUBE_AGENT_TOKEN`
**Services affectés :** agent d'analyse statique (EPIC-07)

```bash
# Révoquer l'ancien token dans SonarQube :
curl -u admin:"${SONARQUBE_ADMIN_PASSWORD}" \
  -X POST "${SONARQUBE_EXTERNAL_URL}/api/user_tokens/revoke" \
  -d "name=factory-agent"

# Générer un nouveau token :
curl -u admin:"${SONARQUBE_ADMIN_PASSWORD}" \
  -X POST "${SONARQUBE_EXTERNAL_URL}/api/user_tokens/generate" \
  -d "name=factory-agent&type=GLOBAL_ANALYSIS_TOKEN"

# Mettre à jour .env, puis redémarrer l'agent :
docker compose -f infrastructure/docker-compose.yml \
  up -d --force-recreate <nom-service-agent-sonar>
```

### `TEMPORAL_DB_PASSWORD`
**Services affectés :** `temporal-db` et `temporal`

```bash
# 1. Mettre à jour TEMPORAL_DB_PASSWORD dans .env
# 2. Arrêter Temporal (pas la DB)
docker compose -f infrastructure/docker-compose.yml stop temporal temporal-ui temporal-worker-test
# 3. Changer le mot de passe dans PostgreSQL
docker exec temporal-db psql -U temporal -c \
  "ALTER USER temporal WITH PASSWORD '${NOUVEAU_MOT_DE_PASSE}';"
# 4. Redémarrer avec les nouvelles variables
docker compose -f infrastructure/docker-compose.yml \
  up -d --force-recreate temporal-db temporal temporal-ui temporal-worker-test
```

### `GITLAB_WEBHOOK_SECRET`
**Services affectés :** worker Temporal (validation HMAC) et configuration webhook GitLab

```bash
# 1. Générer un nouveau secret
NEW_SECRET=$(openssl rand -hex 32)
# 2. Mettre à jour .env : GITLAB_WEBHOOK_SECRET=<nouveau>
# 3. Mettre à jour le webhook GitLab :
#    GitLab → Projet → Settings → Webhooks → Modifier → Secret Token
# 4. Redémarrer le worker Temporal
docker compose -f infrastructure/docker-compose.yml \
  up -d --force-recreate <nom-service-worker-temporal>
```

---

## Environnements de production

Pour les déploiements en production, remplacer le fichier `.env` par un gestionnaire de secrets centralisé :

- **HashiCorp Vault** : les conteneurs récupèrent leurs secrets au démarrage via l'agent Vault ou les annotations Vault Injector (Kubernetes). Avantage : audit trail, rotation automatique, chiffrement en transit.
- **Docker Swarm secrets** : `docker secret create` + référence dans le Compose en mode `secrets:`. Adapté si l'orchestration reste sur Docker Swarm.
- **Kubernetes Secrets** (chiffrés au repos via KMS) : montés comme variables d'environnement ou fichiers dans les pods.

Le fichier `.env` est réservé au développement local et aux environnements de validation non critiques.

---

## Vérification post-rotation

Après toute rotation, exécuter le script de scan pour s'assurer qu'aucun secret n'a fuité :

```bash
bash infrastructure/scripts/check-secrets.sh
```
