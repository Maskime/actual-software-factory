---
description: Implémente un ticket (anomalie ou modification de comportement) avec plan/critique/correction
argument-hint: [numéro-ticket]
---

Implémente le ticket dont le numéro est `$ARGUMENTS`.

## Initialisation

### Si aucun argument n'est fourni

1. Liste les tickets en attente : tous les fichiers `TICKET-NNN-*.md` situés **directement** dans `docs/tickets/` (pas dans les sous-dossiers).
2. Liste les tickets en cours : tous les fichiers `TICKET-NNN-*.md` situés dans `docs/tickets/in_progress/`.
3. Affiche les deux listes (en distinguant « en attente » et « en cours ») et demande à l'utilisateur quel numéro il souhaite traiter, puis reprends avec ce numéro.

### Si un numéro est fourni

1. Normalise le numéro en entier (ex : `1` → `001`, `42` → `042`).
2. Cherche le fichier dans cet ordre de priorité :
   a. `docs/tickets/in_progress/TICKET-NNN-*.md` — ticket interrompu, reprendre en cours
   b. `docs/tickets/TICKET-NNN-*.md` — ticket en attente, démarrer
3. Si le fichier est introuvable dans les deux emplacements, affiche une erreur et arrête.
4. **Si le ticket est en attente** (cas b) :
   - Crée le dossier `docs/tickets/in_progress/` s'il n'existe pas.
   - Déplace le fichier dans `docs/tickets/in_progress/`.
5. **Si le ticket est déjà en cours** (cas a) :
   - Ne pas déplacer le fichier ; indiquer à l'utilisateur que le ticket est repris après interruption.
6. Lis le ticket et affiche son titre, son type, sa sévérité et sa description avant de commencer.

---

## Traitement du ticket

Applique exactement les étapes ci-dessous.

Lis le fichier `.claude/workflows/us-implementation.md` et applique exactement les étapes qu'il contient.

> **Note :** dans le contexte d'un ticket, « user story » désigne le ticket lui-même. Les critères d'acceptation correspondent aux comportements attendus (anomalie) ou au comportement souhaité (modification) décrits dans le ticket.

---

## Résumé final

Affiche : ticket traité ✓, critères satisfaits, points modérés notés dans le backlog, état du lint.

Mets à jour le champ `**Statut :**` du fichier ticket (dans `docs/tickets/in_progress/`) en le passant à `Implémenté`.

Crée le dossier `docs/tickets/done/` s'il n'existe pas, puis déplace le fichier ticket de `docs/tickets/in_progress/` vers `docs/tickets/done/`.
