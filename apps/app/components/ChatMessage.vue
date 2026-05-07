<script setup lang="ts">
import { computed } from 'vue'
import { Marked } from 'marked'

const props = defineProps<{
  role: 'user' | 'assistant'
  content: string
}>()

const md = new Marked({
  renderer: {
    html: () => '', // strip raw HTML blocks — only Markdown syntax is rendered
  },
})

const renderedContent = computed(() => md.parse(props.content) as string)
</script>

<template>
  <!-- User: terminal input style, right-aligned -->
  <div v-if="role === 'user'" class="msg-user-wrap">
    <div class="msg-user">
      <span class="user-chevron" aria-hidden="true">›</span>
      <span class="user-text">{{ content }}</span>
    </div>
  </div>

  <!-- Assistant: structured output, left-aligned, Markdown rendered -->
  <div v-else class="msg-asst-wrap">
    <div class="msg-asst">
      <div class="asst-label">factory</div>
      <div class="asst-text" v-html="renderedContent" />
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
  background: var(--hi);
  border-radius: 6px 6px 2px 6px;
  padding: 0.625rem 0.875rem;
}

.user-chevron {
  font-family: var(--mono);
  font-size: 0.875rem;
  color: var(--user-txt);
  line-height: 1.55;
  flex-shrink: 0;
  user-select: none;
}

.user-text {
  font-size: 0.8125rem;
  color: var(--user-txt);
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
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 2px solid var(--hi);
  border-radius: 0 4px 4px 4px;
  padding: 0.625rem 0.875rem;
}

.asst-label {
  font-family: var(--mono);
  font-size: 0.5rem;
  letter-spacing: 0.14em;
  color: var(--hi);
  text-transform: uppercase;
  margin-bottom: 0.375rem;
  user-select: none;
  opacity: 0.55;
}

.asst-text {
  font-size: 0.8125rem;
  color: var(--txt);
  word-break: break-words;
  line-height: 1.75;
  font-family: var(--sans);
  font-weight: 300;
}

/* ── Markdown prose styles (rendered via v-html) ─────────── */

.asst-text :deep(p)            { margin: 0 0 0.5rem; }
.asst-text :deep(p:last-child) { margin-bottom: 0; }
.asst-text :deep(hr)           { border: none; border-top: 1px solid var(--border); margin: 0.75rem 0; }
.asst-text :deep(strong)       { font-weight: 600; color: var(--txt); }
.asst-text :deep(em)           { font-style: italic; }
.asst-text :deep(h2)           { font-size: 0.875rem; font-weight: 600; color: var(--hi); margin: 0.75rem 0 0.375rem; }
.asst-text :deep(ul),
.asst-text :deep(ol)           { padding-left: 1.25rem; margin: 0.25rem 0; }
.asst-text :deep(li)           { margin: 0.1rem 0; }
.asst-text :deep(code)         { font-family: var(--mono); font-size: 0.75em; background: var(--border); padding: 0.1em 0.3em; border-radius: 2px; }
</style>
