<template>
  <div>
    <div class="flex items-baseline justify-between gap-3 mb-[7px]">
      <span class="text-meta text-muted">{{ label }}</span>
      <span class="num text-mono" :class="atLimit ? 'text-limit font-semibold' : ''">
        {{ formattedUsed }} / {{ formattedLimit }}
      </span>
    </div>
    <div class="h-[5px] rounded-[3px] bg-surface-track overflow-hidden">
      <div
        class="h-[5px] rounded-[3px] transition-[width]"
        :class="barColour"
        :style="{ width: barWidth }"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

/**
 * One "used / limit" row with a bar, as the `Plans` and `LimitReached`
 * artboards draw it.
 *
 * `limit === null` means unlimited, and it is drawn deliberately rather than
 * hidden: the canvas shows "3 / ∞" with a grey bar, because a row that vanishes
 * on a paid plan makes the plan look like it has fewer features, not more. The
 * bar is grey and not accent there, since a fraction of infinity is not a
 * measure of anything — accent would invite reading it as progress.
 */
const props = defineProps<{
  label: string
  used: number
  /** `null` is unlimited. */
  limit: number | null
}>()

const unlimited = computed(() => props.limit === null)

// A limit of 0 counts as reached, not as unmeasurable: it means nothing is
// allowed, and drawing that as "within the plan" would be the wrong way round.
const atLimit = computed(() => props.limit !== null && props.used >= props.limit)

/** Numbers are mono and thousands-separated, per the canvas ("412 / 2,000"). */
const formattedUsed = computed(() => props.used.toLocaleString('en-GB'))

const formattedLimit = computed(() =>
  unlimited.value ? '∞' : props.limit!.toLocaleString('en-GB')
)

const barWidth = computed(() => {
  // A token width for unlimited: enough to read as a bar, never as a fraction.
  if (unlimited.value) return '12%'
  if (props.limit! <= 0) return '100%'
  return `${Math.min((props.used / props.limit!) * 100, 100)}%`
})

const barColour = computed(() => {
  if (unlimited.value) return 'bg-field-underline'
  return atLimit.value ? 'bg-limit' : 'bg-accent'
})
</script>
