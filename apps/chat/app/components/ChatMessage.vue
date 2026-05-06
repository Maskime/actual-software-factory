<script setup lang="ts">
defineProps<{
  role: 'user' | 'assistant'
  content: string
}>()
</script>

<template>
  <!-- User: terminal input style, right-aligned -->
  <div v-if="role === 'user'" class="msg-user-wrap">
    <div class="msg-user">
      <span class="user-chevron" aria-hidden="true">›</span>
      <span class="user-text">{{ content }}</span>
    </div>
  </div>

  <!-- Assistant: structured output, left-aligned -->
  <div v-else class="msg-asst-wrap">
    <div class="msg-asst">
      <div class="asst-label">factory</div>
      <div class="asst-text">{{ content }}</div>
    </div>
  </div>
</template>

<style scoped>
/* ── User ────────────────────────────────────────────────── */

.msg-user-wrap {
  display: flex;
  justify-content: flex-end;
}

.msg-user {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  max-width: 70%;
  background: var(--elevated);
  border: 1px solid var(--border);
  border-radius: 6px 6px 2px 6px;
  padding: 0.625rem 0.875rem;
}

.user-chevron {
  font-family: var(--mono);
  font-size: 0.875rem;
  color: var(--hi);
  line-height: 1.55;
  flex-shrink: 0;
  user-select: none;
}

.user-text {
  font-size: 0.8125rem;
  color: var(--hi);
  white-space: pre-wrap;
  word-break: break-words;
  line-height: 1.65;
  font-family: var(--sans);
  font-weight: 400;
}

/* ── Assistant ───────────────────────────────────────────── */

.msg-asst-wrap {
  display: flex;
  justify-content: flex-start;
}

.msg-asst {
  max-width: 84%;
  border-left: 1px solid var(--border);
  padding-left: 0.875rem;
}

.asst-label {
  font-family: var(--mono);
  font-size: 0.5625rem;
  letter-spacing: 0.12em;
  color: var(--txt-3);
  text-transform: uppercase;
  margin-bottom: 0.375rem;
  user-select: none;
}

.asst-text {
  font-size: 0.8125rem;
  color: var(--txt);
  white-space: pre-wrap;
  word-break: break-words;
  line-height: 1.75;
  font-family: var(--sans);
  font-weight: 300;
}
</style>
