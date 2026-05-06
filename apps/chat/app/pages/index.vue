<script setup lang="ts">
import { ref, nextTick } from 'vue'
import ChatThread from '../components/ChatThread.vue'
import ChatInput from '../components/ChatInput.vue'
import { parseSSELine } from '../utils/sseParser'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const messages = ref<Message[]>([])
const isStreaming = ref(false)
const error = ref<string | null>(null)
const threadRef = ref<HTMLElement | null>(null)

async function processLines(lines: string[], assistantMsg: Message): Promise<boolean> {
  for (const line of lines) {
    const result = parseSSELine(line)
    if (result === null) return true
    if (result === undefined) continue
    assistantMsg.content += result
    await nextTick()
    if (threadRef.value) {
      threadRef.value.scrollTop = threadRef.value.scrollHeight
    }
  }
  return false
}

async function readSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  assistantMsg: Message,
): Promise<void> {
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    if (await processLines(lines, assistantMsg)) break
  }
}

async function sendMessage(text: string) {
  messages.value.push({ role: 'user', content: text })
  const assistantMsg: Message = { role: 'assistant', content: '' }
  messages.value.push(assistantMsg)
  isStreaming.value = true
  error.value = null

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages.value.slice(0, -1) }),
    })
    if (!response.ok) throw new Error(`Erreur serveur : ${response.status}`)
    await readSSEStream(response.body!.getReader(), assistantMsg)
  } catch (e) {
    error.value = e instanceof Error ? e.message : 'Erreur de connexion'
    if (assistantMsg.content === '') {
      messages.value.splice(messages.value.indexOf(assistantMsg), 1)
    }
  } finally {
    isStreaming.value = false
  }
}
</script>

<template>
  <div class="shell">
    <!-- Header -->
    <header class="hdr">
      <div class="hdr-inner">
        <div class="brand">
          <span class="brand-mark" aria-hidden="true">◈</span>
          <span class="brand-name">Actual Software Factory</span>
        </div>
        <div v-if="isStreaming" class="hdr-status">
          <span class="hdr-status-dot" />
          <span class="hdr-status-lbl">processing</span>
        </div>
      </div>
    </header>

    <!-- Empty state -->
    <div v-if="messages.length === 0" class="empty">
      <div class="empty-inner">
        <p class="empty-line">Décrivez votre besoin pour démarrer la qualification.</p>
      </div>
    </div>

    <!-- Thread -->
    <div v-else ref="threadRef" class="thread-scroll">
      <ChatThread :messages="messages" :is-streaming="isStreaming" />
    </div>

    <!-- Error -->
    <div v-if="error" class="err-bar">
      <span class="err-tag">erreur</span>{{ error }}
    </div>

    <ChatInput :disabled="isStreaming" @send="sendMessage" />
  </div>
</template>

<!-- Global tokens + font import -->
<style>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Manrope:wght@300;400;500&display=swap');

:root {
  --bg:        #f4f4f5;
  --surface:   #ffffff;
  --elevated:  #f4f4f5;
  --border:    #e4e4e7;
  --border-2:  #d4d4d8;
  --hi:        #334155;  /* slate — accent, interactive */
  --hdr-txt:   #f8fafc;  /* text on slate header */
  --user-txt:  #f1f5f9;  /* text on slate user bubble */
  --txt:       #3f3f46;  /* body text */
  --txt-2:     #71717a;  /* secondary */
  --txt-3:     #a1a1aa;  /* muted */
  --err:       #dc2626;
  --mono:      'IBM Plex Mono', monospace;
  --sans:      'Manrope', system-ui, sans-serif;
}

*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); }
</style>

<style scoped>
.shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg);
  color: var(--txt);
  font-family: var(--sans);
}

/* ── Header ──────────────────────────────────────────────── */

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

.hdr-status {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.hdr-status-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--hi);
  animation: pulse 1.4s ease-in-out infinite;
}

.hdr-status-lbl {
  font-family: var(--mono);
  font-size: 0.5625rem;
  letter-spacing: 0.1em;
  color: var(--txt-2);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.25; }
}

/* ── Thread ──────────────────────────────────────────────── */

.thread-scroll {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--txt-3) transparent;
}

.thread-scroll::-webkit-scrollbar        { width: 3px; }
.thread-scroll::-webkit-scrollbar-track  { background: transparent; }
.thread-scroll::-webkit-scrollbar-thumb  { background: var(--txt-3); border-radius: 2px; }

/* ── Empty state ─────────────────────────────────────────── */

.empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
}

.empty-inner {
  text-align: center;
}

.empty-line {
  font-size: 0.875rem;
  font-weight: 300;
  color: var(--txt-3);
  margin: 0;
  line-height: 1.6;
}

/* ── Error ───────────────────────────────────────────────── */

.err-bar {
  flex-shrink: 0;
  margin: 0.375rem 1.5rem;
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
