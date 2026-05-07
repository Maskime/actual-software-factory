# User Stories — Épopée 2 : MCP Communication Layer

## US-01 — Scaffolding du serveur MCP GitLab CE

**En tant que** développeur de la factory, **je veux** disposer d'un serveur MCP dédié à GitLab CE **afin de** fournir aux agents Claude un point d'accès unifié et standardisé à l'API GitLab.

### Critères d'acceptation
- [ ] Un serveur MCP GitLab est initialisé (TypeScript ou Python, SDK MCP officiel)
- [ ] Le serveur se connecte à l'instance GitLab CE via un token d'accès configuré en variable d'environnement
- [ ] Le serveur démarre sans erreur et expose ses outils via le protocole MCP
- [ ] Les erreurs d'authentification GitLab sont propagées avec un message exploitable par l'agent

### Notes techniques
- Utiliser `@modelcontextprotocol/sdk` (Node) ou `mcp` (Python) selon la stack choisie
- Le token GitLab doit avoir les scopes `api` et `read_repository`
- Prévoir une gestion des rate limits de l'API GitLab (retry avec backoff exponentiel)

---

## US-02 — Outils MCP GitLab : gestion des issues

**En tant qu'** agent Claude, **je veux** lire, créer et mettre à jour des issues GitLab via MCP **afin de** piloter le cycle de vie des tickets depuis le pipeline automatisé.

### Critères d'acceptation
- [ ] L'outil `gitlab_get_issue` retourne titre, description, labels, assignees et statut d'une issue par son ID
- [ ] L'outil `gitlab_list_issues` retourne les issues d'un projet avec filtres (label, état, assignee)
- [ ] L'outil `gitlab_create_issue` crée une issue avec titre, description et labels ; retourne l'ID et l'URL créés
- [ ] L'outil `gitlab_update_issue` met à jour titre, description, labels ou statut d'une issue existante
- [ ] L'outil `gitlab_close_issue` ferme une issue ; retourne une confirmation
- [ ] Chaque outil retourne une erreur structurée si l'issue ou le projet n'existe pas

---

## US-03 — Outils MCP GitLab : gestion des Merge Requests

**En tant qu'** agent Claude, **je veux** créer une MR, poster des commentaires et déclencher un merge via MCP **afin d'** automatiser les étapes de revue et d'intégration du code.

### Critères d'acceptation
- [ ] L'outil `gitlab_create_mr` crée une MR depuis une source branch vers une target branch, avec titre et description ; retourne l'IID et l'URL
- [ ] L'outil `gitlab_get_mr` retourne le statut, le diff summary, les labels et les commentaires d'une MR
- [ ] L'outil `gitlab_get_mr_diff` retourne le diff complet (fichiers modifiés, lignes) d'une MR donnée
- [ ] L'outil `gitlab_add_mr_comment` poste un commentaire général sur une MR
- [ ] L'outil `gitlab_add_mr_inline_comment` poste un commentaire inline sur une ligne précise du diff
- [ ] L'outil `gitlab_merge_mr` déclenche le merge d'une MR (fast-forward ou merge commit selon config) ; retourne le statut final
- [ ] Le merge échoue avec un message clair si des discussions non résolues ou des pipelines en échec bloquent la MR

### Notes techniques
- Utiliser l'API GitLab v4 : `/projects/:id/merge_requests`
- Prévoir la gestion de l'état `merge_when_pipeline_succeeds` pour le merge asynchrone

---

## US-04 — Outils MCP GitLab : gestion des branches et commits

**En tant qu'** agent Claude, **je veux** créer des branches et pousser des commits via MCP **afin de** versionner le code généré directement depuis le pipeline sans accès SSH au dépôt.

### Critères d'acceptation
- [ ] L'outil `gitlab_create_branch` crée une branche depuis un ref donné (SHA ou nom de branche) ; retourne le nom et le SHA de tête
- [ ] L'outil `gitlab_list_branches` liste les branches d'un projet avec leur SHA de tête
- [ ] L'outil `gitlab_commit_files` crée un commit avec un ou plusieurs fichiers (create/update/delete) sur une branche existante ; retourne le SHA du commit
- [ ] L'outil `gitlab_get_file` retourne le contenu d'un fichier pour un ref donné
- [ ] L'outil `gitlab_get_repository_tree` retourne l'arborescence d'un répertoire pour un ref donné
- [ ] Le commit échoue avec un message clair si la branche n'existe pas ou si un conflit est détecté

