<template>
  <div class="px-gutter py-16">
    <div class="max-w-[560px]">
      <h2 class="text-section">{{ title }}</h2>
      <p class="mt-2 text-body text-muted">
        <slot />
      </p>
      <p v-if="tracked" class="mt-4 text-meta text-faint">
        Tracked as <span class="num">{{ tracked }}</span>.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The placeholder for a screen the navigation promises and the product does not
 * have yet.
 *
 * It exists so those nav items can be in place — the canvas has four and two of
 * them have nothing behind them — without the app pretending. It says what is
 * missing and where the work is tracked; it never renders an empty table or
 * invented numbers, which is the failure mode this component is here to avoid.
 */
defineProps<{
  title: string
  tracked?: string
}>()
</script>
