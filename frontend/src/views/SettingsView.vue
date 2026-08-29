<template>
  <AppShell>
    <div class="flex flex-col flex-grow min-h-0 overflow-y-auto">
      <header class="px-gutter pt-[26px] pb-5">
        <h1 class="text-title">Settings</h1>
        <p class="mt-0.5 text-body text-muted">
          Your account and this organization.
        </p>
      </header>

      <!-- The one thing on this screen that is real. -->
      <section class="px-gutter">
        <div class="p-4 rounded-card border border-line max-w-[560px]">
          <h2 class="col-label mb-3">Account</h2>
          <dl class="flex flex-col gap-2.5">
            <div class="flex items-baseline justify-between gap-4">
              <dt class="text-body text-muted">Email</dt>
              <dd class="num text-mono truncate">{{ authStore.user?.email }}</dd>
            </div>
            <div v-if="authStore.user?.name" class="flex items-baseline justify-between gap-4">
              <dt class="text-body text-muted">Name</dt>
              <dd class="text-body truncate">{{ authStore.user.name }}</dd>
            </div>
          </dl>
        </div>
      </section>

      <!--
        Everything the canvas puts on this screen depends on something that does
        not exist: plan and billing on step 7 of the build order, the
        organization name on an endpoint that does not return one, and session
        listing on a backlog item. Naming them is more useful than an empty card
        per row.
      -->
      <NotBuiltYet title="Nothing else here yet" tracked="docs/BACKLOG.md">
        Plan and billing arrive with entitlements; renaming the organization
        needs an endpoint that returns one; signing out other devices needs the
        session listing that <code class="num">refresh_tokens</code> already has
        the data for. Until then, roles and members are managed in
        <RouterLink to="/dashboard/team">Members</RouterLink>.
      </NotBuiltYet>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router'
import AppShell from '@/layouts/AppShell.vue'
import NotBuiltYet from '@/components/ui/NotBuiltYet.vue'
import { useAuthStore } from '@/stores/auth.store'

const authStore = useAuthStore()
</script>
