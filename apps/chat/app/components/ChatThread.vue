<script setup lang="ts">
import ChatMessage from './ChatMessage.vue'

defineProps<{
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  isStreaming: boolean
}>()
</script>

<template>
  <div class="px-4 py-6 space-y-4 max-w-3xl mx-auto">
    <ChatMessage
      v-for="(msg, i) in messages"
      :key="i"
      :role="msg.role"
      :content="msg.content"
    />
    <div
      v-if="isStreaming && messages[messages.length - 1]?.content === ''"
      class="flex justify-start"
    >
      <div class="bg-gray-100 rounded-2xl rounded-bl-sm px-4 py-3">
        <span class="flex gap-1 items-center h-4">
          <span class="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:0ms]" />
          <span class="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:150ms]" />
          <span class="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:300ms]" />
        </span>
      </div>
    </div>
  </div>
</template>