### Notes techniques
- Utiliser l'endpoint `POST /projects/:id/repository/commits` (actions multiples en un seul appel)
- Le contenu des fichiers doit être encodé en base64 selon les exigences de l'API GitLab

---

## US-05 — Serveur MCP SonarQube

**En tant qu'** agent Claude, **je veux** accéder aux résultats d'analyse SonarQube via MCP **afin de** lire les issues de qualité d'une branche et vérifier le statut du quality gate sans accès direct à l'interface SonarQube.

### Critères d'acceptation
- [ ] Un serveur MCP SonarQube est initialisé et se connecte à l'instance via token configuré en variable d'environnement
- [ ] L'outil `sonar_get_issues` retourne les issues d'un projet pour une branche donnée, filtrables par sévérité (BLOCKER, CRITICAL, MAJOR, MINOR, INFO) et type (BUG, VULNERABILITY, CODE_SMELL, SECURITY_HOTSPOT)
- [ ] L'outil `sonar_get_quality_gate` retourne le statut du quality gate (OK / ERROR) et les conditions échouées pour une branche donnée
- [ ] L'outil `sonar_get_measures` retourne les métriques clés d'un projet (coverage, duplications, technical debt) pour une branche
- [ ] Les outils retournent une erreur structurée si le projet ou la branche n'existe pas dans SonarQube

### Notes techniques
- Utiliser l'API Web SonarQube : `/api/issues/search`, `/api/qualitygates/project_status`, `/api/measures/component`
- Le token SonarQube doit avoir le rôle `Browse` sur les projets analysés
- Prévoir la pagination des résultats (`p` + `ps` params) pour les projets avec de nombreuses issues

---

## US-06 — Wrapper MCP Temporal

**En tant qu'** agent Claude, **je veux** envoyer des signaux à des workflows Temporal et interroger leur état via MCP **afin de** permettre aux agents de s'intégrer dans l'orchestration du pipeline sans couplage direct au SDK Temporal.

### Critères d'acceptation
- [ ] Un wrapper MCP Temporal est initialisé et se connecte au Temporal server via les paramètres configurés en variables d'environnement
- [ ] L'outil `temporal_send_signal` envoie un signal nommé à un workflow ID donné avec une payload JSON optionnelle ; retourne une confirmation
- [ ] L'outil `temporal_get_workflow_status` retourne l'état d'un workflow (Running, Completed, Failed, TimedOut, Cancelled) et le résultat si terminé
- [ ] L'outil `temporal_list_workflows` retourne les workflows actifs d'un namespace, filtrables par état et type
- [ ] Les outils retournent une erreur structurée si le workflow n'existe pas ou si le signal est rejeté

### Notes techniques
- Utiliser le SDK Temporal (Python `temporalio` ou TypeScript `@temporalio/client`) côté wrapper
- Le namespace Temporal cible doit être configurable en variable d'environnement
- Prévoir la gestion du TLS si Temporal est configuré avec mTLS

---

## US-07 — Tests de round-trip MCP

**En tant que** développeur de la factory, **je veux** disposer de tests de round-trip pour chaque serveur MCP **afin de** valider de bout en bout que les agents peuvent lire, écrire et vérifier des données dans GitLab, SonarQube et Temporal via MCP.

### Critères d'acceptation
- [ ] Un test GitLab crée une issue, la relit, la met à jour, crée une branche, pousse un commit, ouvre une MR, poste un commentaire et vérifie que tout est cohérent dans GitLab
- [ ] Un test SonarQube déclenche (ou simule) une analyse, lit les issues retournées et vérifie le statut du quality gate via MCP
- [ ] Un test Temporal démarre un workflow de test, envoie un signal via MCP, interroge son état et vérifie la transition correcte
- [ ] Chaque test est idempotent : les ressources créées sont nettoyées à la fin du test
- [ ] Les tests peuvent être lancés via une commande unique (ex. `make test-mcp`) depuis la racine du projet
- [ ] Les résultats des tests sont affichés avec un résumé clair (pass/fail par outil)

### Notes techniques
- Utiliser les instances GitLab, SonarQube et Temporal de développement (non production)
- Les tests peuvent s'appuyer sur le SDK MCP client ou instancier directement les serveurs en local
- Définir des données de test isolées (projet GitLab dédié, namespace Temporal de test)
