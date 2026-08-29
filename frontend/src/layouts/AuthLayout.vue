<template>
  <div class="min-h-screen flex items-center justify-center bg-surface-sunken p-4">
    <div class="w-full max-w-[400px]">
      <div class="flex justify-center mb-7">
        <BrandMark />
      </div>

      <div class="bg-surface rounded-card border border-line shadow-paper p-7">
        <slot />
      </div>

      <p class="text-center text-meta text-muted mt-5">
        <slot name="footer" />
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import BrandMark from '@/components/ui/BrandMark.vue'
</script>
