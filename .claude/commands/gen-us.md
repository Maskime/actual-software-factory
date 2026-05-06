---
description: Génère les user stories pour l'épopée numéro $ARGUMENTS sous forme d'issues GitLab
argument-hint: [numéro-épopée]
---

Génère les user stories pour l'épopée numéro $ARGUMENTS.

**Étapes à suivre :**

1. Lis le fichier `docs/epic.md` et trouve l'épopée dont le numéro correspond à `$ARGUMENTS`.

2. Analyse le besoin décrit dans cette épopée pour identifier toutes les user stories nécessaires à sa couverture complète.

3. Pour chaque user story, utilise le format de description suivant :

```
**En tant que** [rôle], **je veux** [action] **afin de** [bénéfice].

## Critères d'acceptation
- [ ] [Condition vérifiable 1]
- [ ] [Condition vérifiable 2]
- [ ] ...

## Notes techniques *(si pertinent)*
- [Note]
```

4. Recherche l'issue Epic dans GitLab via l'outil `gitlab_list_issues` (project_id=`3`, labels=`epic-$ARGUMENTS`).
   - Si une issue est trouvée : utilise son `iid` comme `epic_iid`.
   - Si aucune issue n'est trouvée : crée-la via `gitlab_create_issue` avec :
     - `project_id` : `3`
     - `title` : `EPIC-$ARGUMENTS — [Titre de l'épopée]`
     - `labels` : `epic,epic-$ARGUMENTS`

5. Pour chaque user story, crée une issue GitLab via `gitlab_create_issue` avec :
   - `project_id` : `3`
   - `title` : `US-[N] — [Titre court]`
   - `description` : le contenu formaté ci-dessus
   - `labels` : `user-story,epic-$ARGUMENTS`

   Note l'`iid` retourné pour chaque issue créée.

6. Pour chaque issue US créée, crée un lien vers l'issue Epic via `gitlab_create_issue_link` avec :
   - `project_id` : `3`
   - `issue_iid` : l'iid de l'issue US
   - `target_project_id` : `3`
   - `target_issue_iid` : `epic_iid`
   - `link_type` : `relates_to`

7. Résume les user stories créées sous forme de tableau :

| US | Titre | Issue GitLab | Lien Epic |
|----|-------|-------------|-----------|
| US-1 | … | #IID | ✓ |
| … | … | … | … |
