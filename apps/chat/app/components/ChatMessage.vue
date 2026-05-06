<script setup lang="ts">
defineProps<{
  role: 'user' | 'assistant'
  content: string
}>()
</script>

<template>
  <div :class="['flex', role === 'user' ? 'justify-end' : 'justify-start']">
    <div
      :class="[
        'max-w-[80%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap break-words leading-relaxed',
        role === 'user'
          ? 'bg-blue-600 text-white rounded-br-sm'
          : 'bg-gray-100 text-gray-800 rounded-bl-sm',
      ]"
    >
      {{ content }}
    </div>
  </div>
</template>
