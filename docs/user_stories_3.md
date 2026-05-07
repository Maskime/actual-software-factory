# User Stories — Épopée 3 : Requirements Qualification Interface

## US-1 — Application web avec interface de chat

**En tant que** utilisateur technique, **je veux** accéder à une application web avec une interface de chat, **afin de** pouvoir qualifier mon besoin de manière conversationnelle depuis mon navigateur.

### Critères d'acceptation
- [ ] Une application web est accessible sur un port local configurable (ex. : `localhost:3000`)
- [ ] L'interface présente un fil de conversation (messages utilisateur + messages assistant)
- [ ] La zone de saisie permet d'envoyer un message avec Entrée ou un bouton
- [ ] Les réponses du backend s'affichent en streaming (token par token)
- [ ] L'interface est utilisable sur desktop sans erreur JavaScript

### Notes techniques
- Stack : Nuxt 4 + Tailwind CSS — cohérent avec la codebase TypeScript strict et la préférence Vue.js
- Le streaming se fait via `fetch` + `ReadableStream` côté client
- Aucune authentification requise pour ce sprint (accès local uniquement)

---

## US-2 — Backend conversationnel alimenté par Claude

**En tant que** application web, **je veux** envoyer les messages de l'utilisateur à Claude et recevoir une réponse en streaming, **afin de** proposer une expérience conversationnelle fluide.

### Critères d'acceptation
- [ ] Un endpoint `POST /api/chat` reçoit l'historique de conversation et retourne un stream SSE
- [ ] Le backend appelle l'API Anthropic avec le modèle `claude-sonnet-4-6`
- [ ] Le système de prompt système est injecté côté serveur (non exposé au client)
- [ ] Les erreurs API Anthropic sont propagées avec un message lisible côté client
- [ ] Le prompt système et le modèle sont configurables via variables d'environnement

### Notes techniques
- Utiliser le SDK `@anthropic-ai/sdk` avec streaming
- Activer le prompt caching sur le `system` prompt (paramètre `cache_control`)
- Ne jamais exposer la clé `ANTHROPIC_API_KEY` côté client

---

## US-3 — Workflow de qualification guidé par questions structurantes

**En tant que** utilisateur, **je veux** être guidé par des questions structurantes, **afin de** ne rien oublier d'essentiel lors de la description de mon besoin.

### Critères d'acceptation
- [ ] Lors du premier message de l'utilisateur, Claude pose des questions sur : contexte métier, objectif fonctionnel, contraintes techniques, définition de "done"
- [ ] Claude ne soumet jamais plus de 3 questions à la fois
- [ ] Claude relance avec des questions de précision si une réponse est trop vague
- [ ] La conversation reste naturelle : pas de formulaire rigide, le dialogue s'adapte aux réponses

### Notes techniques
- Le comportement est entièrement défini par le system prompt — aucune logique côté serveur
- Le system prompt encode explicitement les 4 dimensions à couvrir : contexte, objectif, contraintes, done criteria
- Prompt versionné dans `src/prompts/qualification.ts`

---

## US-4 — Reformulation et confirmation du besoin

**En tant que** utilisateur, **je veux** que Claude reformule mon besoin avant soumission, **afin de** vérifier que le besoin a été correctement compris avant de lancer le pipeline.

### Critères d'acceptation
- [ ] Quand Claude estime avoir collecté suffisamment d'informations, il produit une reformulation structurée : contexte, objectif, contraintes, critères de done
- [ ] La reformulation est présentée comme un bloc distinct et lisible (Markdown)
- [ ] Claude demande explicitement : "Cette reformulation est-elle correcte ?"
- [ ] Si l'utilisateur répond "non" ou formule des corrections, Claude ajuste la reformulation
- [ ] Le cycle reformulation → correction peut se répéter jusqu'à validation

---

## US-5 — Étape de soumission explicite

**En tant que** utilisateur, **je veux** soumettre mon besoin par une action explicite après confirmation, **afin de** garder le contrôle sur le déclenchement du pipeline automatique.

### Critères d'acceptation
- [ ] Après validation de la reformulation, un bouton "Soumettre le besoin" apparaît dans l'interface
- [ ] Tant que le bouton n'est pas cliqué, aucun appel GitLab n'est effectué
- [ ] Un clic sur le bouton déclenche la création GitLab et affiche un indicateur de progression
- [ ] En cas d'erreur lors de la soumission, un message d'erreur clair est affiché et l'utilisateur peut réessayer
- [ ] Une fois soumis avec succès, le lien vers l'epic GitLab créé est affiché dans l'interface

### Notes techniques
- L'état de soumission est géré côté client (`pending` / `submitting` / `done` / `error`)
- Le bouton de soumission est désactivé pendant le traitement pour éviter les doubles envois

---

## US-6 — Création automatique d'un epic GitLab via MCP

**En tant que** backend de soumission, **je veux** créer un epic GitLab à partir du besoin qualifié, **afin de** initialiser le suivi du travail dans GitLab.

### Critères d'acceptation
- [ ] Un epic GitLab est créé avec : titre issu du besoin, description = reformulation structurée complète, label `qualification-interface`
- [ ] L'epic est créé dans le projet GitLab cible configuré via variable d'environnement
- [ ] L'identifiant de l'epic créé est retourné et utilisé pour lier les issues suivantes
- [ ] En cas d'échec de l'appel MCP, une erreur explicite est levée (pas de création partielle silencieuse)

### Notes techniques
- Appel via le serveur MCP GitLab (EPIC-02) — outil `create_epic`
- La variable `GITLAB_PROJECT_ID` est requise dans `.env`

---

## US-7 — Décomposition automatique en issues GitLab

**En tant que** backend de soumission, **je veux** décomposer le besoin qualifié en issues GitLab liées à l'epic, **afin de** fournir aux agents de développement des tickets exploitables.

### Critères d'acceptation
- [ ] Claude génère entre 2 et 8 issues à partir de la reformulation validée
- [ ] Chaque issue contient : titre, description fonctionnelle, critères d'acceptation, notes techniques si pertinentes
- [ ] Chaque issue est créée dans GitLab avec le label `agent-ready` et liée à l'epic créé
- [ ] Les issues sont créées séquentiellement ; en cas d'erreur sur l'une, les suivantes ne sont pas bloquées et l'erreur est loguée
- [ ] La liste des issues créées (titre + URL) est affichée à l'utilisateur après soumission

### Notes techniques
- La décomposition est produite par un appel Claude dédié avec un prompt structuré (JSON schema en output)
- Le JSON de sortie est validé avec `zod` avant d'appeler le MCP GitLab

---

## US-8 — Format des issues optimisé pour les agents suivants

**En tant que** agent de développement (EPIC-05), **je veux** que les issues GitLab créées contiennent un contexte suffisant, **afin de** pouvoir les traiter sans intervention humaine complémentaire.

### Critères d'acceptation
- [ ] Chaque issue contient une section **Contexte** (pourquoi cette issue existe)
- [ ] Chaque issue contient une section **Critères d'acceptation** sous forme de checklist Markdown
- [ ] Chaque issue contient une section **Contraintes techniques** si des choix de stack sont imposés
- [ ] Le titre de l'issue suit le format `[EPIC-N] Titre court et actionnable`
- [ ] Une issue de test créée manuellement est traitée sans ambiguïté par l'agent de développement (validation manuelle)

### Notes techniques
- Le format est encodé dans le prompt de décomposition (`src/prompts/decomposition.ts`)
- Utiliser des titres impératifs ("Implémenter X", "Créer Y") pour maximiser la clarté pour les agents
