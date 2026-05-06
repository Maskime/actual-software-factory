<script setup lang="ts">
import { ref, computed } from 'vue'

const props = defineProps<{
  disabled: boolean
}>()

const emit = defineEmits<{
  send: [text: string]
}>()

const text = ref('')

const canSend = computed(() => text.value.trim().length > 0 && !props.disabled)

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
}

function submit() {
  if (!canSend.value) return
  emit('send', text.value.trim())
  text.value = ''
}
</script>

<template>
  <div class="border-t border-gray-200 bg-white px-4 py-3">
    <div class="max-w-3xl mx-auto flex gap-3 items-end">
      <textarea
        v-model="text"
        :disabled="disabled"
        rows="1"
        placeholder="Décrivez votre besoin…"
        class="flex-1 resize-none rounded-xl border border-gray-300 px-4 py-2.5 text-sm
               focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
               disabled:bg-gray-50 disabled:text-gray-400
               overflow-hidden"
        style="max-height: 9rem"
        @keydown="handleKeydown"
        @input="($event.target as HTMLTextAreaElement).style.height = 'auto';
                ($event.target as HTMLTextAreaElement).style.height =
                  Math.min(($event.target as HTMLTextAreaElement).scrollHeight, 144) + 'px'"
      />
      <button
        :disabled="!canSend"
        class="shrink-0 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white
               hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400
               transition-colors"
        @click="submit"
      >
        Envoyer
      </button>
    </div>
  </div>
</template>
