<script setup lang="ts">
import ChatMessage from './ChatMessage.vue'

defineProps<{
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  isStreaming: boolean
}>()
</script>

<template>
  <div class="thread">
    <ChatMessage
      v-for="(msg, i) in messages"
      :key="i"
      :role="msg.role"
      :content="msg.content"
    />

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
  border-left: 1px solid var(--border);
  padding-left: 0.875rem;
}

.streaming-label {
  font-family: var(--mono);
  font-size: 0.5625rem;
  letter-spacing: 0.12em;
  color: var(--txt-3);
  text-transform: uppercase;
  margin-bottom: 0.375rem;
  user-select: none;
}

.streaming-cursor {
  display: inline-block;
  width: 8px;
  height: 1em;
  background: var(--txt-3);
  vertical-align: middle;
  animation: blink 1s step-end infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0; }
}
</style>
