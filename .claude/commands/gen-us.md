---
description: Génère les user stories pour l'épopée numéro $ARGUMENTS sous forme d'issues GitLab
argument-hint: [numéro-épopée]
---

Génère les user stories pour l'épopée numéro $ARGUMENTS.

> **Source unique :** GitLab est la seule source de vérité. Ne lis jamais `docs/epic.md` ni aucun autre fichier local pour obtenir le contenu d'une épopée.

**Étapes à suivre :**

1. Liste toutes les issues Epic via `gitlab_list_issues` (project_id=`3`, labels=`epic`, state=`all`). Parmi ces issues, cherche celle qui correspond à l'épopée numéro $ARGUMENTS (ex : titre contenant `EPIC-$ARGUMENTS` ou label `epic-$ARGUMENTS`).
   - Si une issue correspondante est trouvée : utilise son `iid` comme `epic_iid` et son champ `description` comme **seule** source du besoin.
   - Si aucune issue correspondante n'est trouvée : **arrête la procédure** et informe l'utilisateur que l'épopée EPIC-$ARGUMENTS n'existe pas dans GitLab. Ne crée jamais l'issue toi-même.

2. Analyse **uniquement** la description de l'issue Epic GitLab récupérée à l'étape précédente pour identifier toutes les user stories nécessaires à sa couverture complète.

3. Présente toutes les user stories proposées à l'utilisateur dans le format suivant, **sans encore créer quoi que ce soit dans GitLab** :

```
**En tant que** [rôle], **je veux** [action] **afin de** [bénéfice].

## Critères d'acceptation
- [ ] [Condition vérifiable 1]
- [ ] [Condition vérifiable 2]
- [ ] ...

## Notes techniques *(si pertinent)*
- [Note]
```

   Affiche toutes les US l'une après l'autre, puis demande explicitement à l'utilisateur : **"Valides-tu ces user stories ? Tu peux demander des modifications avant que je les crée dans GitLab."**

   **Attends la confirmation de l'utilisateur avant de passer à l'étape suivante.** Si l'utilisateur demande des modifications, applique-les et re-présente les US modifiées pour une nouvelle validation.

4. Une fois les US validées par l'utilisateur, crée chaque issue GitLab via `gitlab_create_issue` avec :
   - `project_id` : `3`
   - `title` : `US-[N] — [Titre court]`
   - `description` : le contenu formaté ci-dessus
   - `labels` : `user-story,epic-$ARGUMENTS`

   Note l'`iid` retourné pour chaque issue créée.

5. Pour chaque issue US créée, crée un lien vers l'issue Epic via `gitlab_create_issue_link` avec :
   - `project_id` : `3`
   - `issue_iid` : l'iid de l'issue US
   - `target_project_id` : `3`
   - `target_issue_iid` : `epic_iid`
   - `link_type` : `relates_to`

6. Résume les user stories créées sous forme de tableau :

| US | Titre | Issue GitLab | Lien Epic |
|----|-------|-------------|-----------|
| US-1 | … | #IID | ✓ |
| … | … | … | … |
