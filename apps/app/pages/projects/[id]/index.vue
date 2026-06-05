<script setup lang="ts">
import type { GitLabProject } from '../../../../server/api/projects.get'
import type { GitLabIssue } from '../../../../server/api/projects/[id]/issues.get'

const WORKFLOW_COLUMNS = [
  { key: 'open',      label: 'Ouvert',           match: null              },
  { key: 'dev',       label: 'Dev en cours',      match: 'workflow::dev'  },
  { key: 'review',    label: 'Review',            match: 'workflow::review'},
  { key: 'fix',       label: 'Correctifs',        match: 'workflow::fix'  },
  { key: 'sonarqube', label: 'Analyse SonarQube', match: 'workflow::sonarqube' },
  { key: 'merged',    label: 'Mergé',             match: 'workflow::merged'},
] as const

const route = useRoute()
const projectId = Number(route.params.id)

const { signOut } = useAuth()
const { data: projects } = await useFetch<GitLabProject[]>('/api/projects')
const project = computed(() => projects.value?.find(p => p.id === projectId) ?? null)

useHead(computed(() => ({ title: project.value?.name ?? 'Projet' })))

const { data: issues, status, error } = await useFetch<GitLabIssue[]>(
  `/api/projects/${projectId}/issues`,
  { key: `issues-${projectId}` },
)

function getWorkflowKey(issue: GitLabIssue): string {
  for (const col of WORKFLOW_COLUMNS) {
    if (col.match === null) continue
    if (issue.labels.includes(col.match)) return col.key
  }
  if (issue.state === 'closed') return 'merged'
  return 'open'
}

const columns = computed(() => {
  const map = new Map<string, GitLabIssue[]>(
    WORKFLOW_COLUMNS.map(c => [c.key, []]),
  )
  for (const issue of issues.value ?? []) {
    const key = getWorkflowKey(issue)
    map.get(key)!.push(issue)
  }
  return WORKFLOW_COLUMNS.map(c => ({ ...c, issues: map.get(c.key)! }))
})

function workflowLabels(labels: string[]): string[] {
  return labels.filter(l => l.startsWith('workflow::'))
}

function otherLabels(labels: string[]): string[] {
  return labels.filter(l => !l.startsWith('workflow::'))
}
</script>

<template>
  <div class="shell">
    <header class="hdr">
      <div class="hdr-inner">
        <div class="brand">
          <NuxtLink to="/projects" class="brand-back" aria-label="Retour aux projets">← Projets</NuxtLink>
          <span class="brand-mark" aria-hidden="true">◈</span>
          <span class="brand-name">{{ project?.name ?? 'Actual Software Factory' }}</span>
        </div>
        <div class="hdr-right">
          <button class="hdr-signout" @click="signOut({ callbackUrl: '/login' })">Déconnexion</button>
        </div>
      </div>
    </header>

    <div class="toolbar">
      <NuxtLink :to="`/projects/${projectId}/chat`" class="btn-new">+ Nouveau besoin</NuxtLink>
    </div>

    <main class="main">
      <div v-if="status === 'pending'" class="center">
        <span class="spinner" aria-label="Chargement…" />
      </div>

      <div v-else-if="error" class="err-bar">
        <span class="err-tag">erreur</span>Impossible de récupérer les issues.
      </div>

      <div v-else class="board">
        <div v-for="col in columns" :key="col.key" class="col">
          <div class="col-hdr">
            <span class="col-label">{{ col.label }}</span>
            <span class="col-count">{{ col.issues.length }}</span>
          </div>
          <div class="col-body">
            <div v-for="issue in col.issues" :key="issue.iid" class="card">
              <div class="card-top">
                <span class="card-num">#{{ issue.iid }}</span>
              </div>
              <p class="card-title">{{ issue.title }}</p>
              <div v-if="issue.labels.length" class="card-labels">
                <span
                  v-for="lbl in workflowLabels(issue.labels)"
                  :key="lbl"
                  class="badge badge--workflow"
                >{{ lbl.replace('workflow::', '') }}</span>
                <span
                  v-for="lbl in otherLabels(issue.labels)"
                  :key="lbl"
                  class="badge"
                >{{ lbl }}</span>
              </div>
            </div>
            <div v-if="col.issues.length === 0" class="col-empty">—</div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
  color: var(--txt);
  font-family: var(--sans);
}

.hdr {
  flex-shrink: 0;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
}

.hdr-inner {
  max-width: 100%;
  padding: 0 1.5rem;
  height: 3rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.625rem;
}

