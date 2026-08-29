<template>
  <AuthLayout>
    <RegisterForm />

    <template #footer>
      Already have an account?
      <RouterLink
        to="/login"
        class="text-accent hover:text-accent font-medium ml-1"
      >
        Sign in
      </RouterLink>
    </template>
  </AuthLayout>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router'
import AuthLayout from '@/layouts/AuthLayout.vue'
import RegisterForm from '@/components/auth/RegisterForm.vue'
</script>
