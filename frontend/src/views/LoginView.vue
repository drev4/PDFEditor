<template>
  <AuthLayout>
    <LoginForm />

    <template #footer>
      Don't have an account?
      <RouterLink
        to="/register"
        class="text-blue-600 hover:text-blue-700 font-medium ml-1"
      >
        Sign up
      </RouterLink>
    </template>
  </AuthLayout>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router'
import AuthLayout from '@/layouts/AuthLayout.vue'
import LoginForm from '@/components/auth/LoginForm.vue'
</script>
