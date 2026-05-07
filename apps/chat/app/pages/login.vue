<script setup lang="ts">
const { signIn, status } = useAuth()

if (status.value === 'authenticated') {
  await navigateTo('/')
}
</script>

<template>
  <div class="login-shell">
    <div class="login-card">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">◈</span>
        <span class="brand-name">Actual Software Factory</span>
      </div>

      <p class="tagline">Connectez-vous pour accéder au portail.</p>

      <button class="gitlab-btn" @click="signIn('gitlab', { callbackUrl: '/' })">
        <svg class="gitlab-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M22.65 14.39L12 22.13 1.35 14.39a.84.84 0 0 1-.3-.94l1.22-3.78 2.44-7.51A.42.42 0 0 1 4.82 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.49h8.1l2.44-7.51A.42.42 0 0 1 18.6 2a.43.43 0 0 1 .58 0 .42.42 0 0 1 .11.18l2.44 7.51L23 13.45a.84.84 0 0 1-.35.94z"/>
        </svg>
        Se connecter avec GitLab
      </button>
    </div>
  </div>
</template>

<style scoped>
.login-shell {
  height: 100%;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg);
}

.login-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.75rem;
  padding: 2.5rem 3rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  width: 100%;
  max-width: 22rem;
}

.brand {
  display: flex;
  align-items: center;
  gap: 0.625rem;
}

.brand-mark {
  font-family: var(--mono);
  font-size: 0.875rem;
  color: var(--hi);
  line-height: 1;
}

.brand-name {
  font-family: var(--mono);
  font-size: 0.75rem;
  font-weight: 500;
  letter-spacing: 0.06em;
  color: var(--hi);
}

.tagline {
  margin: 0;
  font-family: var(--sans);
  font-size: 0.8125rem;
  font-weight: 300;
  color: var(--txt-3);
  text-align: center;
  line-height: 1.5;
}

.gitlab-btn {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.625rem 1.25rem;
  background: var(--hi);
  color: var(--hdr-txt);
  border: none;
  border-radius: 4px;
  font-family: var(--mono);
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.04em;
  cursor: pointer;
  transition: opacity 0.15s;
  width: 100%;
  justify-content: center;
}

.gitlab-btn:hover {
  opacity: 0.88;
}

.gitlab-icon {
  width: 1rem;
  height: 1rem;
  flex-shrink: 0;
}
</style>
