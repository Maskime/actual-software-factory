Génère les user stories pour l'épopée numéro $ARGUMENTS.

**Étapes à suivre :**

1. Lis le fichier `docs/epopee.md` et trouve l'épopée dont le numéro correspond à `$ARGUMENTS`.

2. Analyse le besoin décrit dans cette épopée pour identifier toutes les user stories nécessaires à sa couverture complète.

3. Pour chaque user story, utilise le format suivant :

```
## US-[N] — [Titre court]

**En tant que** [rôle], **je veux** [action] **afin de** [bénéfice].

### Critères d'acceptation
- [ ] [Condition vérifiable 1]
- [ ] [Condition vérifiable 2]
- [ ] ...

### Notes techniques *(si pertinent)*
- [Note]
```

4. Écris toutes les user stories dans le fichier `docs/user_stories_$ARGUMENTS.md` avec cette structure :

```
# User Stories — Épopée $ARGUMENTS : [Titre de l'épopée]

[Liste des user stories]
```

5. Résume brièvement les user stories créées.
