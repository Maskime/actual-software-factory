# Software Factory — Epics

## Stack de référence

| Composant | Outil retenu | Mode |
|---|---|---|
| Ticketing + Versionning + CI/CD | GitLab CE | On-prem |
| Analyse statique | SonarQube Community Edition | On-prem |
| Orchestrateur de pipeline | Temporal | On-prem |
| LLM | Claude (Anthropic API) | Cloud |
| Communication agents ↔ outils | MCP servers | On-prem |

---

## EPIC-01 — Infrastructure & Platform

**Objectif** : Déployer et configurer l'ensemble des services socle sur lesquels repose la factory.

**Périmètre**
- Déploiement GitLab CE (Docker Compose ou Kubernetes)
- Déploiement SonarQube Community Edition
- Déploiement Temporal (server, UI, worker runtime)
- Configuration réseau inter-services (GitLab ↔ SonarQube via webhook CI)
- Gestion des secrets (API keys Anthropic, tokens GitLab, tokens SonarQube)

**Dépendances** : Aucune — socle de tout le reste.

**Critères de done**
- GitLab CE accessible, un projet de test créé avec CI activé
- SonarQube accessible, un projet de test analysé avec succès
- Temporal UI accessible, un worker enregistré et healthy
- Les trois services communiquent entre eux sans erreur

---

## EPIC-02 — MCP Communication Layer

**Objectif** : Exposer les outils tiers (GitLab, SonarQube, Temporal) via des serveurs MCP consommables par les agents Claude.

**Périmètre**
- Serveur MCP GitLab CE : issues (lecture/création/mise à jour), MR (création/commentaires/merge), branches, commits
- Serveur MCP SonarQube : lecture des issues par branche, statut de qualité gate
- Wrapper MCP Temporal : envoi de signaux, requêtes d'état de workflow
- Tests de round-trip pour chaque outil (lecture → écriture → vérification)

**Dépendances** : EPIC-01.

**Critères de done**
- Un agent Claude peut créer une issue GitLab, ouvrir une MR et poster un commentaire via MCP
- Un agent Claude peut lire les issues SonarQube d'une branche donnée via MCP
- Un agent Claude peut envoyer un signal Temporal et interroger l'état d'un workflow via MCP

---

## EPIC-03 — Requirements Qualification Interface

**Objectif** : Permettre à un utilisateur technique de qualifier son besoin au travers d'une interface conversationnelle, puis de le soumettre pour traitement automatique.

**Périmètre**
- Application web avec interface de chat (Claude en backend)
- Workflow de qualification guidé : questions structurantes, reformulation, confirmation
- Étape de soumission explicite (l'utilisateur valide avant envoi)
- Création automatique d'un epic + des issues associées dans GitLab via MCP
- Traduction des besoins en format epic/user story lisible par les agents suivants

**Dépendances** : EPIC-02.

**Critères de done**
- Un utilisateur peut qualifier un besoin de bout en bout sans intervention technique
- À la soumission, l'epic et les issues apparaissent dans GitLab avec les bons labels et descriptions
- Les issues contiennent suffisamment de contexte pour qu'un agent de développement les traite sans ambiguïté

---

## EPIC-04 — Temporal Orchestration Framework

**Objectif** : Définir le workflow Temporal qui orchestre l'ensemble du pipeline (étapes 4 à 10), gère les états, les erreurs et les points de contrôle humain.

**Périmètre**
- Définition du workflow principal couvrant : dev → revue → fix revue → analyse statique → fix statique → merge
- Retry policies et timeouts configurés par étape
- Signal human-in-the-loop avant le merge final (optionnel, activable par configuration)
- Gestion des erreurs : échec d'agent → alerte + suspension du workflow
- Monitoring via Temporal UI : état par étape, historique, logs

**Dépendances** : EPIC-01.

**Critères de done**
- Le workflow complet peut être déclenché depuis une issue GitLab
- Chaque étape dispose de son retry policy et timeout
- Un workflow suspendu peut être repris manuellement via signal Temporal
- L'état de chaque pipeline run est visible dans la Temporal UI

---

## EPIC-05 — Development Agent (Agent 1)

**Objectif** : Lire un ticket GitLab et produire le code correspondant sous forme d'une MR prête à être revue.

**Périmètre**
- Lecture de l'issue GitLab (titre, description, critères d'acceptance) via MCP
- Récupération du contexte du repository (arborescence, fichiers pertinents)
- Génération du code avec Claude (prompt engineering adapté au type de ticket)
- Création d'une feature branch et push des commits via MCP GitLab
- Ouverture d'une MR liée à l'issue, avec description générée automatiquement
- Signal Temporal à la fin de l'étape

**Dépendances** : EPIC-02, EPIC-04.

**Critères de done**
- À partir d'une issue GitLab, une MR est créée avec du code fonctionnel sur une feature branch
- La MR est liée à l'issue et contient une description expliquant les choix d'implémentation
- Le workflow Temporal passe à l'étape suivante après signal de l'agent

---

## EPIC-06 — Code Review Agent (Agent 2)

**Objectif** : Analyser le diff de la MR et produire une revue de code structurée avec classification des feedbacks.

**Périmètre**
- Déclenchement par signal Temporal quand la MR est ouverte
- Lecture du diff complet via MCP GitLab
- Analyse avec Claude selon des critères définis (qualité, lisibilité, sécurité, cohérence)
- Classification des commentaires : **bloquant** / **modéré** / **esthétique**
- Publication des commentaires sur la MR via MCP GitLab
- Création d'issues GitLab dans le backlog pour chaque feedback **modéré**
- Signal Temporal à la fin de l'étape

**Dépendances** : EPIC-05.

