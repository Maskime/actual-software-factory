# User Stories — Épopée 1 : Infrastructure & Platform

## US-01 — Déploiement de GitLab CE

**En tant que** DevOps engineer, **je veux** déployer GitLab CE via Docker Compose (ou Kubernetes) **afin de** disposer d'un gestionnaire de code source, de tickets et de CI/CD sur l'infrastructure locale.

### Critères d'acceptation
- [ ] GitLab CE est accessible via un navigateur sur l'URL configurée
- [ ] L'interface d'administration est fonctionnelle et sécurisée (mot de passe root changé)
- [ ] Le service redémarre automatiquement après un reboot de l'hôte
- [ ] Les données GitLab (repos, issues) sont persistées dans un volume dédié

### Notes techniques
- Choisir entre Docker Compose et Kubernetes selon l'environnement cible
- Prévoir les ressources minimales recommandées par GitLab (4 Go RAM min)

---

## US-02 — Configuration d'un projet GitLab avec CI activé

**En tant que** DevOps engineer, **je veux** créer un projet de test dans GitLab et y activer le CI/CD **afin de** valider que l'instance est opérationnelle et prête à exécuter des pipelines.

### Critères d'acceptation
- [ ] Un projet de test existe dans GitLab avec un dépôt initialisé
- [ ] Un fichier `.gitlab-ci.yml` minimal déclenche un pipeline sur chaque push
- [ ] Le pipeline de test s'exécute avec succès et son statut est visible dans l'UI GitLab
- [ ] Un runner GitLab est enregistré et disponible pour exécuter les jobs CI

---

## US-03 — Déploiement de SonarQube Community Edition

**En tant que** DevOps engineer, **je veux** déployer SonarQube Community Edition **afin de** disposer d'un outil d'analyse statique de code accessible par la factory.

### Critères d'acceptation
- [ ] SonarQube est accessible via un navigateur sur l'URL configurée
- [ ] L'interface d'administration est fonctionnelle et sécurisée (mot de passe admin changé)
- [ ] Le service redémarre automatiquement après un reboot de l'hôte
- [ ] Les données SonarQube sont persistées dans un volume dédié

### Notes techniques
- SonarQube Community requiert Elasticsearch ; vérifier `vm.max_map_count` sur l'hôte
- Prévoir une base de données externe (PostgreSQL recommandé) plutôt que H2 pour la production

---

## US-04 — Analyse d'un projet de test dans SonarQube

**En tant que** DevOps engineer, **je veux** configurer et analyser un projet de test dans SonarQube **afin de** valider que l'instance reçoit bien les résultats d'analyse et que l'API est exploitable.

### Critères d'acceptation
- [ ] Un projet de test existe dans SonarQube avec une clé de projet définie
- [ ] Une analyse SonarQube est exécutée avec succès sur le projet de test
- [ ] Les résultats de l'analyse (issues, quality gate) sont visibles dans l'UI SonarQube
- [ ] L'API SonarQube retourne les issues du projet pour une branche donnée

---

## US-05 — Déploiement de Temporal (server, UI, worker runtime)

**En tant que** DevOps engineer, **je veux** déployer Temporal server, son UI et un worker runtime **afin de** disposer d'un orchestrateur capable d'exécuter les workflows de la factory.

### Critères d'acceptation
- [ ] Temporal server est démarré et accessible (port gRPC + port HTTP)
- [ ] Temporal UI est accessible via un navigateur sur l'URL configurée
- [ ] Un namespace de test est créé dans Temporal
- [ ] Un worker de test s'enregistre auprès du server et apparaît comme "healthy" dans la Temporal UI
- [ ] Le service redémarre automatiquement après un reboot de l'hôte

### Notes techniques
- Utiliser `temporalio/server` + `temporalio/ui` via Docker Compose
- Prévoir une base de données persistante (PostgreSQL ou MySQL) pour Temporal

---

## US-06 — Configuration du réseau inter-services

**En tant que** DevOps engineer, **je veux** configurer la communication réseau entre GitLab, SonarQube et Temporal **afin de** permettre aux services de s'appeler mutuellement sans erreur.

### Critères d'acceptation
- [ ] GitLab peut déclencher un webhook vers Temporal (signal en fin de pipeline CI)
- [ ] Le runner GitLab CI peut envoyer des résultats d'analyse à SonarQube (scanner → SonarQube API)
- [ ] Les trois services sont joignables depuis un réseau Docker commun (ou namespace Kubernetes)
- [ ] Aucun appel inter-service ne retourne d'erreur de connectivité dans les logs

### Notes techniques
- Définir un réseau Docker nommé partagé entre les Compose files des différents services
- Configurer les URLs internes (noms de services Docker) pour les appels inter-services

---

## US-07 — Gestion sécurisée des secrets

**En tant que** DevOps engineer, **je veux** centraliser et sécuriser les secrets de la factory (API key Anthropic, tokens GitLab, tokens SonarQube) **afin de** ne pas les exposer en clair dans les fichiers de configuration versionnés.

### Critères d'acceptation
- [ ] Les secrets ne sont pas commités en clair dans le dépôt Git (vérification via `.gitignore` ou scan de secrets)
- [ ] Chaque service accède à ses secrets via des variables d'environnement ou un mécanisme de vault
- [ ] Un fichier `.env.example` documente les clés attendues sans les valeurs
- [ ] La rotation d'un secret ne nécessite pas de redéploiement complet des services

### Notes techniques
- Utiliser un fichier `.env` local (hors versioning) ou Docker secrets / Kubernetes secrets selon l'environnement
- Envisager HashiCorp Vault pour les environnements de production
