---
description: Implémente un ticket GitLab avec plan/critique/correction
argument-hint: [id-ticket-gitlab]
---

Implémente le ticket GitLab dont l'identifiant est `$ARGUMENTS`.

## Étape 1 — Validation de l'argument

Si `$ARGUMENTS` est vide, affiche :

```
Erreur : aucun identifiant de ticket fourni.
Usage : /implement-gitlab-ticket <id>
```

Et arrête-toi.

---

## Étape 2 — Renommage de la session

Utilise le Skill `rename` avec l'argument `Implementing #$ARGUMENTS` pour renommer la session courante.

---

## Étape 3 — Vérification du ticket sur GitLab

Utilise l'outil `mcp__gitlab__gitlab_get_issue` avec :
- `project_id` : `3` (projet "Software Factory")
- `issue_iid` : la valeur de `$ARGUMENTS`

Si l'outil retourne une erreur ou qu'aucun ticket n'est trouvé, affiche :

```
Erreur : le ticket #<id> n'existe pas dans le projet Software Factory (ID 3).
```

Et arrête-toi.

Mémorise pour la suite : `TITRE`, `DESCRIPTION`, `LABELS`, `STATUT`, `AUTEUR`.

---

## Étape 4 — Gestion de la branche courante

Vérifie la branche courante avec `git branch --show-current`.

Si elle n'est **pas** `main` :

```bash
git add -u
git commit -m "switching task"
git checkout main
```

Une fois sur `main` :

```bash
git fetch
git rebase origin/main
```

---

## Étape 5 — Création de la branche de travail

```bash
git checkout -b feature/$ARGUMENTS
```

---

## Étape 6 — Affichage du ticket

Affiche un résumé clair du ticket :

```
Ticket  : #<id> — <TITRE>
Statut  : <STATUT>
Labels  : <LABELS>
Auteur  : <AUTEUR>

<DESCRIPTION>
```

---

## Étape 7 — Phase Plan

Utilise `EnterPlanMode`.

Analyse les informations du ticket, explore les fichiers du dépôt concernés et construis un plan d'implémentation détaillé :
- Liste les fichiers à créer ou modifier
- Détaille les actions dans l'ordre d'exécution
- Identifie les dépendances et points d'attention

---

## Étape 8 — Review du plan par sous-agent

Délègue la review via l'outil `Agent` (subagent_type: `Plan`) en lui transmettant :
- Le contenu complet du plan
- Le titre et la description du ticket

Consigne au sous-agent : classifier chaque point de feedback selon l'un des trois niveaux suivants :

- **BLOQUANT** — le plan ne peut pas être accepté en l'état ; correction obligatoire avant d'aller plus loin
- **MAJEUR** — feedback important qui pourrait faire l'objet d'un ticket d'amélioration séparé
- **ESTHETIQUE** — remarque mineure, on peut vivre avec

---

## Étape 9 — Traitement des feedbacks

Pour chaque feedback du sous-agent :

- **BLOQUANT** → corriger le plan en conséquence, puis retourner à l'étape 7 pour un nouveau tour de review
- **MAJEUR** → utiliser `AskUserQuestion` pour demander à l'opérateur ce qu'il souhaite faire :
  - Intégrer dans le plan actuel
  - Créer un ticket GitLab d'amélioration séparé
  - Ignorer pour l'instant
- **ESTHETIQUE** → noter dans le plan, continuer

---

## Étape 10 — Validation du plan

Utilise `ExitPlanMode` pour soumettre le plan révisé à validation utilisateur.

---

## Étape 11 — Implémentation

Exécute le plan validé : crée et modifie les fichiers, lance les tests et le lint au fur et à mesure.

---

## Étape 12 — Vérification

- Lance le lint approprié au scope modifié (ex : `tsc --strict` pour du TypeScript)
- Vérifie chaque exigence du ticket : **satisfait** ou **non satisfait**

---

## Étape 13 — Commit & Push

Committe tous les fichiers modifiés et pousse la branche :

```bash
git add -A
git commit -m "feat(<scope>): <résumé du ticket en une ligne> (#<id>)"
git push -u origin feature/<id>
```

Le message de commit doit refléter le titre du ticket. Le scope est le module principal modifié (ex: `chat`, `mcp-gitlab`, `infra`).

---

## Étape 14 — Création de la Merge Request

Utilise l'outil `mcp__gitlab__gitlab_create_mr` avec :
- `project_id` : `3`
- `source_branch` : `feature/<id>`
- `target_branch` : `main`
- `title` : `<TITRE>` (le titre exact du ticket GitLab)
- `description` : construit selon le modèle ci-dessous

Modèle de description MR :

```
Closes #<id>

## Résumé

<Une ou deux phrases décrivant ce qui a été implémenté.>

## Critères satisfaits

<Liste des critères d'acceptation cochés>

## Notes techniques

<Points d'attention pour le reviewer, choix architecturaux notables, limitations connues — ou "RAS" si rien à signaler.>
```

Affiche l'URL de la MR créée.

---

## Étape 15 — Résumé final

Affiche :

```
Ticket #<id> implémenté ✓
Critères satisfaits : <liste>
Feedbacks MAJEUR traités : <liste ou "aucun">
Lint : <OK | erreurs>
MR : <URL>
```
