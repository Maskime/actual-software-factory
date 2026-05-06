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
      body: JSON.stringify({ message: text }),
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
  <div class="flex flex-col h-full bg-white">
    <header class="shrink-0 border-b border-gray-200 px-6 py-4">
      <h1 class="text-base font-semibold text-gray-900">Software Factory</h1>
      <p class="text-xs text-gray-500 mt-0.5">Qualification de besoin</p>
    </header>

    <div
      v-if="messages.length === 0"
      class="flex-1 flex items-center justify-center text-gray-400 text-sm select-none"
    >
      Décrivez votre besoin pour commencer…
    </div>

    <div
      v-else
      ref="threadRef"
      class="flex-1 overflow-y-auto"
    >
      <ChatThread :messages="messages" :is-streaming="isStreaming" />
    </div>

    <div
      v-if="error"
      class="shrink-0 mx-4 mb-2 rounded-lg bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700"
    >
      {{ error }}
    </div>

    <ChatInput :disabled="isStreaming" @send="sendMessage" />
  </div>
</template>