**Critères de done**
- Chaque commentaire posté sur la MR est clairement classifié (label visible)
- Les feedbacks modérés apparaissent comme issues dans le backlog GitLab
- Les feedbacks esthétiques sont présents dans la MR mais n'entraînent aucune action automatique
- Le workflow Temporal passe à l'étape suivante après signal de l'agent

---

## EPIC-07 — Review Implementation Agent (Agent 3)

**Objectif** : Traiter les feedbacks bloquants de la revue de code et les intégrer sur la branche MR.

**Périmètre**
- Lecture des commentaires bloquants de la MR via MCP GitLab
- Implémentation des corrections avec Claude (un commit par feedback traité)
- Push des commits sur la branche MR existante via MCP GitLab
- Création d'issues GitLab dans le backlog pour les feedbacks modérés non encore inscrits
- Signal Temporal à la fin de l'étape

**Dépendances** : EPIC-06.

**Critères de done**
- Tous les commentaires bloquants sont résolus et les corrections committées sur la branche MR
- Aucun feedback bloquant restant non traité
- Le workflow Temporal passe à l'étape suivante (analyse statique) après signal de l'agent

---

## EPIC-08 — Static Analysis Integration

**Objectif** : Déclencher automatiquement une analyse SonarQube sur la branche MR après chaque push et rendre les résultats exploitables par les agents.

**Périmètre**
- Pipeline GitLab CI configuré pour se déclencher sur push de la branche MR
- Étape d'analyse SonarQube dans le pipeline CI (scanner + envoi des résultats à SonarQube)
- Exposition des résultats via l'API SonarQube (consommée par le MCP SonarQube d'EPIC-02)
- Webhook GitLab → Temporal pour signaler la fin du pipeline CI

**Dépendances** : EPIC-01.

**Critères de done**
- Chaque push sur la branche MR déclenche automatiquement un scan SonarQube
- Les issues détectées sont visibles via l'API SonarQube filtrée par branche
- Temporal reçoit un signal à la fin du pipeline CI avec le statut (passed/failed)

---

## EPIC-09 — Static Analysis Agent (Agent 4)

**Objectif** : Traiter les issues SonarQube bloquantes, inscrire les modérées au backlog, et déclencher le merge si aucun bloquant ne subsiste.

**Périmètre**
- Lecture des issues SonarQube de la branche MR via MCP SonarQube
- Implémentation des issues **bloquantes** (bugs, vulnerabilities, security hotspots critiques) avec Claude
- Push des corrections sur la branche MR via MCP GitLab
- Création d'issues GitLab dans le backlog pour les issues **modérées**
- Vérification finale : aucun bloquant restant (revue + SonarQube)
- Déclenchement du merge de la MR via MCP GitLab
- Signal Temporal de fin de pipeline

**Dépendances** : EPIC-07, EPIC-08.

**Critères de done**
- Toutes les issues SonarQube bloquantes sont corrigées et committées
- Les issues modérées sont inscrites au backlog GitLab
- Le merge est effectué automatiquement si et seulement si aucun bloquant ne subsiste
- Le workflow Temporal est marqué comme terminé avec succès

---

## EPIC-11 — Portail Utilisateur

**Objectif** : Fournir une interface web unifiée permettant à l'utilisateur de s'authentifier via GitLab, de superviser l'état de ses projets dans le pipeline de développement, et de qualifier de nouveaux besoins via le chat.

**Périmètre**
- Authentification OAuth GitLab (délégation complète : login + contrôle d'accès aux projets)
- Vue liste des projets si l'utilisateur a accès à plusieurs projets GitLab ; redirection directe vers le dashboard si un seul projet est accessible
- Dashboard projet : issues regroupées par statut de workflow (`Ouvert` → `Dev en cours` → `Review` → `Correctifs` → `Analyse SonarQube` → `Mergé`), lecture seule
- Chat de qualification intégré (refactorisation de `apps/chat/`) avec contexte projet pré-rempli au démarrage (README.md + CLAUDE.md du dépôt GitLab correspondant)
- Navigation unifiée entre dashboard et chat au sein d'un même projet
- Stack : Nuxt 4 + Tailwind CSS + Vue 3 Composition API

**Dépendances** : EPIC-02 (MCP GitLab pour lecture des issues et récupération des fichiers de contexte), EPIC-03 (chat de qualification absorbé).

**Critères de done**
- Un utilisateur peut se connecter via son compte GitLab (OAuth)
- Selon le nombre de projets accessibles, il arrive sur la liste des projets ou directement sur le dashboard
- Le dashboard affiche les issues du projet regroupées par statut de workflow, en lecture seule
- Le chat s'ouvre avec le contexte du projet (README.md + CLAUDE.md) pré-chargé
- L'application `apps/chat/` est intégrée dans la nouvelle app (plus de standalone)

---

## EPIC-10 — Quality & Observability

**Objectif** : Garantir la qualité des agents dans le temps et offrir une visibilité complète sur les pipelines en cours et passés.

**Périmètre**
- Framework d'évaluation des prompts agents : jeux de tests, métriques de qualité de sortie
- Audit trail par pipeline run : logs structurés de chaque décision agent (entrée, sortie, outil appelé)
- Métriques opérationnelles : durée par étape, taux de succès, nombre de cycles de revue, volume de feedbacks
- Alerting : pipeline bloqué depuis plus de X minutes → notification (email, webhook)
- Dashboard de suivi (Temporal UI + métriques custom)

**Dépendances** : EPIC-05 à EPIC-09 (transversal).

**Critères de done**
- Chaque pipeline run dispose d'un audit trail complet et consultable
- Les métriques clés sont collectées et visualisables
- Une alerte se déclenche si un pipeline reste bloqué au-delà du seuil configuré
- Les prompts des agents peuvent être évalués et itérés sans redéploiement complet
