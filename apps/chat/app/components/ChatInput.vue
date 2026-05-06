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
  <div class="input-zone">
    <div class="input-inner">
      <div class="prompt-shell" :class="{ 'prompt-shell--disabled': disabled }">
        <span class="prompt-sign" aria-hidden="true">$</span>
        <textarea
          v-model="text"
          :disabled="disabled"
          rows="1"
          placeholder="décrivez votre besoin…"
          class="prompt-field"
          style="max-height: 9rem"
          @keydown="handleKeydown"
          @input="($event.target as HTMLTextAreaElement).style.height = 'auto';
                  ($event.target as HTMLTextAreaElement).style.height =
                    Math.min(($event.target as HTMLTextAreaElement).scrollHeight, 144) + 'px'"
        />
        <button
          :disabled="!canSend"
          class="send-btn"
          :class="{ 'send-btn--on': canSend }"
          aria-label="Envoyer"
          @click="submit"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M1 6h10M6 1l5 5-5 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
      <div class="prompt-hints">
        <span><kbd>↵</kbd> envoyer</span>
        <span><kbd>⇧↵</kbd> nouvelle ligne</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.input-zone {
  flex-shrink: 0;
  border-top: 1px solid var(--border);
  background: var(--surface);
  padding: 0.875rem 1.5rem 1rem;
}

.input-inner {
  max-width: 56rem;
  margin: 0 auto;
}

/* ── Prompt shell ────────────────────────────────────────── */

.prompt-shell {
  display: flex;
  align-items: flex-end;
  gap: 0.625rem;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 0.5625rem 0.625rem;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.prompt-shell:focus-within {
  border-color: var(--hi);
  box-shadow: 0 0 0 1px rgba(240, 235, 226, 0.08);
}

.prompt-shell--disabled {
  opacity: 0.4;
  pointer-events: none;
}

.prompt-sign {
  font-family: var(--mono);
  font-size: 0.875rem;
  color: var(--hi);
  flex-shrink: 0;
  padding-bottom: 0.1rem;
  user-select: none;
  line-height: 1.5;
}

.prompt-field {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  resize: none;
  font-family: var(--mono);
  font-size: 0.8125rem;
  color: var(--txt);
  line-height: 1.6;
  overflow: hidden;
  padding: 0;
}

.prompt-field::placeholder {
  color: var(--txt-3);
}

/* ── Send button ─────────────────────────────────────────── */

.send-btn {
  flex-shrink: 0;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 3px;
  border: 1px solid var(--border-2);
  background: transparent;
  color: var(--txt-3);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: not-allowed;
  transition: border-color 0.12s, background 0.12s, color 0.12s;
}

.send-btn--on {
  border-color: var(--hi);
  color: var(--hi);
  cursor: pointer;
}

.send-btn--on:hover {
  background: var(--hi);
  color: var(--bg);
}

/* ── Hints ───────────────────────────────────────────────── */

.prompt-hints {
  display: flex;
  gap: 1rem;
  margin-top: 0.375rem;
  padding: 0 0.125rem;
  font-family: var(--mono);
  font-size: 0.55rem;
  color: var(--txt-3);
  letter-spacing: 0.03em;
}

.prompt-hints kbd {
  font-family: inherit;
  background: var(--elevated);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.05rem 0.3rem;
  color: var(--txt-2);
}
</style>
