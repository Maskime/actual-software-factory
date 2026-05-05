---
description: Implémente les US d'une épopée avec plan/critique/correction
argument-hint: [numéro-épopée]
---

Implémente les user stories de l'épopée $ARGUMENTS.

## Initialisation

Lis le fichier `docs/user_stories_$ARGUMENTS.md` et extrait la liste complète des user stories dans l'ordre. Affiche cette liste avant de commencer.

---

## Cycle par user story

Traite chaque user story dans l'ordre en suivant exactement les étapes ci-dessous.

Lis le fichier `.claude/workflows/us-implementation.md` et applique exactement les étapes qu'il contient.

### Résumé de la US

Affiche : US traitée ✓, critères satisfaits, points modérés notés. Puis passe à la suivante.

---

## Fin de l'épopée

Récapitulatif global : US implémentées, nombre de points modérés dans le backlog, état du lint.
