<script setup lang="ts">
import { ref, nextTick } from 'vue'
import type { GitLabProject } from '../../../../server/api/projects.get'
import type { EpicData } from '../../../utils/sseParser'
import ChatThread from '../../../components/ChatThread.vue'
import ChatInput from '../../../components/ChatInput.vue'
import { parseSSELine } from '../../../utils/sseParser'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface SubmitResult {
  epic: { iid: number; web_url: string; title: string }
  issues: Array<{ iid: number; title: string; web_url: string }>
}

const route = useRoute()
const projectId = Number(route.params.id)

const { signOut } = useAuth()
const { data: projects } = await useFetch<GitLabProject[]>('/api/projects')
const project = computed(() => projects.value?.find(p => p.id === projectId) ?? null)

const messages = ref<Message[]>([])
const isStreaming = ref(false)
const error = ref<string | null>(null)
const threadRef = ref<HTMLElement | null>(null)
const isSubmitting = ref(false)
const submitResult = ref<SubmitResult | null>(null)
const submitError = ref<string | null>(null)
const epicData = ref<EpicData | null>(null)

async function submitNeed() {
  if (!epicData.value) return

  isSubmitting.value = true
  submitError.value = null

  try {
    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, epicData: epicData.value }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(data?.message ?? `Erreur serveur : ${res.status}`)
    }
    submitResult.value = await res.json()
  } catch (e) {
    submitError.value = e instanceof Error ? e.message : 'Erreur de soumission'
  } finally {
    isSubmitting.value = false
  }
}

async function processLines(lines: string[], assistantMsg: Message): Promise<boolean> {
  for (const line of lines) {
    const result = parseSSELine(line)
    if (result === null) return true
    if (result === undefined) continue
    if (typeof result === 'object' && '__epic_data' in result) {
      epicData.value = result.__epic_data
      continue
    }
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
  submitResult.value = null
  submitError.value = null
  epicData.value = null

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: messages.value.slice(0, -1), projectId }),
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
    <header class="hdr">
      <div class="hdr-inner">
        <div class="brand">
          <NuxtLink to="/projects" class="brand-back" aria-label="Retour aux projets">← Projets</NuxtLink>
          <span class="brand-mark" aria-hidden="true">◈</span>
          <span class="brand-name">{{ project?.name ?? 'Actual Software Factory' }}</span>
        </div>
        <div class="hdr-right">
          <div v-if="isStreaming" class="hdr-status">
            <span class="hdr-status-dot" />
            <span class="hdr-status-lbl">processing</span>
          </div>
          <NuxtLink :to="`/projects/${projectId}`" class="hdr-link">Dashboard</NuxtLink>
          <button class="hdr-signout" @click="signOut({ callbackUrl: '/login' })">Déconnexion</button>
        </div>
      </div>
    </header>

    <div v-if="messages.length === 0" class="empty">
      <div class="empty-inner">
        <p class="empty-line">Décrivez votre besoin pour démarrer la qualification.</p>
      </div>
    </div>

    <div v-else ref="threadRef" class="thread-scroll">
      <ChatThread
        :messages="messages"
        :is-streaming="isStreaming"
        :can-submit="!isStreaming && !isSubmitting && !submitResult"
        :is-submitting="isSubmitting"
        @submit="submitNeed"
      />
    </div>

    <div v-if="error || submitError" class="err-bar">
      <span class="err-tag">erreur</span>{{ error || submitError }}
    </div>

    <div v-if="submitResult" class="result-bar">
      <div class="result-header">
        <span class="result-tag">soumis</span>
        <a :href="submitResult.epic.web_url" target="_blank" class="result-epic-link">
          Epic #{{ submitResult.epic.iid }} — {{ submitResult.epic.title }}
        </a>
      </div>
      <ul class="result-issues">
        <li v-for="issue in submitResult.issues" :key="issue.iid">
          <a :href="issue.web_url" target="_blank">#{{ issue.iid }} {{ issue.title }}</a>
        </li>
      </ul>
    </div>

    <ChatInput :disabled="isStreaming || isSubmitting" @send="sendMessage" />
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

.hdr-link {
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

.hdr-link:hover {
  color: var(--hi);
  border-color: var(--hi);
  background: color-mix(in srgb, var(--hi) 8%, transparent);
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

.thread-scroll {
  flex: 1;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--txt-3) transparent;
}

.thread-scroll::-webkit-scrollbar        { width: 3px; }
.thread-scroll::-webkit-scrollbar-track  { background: transparent; }
.thread-scroll::-webkit-scrollbar-thumb  { background: var(--txt-3); border-radius: 2px; }

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

/* ── Result bar ─────────────────────────────────────────────── */

.result-bar {
  flex-shrink: 0;
  padding: 0.75rem 1.5rem;
  border-top: 1px solid var(--border);
  background: color-mix(in srgb, var(--hi) 6%, var(--surface));
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.result-header {
  display: flex;
  align-items: center;
  gap: 0.625rem;
}

.result-tag {
  font-family: var(--mono);
  font-size: 0.55rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  border: 1px solid color-mix(in srgb, var(--hi) 50%, transparent);
  color: var(--hi);
  padding: 0.1rem 0.35rem;
  border-radius: 2px;
  flex-shrink: 0;
}

.result-epic-link {
  font-family: var(--mono);
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--hi);
  text-decoration: none;
}

.result-epic-link:hover {
  text-decoration: underline;
}

.result-issues {
  margin: 0;
  padding-left: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.result-issues li {
  font-family: var(--mono);
  font-size: 0.6875rem;
  color: var(--txt-2);
}

.result-issues a {
  color: var(--txt-2);
  text-decoration: none;
}

.result-issues a:hover {
  color: var(--hi);
  text-decoration: underline;
}
</style>
