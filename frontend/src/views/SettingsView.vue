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

      <!-- Plan & usage, from the canvas's `Plans` artboard. -->
      <section v-if="planStore.plan" class="px-gutter mt-5" data-testid="plan-usage">
        <div class="p-4 rounded-card border border-line max-w-[560px]">
          <h2 class="col-label mb-3">Plan &amp; usage</h2>

          <div class="flex items-baseline gap-2.5 mb-4">
            <span class="text-[19px] font-semibold tracking-[-0.01em]">
              {{ planStore.plan.name }}
            </span>
            <!--
              The canvas puts "€12 / month" and a renewal date beside the name.
              Neither is rendered: there is no billing, and docs/BACKLOG.md
              records that the prices on the canvas are not a decision anyone has
              taken. A price shown here would be the product quoting a figure the
              business has not agreed to.
            -->
            <span class="text-meta text-faint">Current plan</span>
          </div>

          <div class="flex flex-col gap-3.5">
            <UsageMeter
              label="Responses this month"
              :used="planStore.usage?.responsesThisPeriod ?? 0"
              :limit="planStore.plan.maxResponsesPerMonth"
            />
            <UsageMeter
              label="Published forms"
              :used="planStore.usage?.publishedForms ?? 0"
              :limit="planStore.plan.maxPublishedForms"
            />
            <UsageMeter
              label="Members"
              :used="planStore.usage?.seats ?? 0"
              :limit="planStore.plan.seats"
            />
          </div>

          <p class="mt-4 pt-3.5 border-t border-line text-meta text-faint">
            Responses reset at the start of each month (UTC). Unpublishing a form
            frees its slot straight away. The member limit is not enforced yet.
          </p>
        </div>
      </section>

      <!--
        What is left is still genuinely missing: the organization name needs an
        endpoint that returns one, and session listing needs one too. Changing
        plan needs billing, which is step 8 of the build order.
      -->
      <NotBuiltYet title="Nothing else here yet" tracked="docs/BACKLOG.md">
        Changing plan needs billing, which does not exist yet; renaming the
        organization needs an endpoint that returns one; signing out other
        devices needs the session listing that
        <code class="num">refresh_tokens</code> already has the data for. Until
        then, roles and members are managed in
        <RouterLink to="/dashboard/team">Members</RouterLink>.
      </NotBuiltYet>
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { RouterLink } from 'vue-router'
import AppShell from '@/layouts/AppShell.vue'
import NotBuiltYet from '@/components/ui/NotBuiltYet.vue'
import UsageMeter from '@/components/plan/UsageMeter.vue'
import { useAuthStore } from '@/stores/auth.store'
import { usePlanStore } from '@/stores/plan.store'

const authStore = useAuthStore()
// `AppShell` loads the plan for the sidebar card, so this screen reads what is
// already there rather than fetching it a second time.
const planStore = usePlanStore()
</script>
