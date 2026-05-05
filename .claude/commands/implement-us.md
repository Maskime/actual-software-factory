---
description: Implémente une user story spécifique d'une épopée avec plan/critique/correction
argument-hint: [numéro-épopée] [numéro-us]
---

Implémente la user story $ARGUMENTS (format attendu : `<numéro-épopée> <numéro-us>`, ex : `2 US-5`).

## Initialisation

Parse les arguments : le premier token est le numéro d'épopée, le second est l'identifiant de la US (ex : `US-5`).

Lis le fichier `docs/user_stories_<numéro-épopée>.md`, localise la user story demandée et affiche son titre, sa description et ses critères d'acceptation avant de commencer.

---

## Traitement de la user story

Applique exactement les étapes ci-dessous.

Lis le fichier `.claude/workflows/us-implementation.md` et applique exactement les étapes qu'il contient.

---

## Résumé final

Affiche : US traitée ✓, critères satisfaits, points modérés notés dans le backlog, état du lint.
