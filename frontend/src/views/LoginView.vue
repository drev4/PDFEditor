<template>
  <AuthLayout>
    <LoginForm />

    <template #footer>
      Don't have an account?
      <RouterLink
        to="/register"
        class="text-accent hover:text-accent font-medium ml-1"
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
