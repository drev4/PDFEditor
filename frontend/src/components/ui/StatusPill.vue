<template>
  <span class="pill" :class="tone.pill">
    <span class="pill-dot" :class="tone.dot" />
    <span>{{ label ?? status }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

/**
 * The status pill from the System artboard. The dot carries the colour and the
 * background stays quiet, so a table full of pills does not read as a warning.
 */
const props = defineProps<{
  status: 'published' | 'draft' | 'closed' | 'invited' | 'active'
  label?: string
}>()

const tones = {
  published: { pill: 'bg-published-soft text-published', dot: 'bg-published' },
  active: { pill: 'bg-published-soft text-published', dot: 'bg-published' },
  draft: { pill: 'bg-neutral-soft text-muted', dot: 'bg-faint' },
  closed: { pill: 'bg-neutral-soft text-muted', dot: 'bg-danger' },
  invited: { pill: 'bg-limit-soft text-limit', dot: 'bg-limit' },
} as const

const tone = computed(() => tones[props.status] ?? tones.draft)
</script>