.brand-back {
  font-family: var(--mono);
  font-size: 0.6875rem;
  font-weight: 500;
  color: var(--txt-2);
  text-decoration: none;
  letter-spacing: 0.04em;
  padding: 0.2rem 0.5rem;
  border: 1px solid var(--border);
  border-radius: 0.25rem;
  background: transparent;
  transition: color 0.15s, border-color 0.15s, background 0.15s;
  line-height: 1;
}

.brand-back:hover {
  color: var(--hi);
  border-color: var(--hi);
  background: color-mix(in srgb, var(--hi) 8%, transparent);
}

.brand-mark {
  font-family: var(--mono);
  font-size: 0.75rem;
  color: var(--hi);
  line-height: 1;
}

.brand-name {
  font-family: var(--mono);
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.06em;
  color: var(--hi);
}

.hdr-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.toolbar {
  padding: 0.625rem 1.5rem;
  border-bottom: 1px solid var(--border);
  background: var(--surface);
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.btn-new {
  font-family: var(--mono);
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  padding: 0.3rem 0.75rem;
  background: var(--hi);
  color: var(--bg);
  border: 1px solid var(--hi);
  border-radius: 0.25rem;
  text-decoration: none;
  line-height: 1;
  transition: opacity 0.15s;
}

.btn-new:hover {
  opacity: 0.85;
}

.hdr-signout {
  background: none;
  border: 1px solid var(--border-2);
  border-radius: 3px;
  padding: 0.2rem 0.6rem;
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.08em;
  color: var(--txt-2);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}

.hdr-signout:hover {
  border-color: var(--hi);
  color: var(--hi);
}

.main {
  flex: 1;
  overflow: hidden;
  padding: 1.25rem 1.5rem;
}

.center {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.board {
  display: flex;
  gap: 0.75rem;
  height: 100%;
  overflow-x: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--txt-3) transparent;
}

.board::-webkit-scrollbar       { height: 3px; }
.board::-webkit-scrollbar-track { background: transparent; }
.board::-webkit-scrollbar-thumb { background: var(--txt-3); border-radius: 2px; }

.col {
  flex: 1 1 0;
  min-width: 9rem;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  overflow: hidden;
}

.col-hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.6rem 0.75rem;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.col-label {
  font-family: var(--mono);
  font-size: 0.625rem;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--txt-2);
}

.col-count {
  font-family: var(--mono);
  font-size: 0.625rem;
  color: var(--txt-3);
  background: var(--elevated);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0 0.4rem;
  line-height: 1.6;
}

.col-body {
  flex: 1;
  overflow-y: auto;
  padding: 0.5rem;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  scrollbar-width: thin;
  scrollbar-color: var(--txt-3) transparent;
}

.col-body::-webkit-scrollbar       { width: 2px; }
.col-body::-webkit-scrollbar-track { background: transparent; }
.col-body::-webkit-scrollbar-thumb { background: var(--txt-3); border-radius: 2px; }

.card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.5rem 0.625rem;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
}

.card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-num {
  font-family: var(--mono);
  font-size: 0.625rem;
  color: var(--txt-2);
  background: var(--elevated);
  border: 1px solid var(--border);
  border-radius: 3px;
  padding: 0.05rem 0.3rem;
  line-height: 1.6;
}

.card-title {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 400;
  color: var(--txt);
  line-height: 1.4;
  word-break: break-word;
}

.card-labels {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
}

.badge {
  font-family: var(--mono);
  font-size: 0.5rem;
  letter-spacing: 0.06em;
  padding: 0.1rem 0.35rem;
  border-radius: 2px;
  border: 1px solid var(--border-2);
  color: var(--txt-2);
  line-height: 1.6;
}

.badge--workflow {
  border-color: color-mix(in srgb, var(--hi) 40%, transparent);
  color: var(--hi);
}

.col-empty {
  font-family: var(--mono);
  font-size: 0.6rem;
  color: var(--txt-3);
  text-align: center;
  padding: 1rem 0;
}

.spinner {
  display: block;
  width: 1.25rem;
  height: 1.25rem;
  border: 2px solid var(--border-2);
  border-top-color: var(--hi);
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.err-bar {
  margin: 1rem 0;
  padding: 0.5rem 0.75rem;
  border: 1px solid rgba(192, 57, 43, 0.25);
  border-radius: 3px;
  font-family: var(--mono);
  font-size: 0.75rem;
  color: var(--err);
  display: flex;
  align-items: center;
  gap: 0.625rem;
  background: rgba(192, 57, 43, 0.06);
}

.err-tag {
  font-size: 0.55rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border: 1px solid rgba(192, 57, 43, 0.35);
  padding: 0.1rem 0.35rem;
  border-radius: 2px;
  flex-shrink: 0;
}
</style>
