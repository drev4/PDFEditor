<template>
  <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 p-4">
    <div class="w-full max-w-md">
      <!-- Logo y Brand -->
      <div class="text-center mb-8">
        <div class="inline-flex items-center justify-center bg-gradient-to-br from-blue-600 to-indigo-600 p-4 rounded-2xl shadow-2xl mb-4">
          <i class="pi pi-file-pdf text-white text-5xl"></i>
        </div>
        <h1 class="text-3xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent mb-2">
          PDF Editor Pro
        </h1>
        <p class="text-gray-600 text-sm">Professional PDF Editing Suite</p>
      </div>

      <!-- Contenido (slot para el formulario) -->
      <div class="bg-white rounded-2xl shadow-xl border border-gray-200 p-8">
        <slot />
      </div>

      <!-- Footer -->
      <p class="text-center text-sm text-gray-600 mt-6">
        <slot name="footer" />
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
// Layout sin lógica, solo estructura visual
</script>
