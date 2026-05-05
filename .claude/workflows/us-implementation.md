### Étape 1 — Planification

Entre en mode plan (outil `EnterPlanMode`).

Analyse la user story :
- ses critères d'acceptation
- ses notes techniques
- le code existant (fichiers à créer ou modifier, handlers IPC à ajouter, composants Vue, migrations DB...)

Produis un plan détaillé : liste ordonnée d'actions concrètes avec les fichiers concernés.
Tu n'as pas besoin de la validation du plan pour passer à l'étape 2.

### Étape 2 — Critique du plan (agent indépendant)

Sors du mode plan (`ExitPlanMode`), puis délègue la review à un sous-agent via l'outil `Agent` :

- `subagent_type` : `"Plan"`
- `prompt` : brief autonome contenant intégralement :
  - le texte de la user story (critères d'acceptation + notes techniques)
  - le plan détaillé produit à l'étape 1
  - le contexte projet minimal : stack Electron 41 + Vue 3 + SQLite, conventions IPC (`<namespace>:<action>`, handlers dans `src/main/ipc/index.js`, exposition dans `src/preload/index.js`), migrations dans `src/main/database/migrations.js`, composants Vue en `<script setup>` + Composition API
  - la consigne : identifier les défauts en trois catégories :
    - **Grave** : bloque l'implémentation correcte — critère d'acceptation oublié, mauvaise architecture, risque de régression
    - **Modéré** : dette technique acceptable pour l'instant — validation manquante, cas limite non géré
    - **Esthétique** : acceptable en l'état — nommage sous-optimal, organisation perfectible

Attends le retour complet du sous-agent avant de passer à l'étape 3.

### Étape 3 — Révision

- Intègre les corrections des points **Grave** dans le plan.
- Pour chaque point **Modéré**, ajoute une ligne dans `.claude/backlog.md` (format : `- [US-N] <description du point>`).
- Présente le plan révisé final, puis sors du mode plan (outil `ExitPlanMode`).

### Étape 4 — Implémentation

Exécute le plan révisé. Respecte les conventions du projet (CLAUDE.md) :
- IPC : handlers dans `src/main/ipc/index.js`, exposition dans `src/preload/index.js` (namespace correspondant)
- Nouvelles tables : nouvelle entrée dans le tableau `MIGRATIONS` de `src/main/database/migrations.js`
- Composants Vue : `<script setup>` + Composition API, pas d'accès direct à Node/Electron

### Étape 5 — Vérification

1. Lance `npm run lint` et corrige toute erreur avant de continuer.
2. Vérifie chaque critère d'acceptation de la user story : indique explicitement **satisfait** ou **non satisfait** pour chacun.
3. Si un critère n'est pas satisfait, retourne à l'étape 4 pour le corriger.
