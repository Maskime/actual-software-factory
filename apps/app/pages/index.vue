<script setup lang="ts">
import type { GitLabProject } from '../../server/api/projects.get'

definePageMeta({ middleware: 'home-redirect' })
useHead({ titleTemplate: '%s', title: 'Software Factory' })

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

    <div class="body">
      <div v-if="status === 'pending'" class="state">
        <span class="spinner" aria-label="Chargement…" />
      </div>

      <div v-else-if="error" class="state err-state">
        <span class="err-tag">erreur</span>
        <span>Impossible de récupérer vos projets.</span>
      </div>

      <div v-else-if="!projects || projects.length === 0" class="state">
        <p class="msg">Aucun projet accessible.</p>
        <p class="sub">Demandez à un administrateur GitLab de vous ajouter à un projet.</p>
      </div>
    </div>
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

.body {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}

.state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  text-align: center;
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

.msg {
  margin: 0;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--txt);
}

.sub {
  margin: 0;
  font-size: 0.75rem;
  font-weight: 300;
  color: var(--txt-3);
}

.err-state {
  flex-direction: row;
  gap: 0.625rem;
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
