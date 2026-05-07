<script setup lang="ts">
import type { GitLabProject } from '../../../server/api/projects.get'

const { signOut } = useAuth()
const { data: projects, status, error } = await useFetch<GitLabProject[]>('/api/projects')
</script>

<template>
  <div class="shell">
    <header class="hdr">
      <div class="hdr-inner">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">◈</span>
          <span class="brand-name">Actual Software Factory</span>
        </div>
        <button class="hdr-signout" @click="signOut({ callbackUrl: '/login' })">Déconnexion</button>
      </div>
    </header>

    <main class="main">
      <div v-if="status === 'pending'" class="center">
        <span class="spinner" aria-label="Chargement…" />
      </div>

      <div v-else-if="error" class="center err-state">
        <span class="err-tag">erreur</span>
        <span>Impossible de récupérer vos projets.</span>
      </div>

      <template v-else>
        <h1 class="page-title">Vos projets</h1>
        <ul class="project-list">
          <li v-for="project in projects" :key="project.id">
            <NuxtLink :to="`/projects/${project.id}`" class="project-card">
              <span class="project-name">{{ project.name }}</span>
              <span v-if="project.description" class="project-desc">{{ project.description }}</span>
            </NuxtLink>
          </li>
        </ul>
      </template>
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
  max-width: 56rem;
  margin: 0 auto;
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
  overflow-y: auto;
  padding: 2rem 1.5rem;
  max-width: 56rem;
  width: 100%;
  margin: 0 auto;
}

.center {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.625rem;
  padding: 4rem 0;
}

.page-title {
  font-family: var(--mono);
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.06em;
  color: var(--txt-2);
  text-transform: uppercase;
  margin: 0 0 1.25rem;
}

.project-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.project-card {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 1rem 1.25rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  text-decoration: none;
  transition: border-color 0.15s;
}

.project-card:hover {
  border-color: var(--hi);
}

.project-name {
  font-family: var(--mono);
  font-size: 0.8125rem;
  font-weight: 500;
  color: var(--hi);
}

.project-desc {
  font-size: 0.8125rem;
  font-weight: 300;
  color: var(--txt-2);
  line-height: 1.4;
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

.err-state {
  font-family: var(--mono);
  font-size: 0.75rem;
  color: var(--err);
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
