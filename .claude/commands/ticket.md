---
description: Qualifie et documente un ticket d'anomalie ou de modification de comportement
argument-hint: [description courte optionnelle]
---

Crée un ticket structuré pour qualifier une anomalie ou une modification de comportement.

> Ce skill est réservé aux **anomalies (bugs)** et aux **modifications de comportement** d'une fonctionnalité existante. Pour une nouvelle fonctionnalité, utilise `/gen-us` à la place.

---

## Étape 1 — Type, titre et description

Utilise l'outil `AskUserQuestion` pour poser ces trois questions en une seule fois :

```
1. Type de ticket :
   (A) Anomalie / Bug — quelque chose qui ne fonctionne pas comme prévu
   (B) Modification de comportement — une fonctionnalité existante doit se comporter différemment

2. Titre court (< 60 caractères, en français)
   Ex : "La date de naissance s'affiche au format US"

3. Description libre — décris le problème tel que tu l'as constaté, avec autant de détail que tu veux.
```

Mémorise : `TYPE` (A ou B), `TITRE`, `DESCRIPTION`.

---

## Étape 2 — Qualification approfondie

Utilise à nouveau `AskUserQuestion`. Le contenu des questions dépend du type.

**Si TYPE = A (Anomalie / Bug) :**

```
4. Comportement observé — que se passe-t-il concrètement ?

5. Comportement attendu — que devrait-il se passer ?

6. Étapes de reproduction — liste les étapes précises pour reproduire le bug.
   Ex : "1. Ouvrir l'écran Famille  2. Cliquer sur un enfant  3. ..."
   Si le bug est intermittent, précise-le.

7. Sévérité :
   (C) Critique — bloque l'utilisation ou provoque une perte de données
   (H) Haute    — fonctionnalité principale inutilisable, pas de contournement simple
   (M) Moyenne  — gêne notable mais contournement possible
   (B) Basse    — cosmétique ou impact mineur

8. Module concerné :
   (1) Enfants            (2) Matières         (3) Règles de calcul
   (4) Saisie des notes   (5) Calcul & validation du versement
   (6) Historique         (7) Paramètres       (8) Import PRONOTE   (9) Autre / transversal

9. Impact utilisateur — qui est affecté et dans quelle mesure ?
   Ex : "Impossible de valider le mois de mars pour tous les enfants"
```

**Si TYPE = B (Modification de comportement) :**

```
4. Comportement actuel — décris comment la fonctionnalité se comporte aujourd'hui.

5. Comportement souhaité — décris précisément comment elle devrait se comporter après la modification.

6. Justification — pourquoi ce changement est-il nécessaire ?
   Ex : règle métier, retour utilisateur, incohérence avec une autre fonctionnalité.

7. Sévérité :
   (C) Critique — le comportement actuel est inacceptable en production
   (H) Haute    — impact fort sur l'usage quotidien
   (M) Moyenne  — amélioration notable mais non bloquante
   (B) Basse    — amélioration mineure ou esthétique

8. Module concerné :
   (1) Enfants            (2) Matières         (3) Règles de calcul
   (4) Saisie des notes   (5) Calcul & validation du versement
   (6) Historique         (7) Paramètres       (8) Import PRONOTE   (9) Autre / transversal

9. Impact utilisateur — qui est affecté et dans quelle mesure ?
```

Mémorise toutes les réponses.

---

## Étape 3 — Notes techniques (optionnel)

Utilise `AskUserQuestion` pour demander :

```
10. Notes techniques (optionnel) — hypothèses sur la cause, fichiers ou composants suspects,
    contraintes d'implémentation. Laisse vide si tu n'as rien à ajouter.
```

---

## Étape 4 — Calcul du numéro de ticket

1. Vérifie si le répertoire `docs/tickets/` existe. S'il n'existe pas, crée-le (`mkdir -p docs/tickets`).
2. Liste les fichiers correspondant au pattern `TICKET-NNN-*.md` dans ce répertoire.
3. Extrais tous les nombres `NNN` (ex : `001`, `042`) depuis les noms de fichiers via la regex `TICKET-(\d{3})-`.
4. Prends le maximum. Si aucun fichier ne correspond, le maximum est `0`.
5. Le numéro du nouveau ticket est `max + 1`, formaté sur 3 chiffres avec zéros de remplissage (ex : `001`, `012`, `042`).

Mémorise `NUMERO`.

---

## Étape 5 — Génération du slug

Dérive un slug depuis `TITRE` :

1. Convertis en minuscules.
2. Remplace les caractères accentués par leur équivalent ASCII :
   `à â ä` → `a` · `é è ê ë` → `e` · `î ï` → `i` · `ô ö` → `o` · `ù û ü` → `u` · `ç` → `c` · `œ` → `oe` · `æ` → `ae`
3. Remplace tout caractère qui n'est pas `[a-z0-9]` par un tiret `-`.
4. Réduis les tirets consécutifs à un seul tiret.
5. Supprime les tirets en début et en fin.
6. Tronque à 45 caractères maximum (sur une coupure de mot propre si possible).

Mémorise `SLUG`.

---

## Étape 6 — Écriture du ticket

Construis le nom de fichier : `docs/tickets/TICKET-[NUMERO]-[SLUG].md`

Écris le fichier avec le contenu ci-dessous. **Omets intégralement les sections marquées `*(anomalie)*` si TYPE = B, et celles marquées `*(modification)*` si TYPE = A.** Ne laisse aucune section vide ni aucun marqueur résiduel dans le fichier final.

La date à insérer est la date du jour au format `YYYY-MM-DD` (disponible dans le contexte système `currentDate`).

```
# TICKET-[NUMERO] — [TITRE]

**Type :** [Anomalie | Modification de comportement]
**Sévérité :** [Critique | Haute | Moyenne | Basse]
**Module :** [nom du module]
**Date :** [YYYY-MM-DD]
**Statut :** Ouvert

---

## Description

[DESCRIPTION]

---

## Comportement observé *(anomalie)*

[COMPORTEMENT_OBSERVE]

## Comportement attendu *(anomalie)*

[COMPORTEMENT_ATTENDU]

---

## Étapes de reproduction *(anomalie)*

1. [Étape 1]
2. [Étape 2]
3. ...

---

## Comportement actuel *(modification)*

[COMPORTEMENT_ACTUEL]

## Comportement souhaité *(modification)*

[COMPORTEMENT_SOUHAITE]

## Justification *(modification)*

[JUSTIFICATION]

---

## Impact utilisateur

[IMPACT]

---

## Notes techniques *(si renseignées)*

[NOTES_TECHNIQUES]

---

## Liens

- Épopée(s) concernée(s) : *(à compléter)*
- US associée(s) : *(à compléter)*
```

---

## Étape 7 — Résumé

Affiche :

```
Ticket créé : docs/tickets/TICKET-[NUMERO]-[SLUG].md
Type        : [Anomalie | Modification de comportement]
Sévérité    : [valeur]
Module      : [valeur]
```
