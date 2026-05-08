<script setup lang="ts">
import ChatMessage from './ChatMessage.vue'

withDefaults(defineProps<{
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  isStreaming: boolean
  canSubmit?: boolean
  isSubmitting?: boolean
}>(), { canSubmit: false, isSubmitting: false })

const emit = defineEmits<{ submit: [] }>()
</script>

<template>
  <div class="thread">
    <template v-for="(msg, i) in messages" :key="i">
      <ChatMessage
        v-if="msg.content !== '' || !isStreaming || i !== messages.length - 1"
        :role="msg.role"
        :content="msg.content"
        :show-submit="canSubmit"
        :is-submitting="isSubmitting"
        @submit="emit('submit')"
      />
    </template>

    <!-- Streaming: last assistant message still empty -->
    <div
      v-if="isStreaming && messages[messages.length - 1]?.content === ''"
      class="streaming"
    >
      <div class="streaming-label">factory</div>
      <span class="streaming-cursor" aria-label="En cours de génération" />
    </div>
  </div>
</template>

<style scoped>
.thread {
  max-width: 56rem;
  margin: 0 auto;
  padding: 1.75rem 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.125rem;
}

/* ── Streaming indicator ─────────────────────────────────── */

.streaming {
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 2px solid var(--hi);
  border-radius: 0 4px 4px 4px;
  padding: 0.625rem 0.875rem;
  max-width: 84%;
}

.streaming-label {
  font-family: var(--mono);
  font-size: 0.5rem;
  letter-spacing: 0.14em;
  color: var(--hi);
  text-transform: uppercase;
  margin-bottom: 0.375rem;
  user-select: none;
  opacity: 0.55;
}

.streaming-cursor {
  display: inline-block;
  width: 7px;
  height: 0.9em;
  background: var(--hi);
  vertical-align: middle;
  opacity: 0.45;
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0; }
}
</style>
