<template>
  <AppShell>
    <div class="flex flex-col flex-grow min-h-0 overflow-y-auto">
      <header class="px-gutter pt-[26px] pb-5">
        <h1 class="text-title">Responses</h1>
        <p class="mt-0.5 text-body text-muted">
          Every answer collected across the organization's forms.
        </p>
      </header>

      <!--
        The canvas has Responses as a top-level destination, and the API has no
        endpoint for it: `GET /api/responses/form/:formId` is per form, so an
        organization-wide list would mean N requests and a client-side merge
        with no pagination. Rather than fake it, this points at the per-form
        view that does exist.
      -->
      <NotBuiltYet title="Not built yet" tracked="docs/BACKLOG.md">
        Responses are collected and exported per form. Open a form from
        <RouterLink to="/dashboard">Forms</RouterLink> to read its answers or
        download the CSV. A combined view across every form needs an endpoint
        the API does not have.
      </NotBuiltYet>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router'
import AppShell from '@/layouts/AppShell.vue'
import NotBuiltYet from '@/components/ui/NotBuiltYet.vue'
</script>
