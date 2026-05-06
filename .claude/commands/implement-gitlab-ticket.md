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

## Étape 2 — Vérification du ticket sur GitLab

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

## Étape 3 — Gestion de la branche courante

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

## Étape 4 — Création de la branche de travail

```bash
git checkout -b feature/$ARGUMENTS
```

---

## Étape 5 — Affichage du ticket

Affiche un résumé clair du ticket :

```
Ticket  : #<id> — <TITRE>
Statut  : <STATUT>
Labels  : <LABELS>
Auteur  : <AUTEUR>

<DESCRIPTION>
```

---

## Étape 6 — Phase Plan

Utilise `EnterPlanMode`.

Analyse les informations du ticket, explore les fichiers du dépôt concernés et construis un plan d'implémentation détaillé :
- Liste les fichiers à créer ou modifier
- Détaille les actions dans l'ordre d'exécution
- Identifie les dépendances et points d'attention

---

## Étape 7 — Review du plan par sous-agent

Délègue la review via l'outil `Agent` (subagent_type: `Plan`) en lui transmettant :
- Le contenu complet du plan
- Le titre et la description du ticket

Consigne au sous-agent : classifier chaque point de feedback selon l'un des trois niveaux suivants :

- **BLOQUANT** — le plan ne peut pas être accepté en l'état ; correction obligatoire avant d'aller plus loin
- **MAJEUR** — feedback important qui pourrait faire l'objet d'un ticket d'amélioration séparé
- **ESTHETIQUE** — remarque mineure, on peut vivre avec

---

## Étape 8 — Traitement des feedbacks

Pour chaque feedback du sous-agent :

- **BLOQUANT** → corriger le plan en conséquence, puis retourner à l'étape 7 pour un nouveau tour de review
- **MAJEUR** → utiliser `AskUserQuestion` pour demander à l'opérateur ce qu'il souhaite faire :
  - Intégrer dans le plan actuel
  - Créer un ticket GitLab d'amélioration séparé
  - Ignorer pour l'instant
- **ESTHETIQUE** → noter dans le plan, continuer

---

## Étape 9 — Validation du plan

Utilise `ExitPlanMode` pour soumettre le plan révisé à validation utilisateur.

---

## Étape 10 — Implémentation

Exécute le plan validé : crée et modifie les fichiers, lance les tests et le lint au fur et à mesure.

---

## Étape 11 — Vérification

- Lance le lint approprié au scope modifié (ex : `tsc --strict` pour du TypeScript)
- Vérifie chaque exigence du ticket : **satisfait** ou **non satisfait**

---

## Étape 12 — Résumé final

Affiche :

```
Ticket #<id> implémenté ✓
Critères satisfaits : <liste>
Feedbacks MAJEUR traités : <liste ou "aucun">
Lint : <OK | erreurs>
```
