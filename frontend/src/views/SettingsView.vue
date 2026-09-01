<template>
  <AppShell>
    <div class="flex flex-col flex-grow min-h-0 overflow-y-auto">
      <header class="px-gutter pt-[26px] pb-5">
        <h1 class="text-title">Settings</h1>
        <p class="mt-0.5 text-body text-muted">
          Your account and this organization.
        </p>
      </header>

      <!--
        Two tabs, as the Settings artboard draws them. Built for the two that
        exist and not as a mechanism for the ones that might: the webhooks tab is
        its own piece of work, and a general tab framework built ahead of it
        would be a guess at what it needs.
      -->
      <nav class="px-gutter border-b border-line flex gap-1" data-testid="settings-tabs">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="h-control-sm px-3 -mb-px border-b-2 text-row font-medium transition-colors"
          :class="activeTab === tab.id
            ? 'border-accent text-ink'
            : 'border-transparent text-muted hover:text-ink'"
          :data-testid="`settings-tab-${tab.id}`"
          @click="selectTab(tab.id)"
        >
          {{ tab.label }}
        </button>
      </nav>

      <template v-if="activeTab === 'general'">
      <!-- The one thing on this screen that is real. -->
      <section class="px-gutter mt-5">
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
              The canvas puts "€12 / month" beside the name. It is still not
              rendered, and that is not an omission: the amount lives in Stripe
              and nowhere else (features/0013, trap 7), and docs/BACKLOG.md
              records that the prices on the canvas are not a decision anyone has
              taken. The customer sees the real figure on Stripe's own Checkout
              and Portal pages, which is the only place it is true.
            -->
            <span class="text-meta text-faint">{{ planSubtitle }}</span>
          </div>

          <!--
            Returning from Checkout. The redirect is NOT proof of payment - it is
            a URL anyone can visit, the payment may still be processing, and a
            customer who closed the tab never arrives here at all. So this says
            activation is in progress and re-reads the plan; it never writes
            anything and never asserts success on its own (features/0013, trap 2).
          -->
          <div
            v-if="checkoutReturn === 'complete'"
            class="mb-4 p-3 rounded-input bg-surface-sunken border border-line"
            data-testid="checkout-activating"
          >
            <p class="text-body">
              <template v-if="planStore.hasSubscription">
                Your subscription is active. Thank you.
              </template>
              <template v-else>
                We're activating your subscription. Stripe confirms the payment
                separately, so this can take a few seconds - this page will
                update itself.
              </template>
            </p>
          </div>

          <div
            v-else-if="checkoutReturn === 'cancelled'"
            class="mb-4 p-3 rounded-input bg-surface-sunken border border-line"
            data-testid="checkout-cancelled"
          >
            <p class="text-body">Checkout was cancelled. Nothing was charged.</p>
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
            <!--
              `plan.seats` is the **effective** limit the server resolved, not
              the catalogue's (features/0015): on Team it is what the customer
              actually bought, so this meter is right for somebody who paid for
              eight seats. The client is deliberately not told which of the two
              it received - one number, one meaning.
            -->
            <UsageMeter
              label="Members"
              :used="planStore.usage?.seats ?? 0"
              :limit="planStore.plan.seats"
            />
          </div>

          <!--
            Purchase controls, owner only - the same rule the API enforces
            (`requireRole(req, ['owner'])` on both billing routes). A member or
            an admin sees the plan and the usage and no way to spend money, so
            the UI and the API agree instead of the UI offering a button that
            answers 403.
          -->
          <div v-if="isOwner" class="mt-4 pt-3.5 border-t border-line flex flex-wrap gap-2">
            <!--
              Two purchases rather than a plan picker (features/0015). Switching
              an existing subscription is Stripe's portal - it needs proration
              previews, confirmation and 3-D Secure, all of which already exist
              there and none of which should be rebuilt here. These two buttons
              only exist for the first purchase, which the portal cannot make.
            -->
            <Button
              v-if="!planStore.hasSubscription"
              label="Upgrade to Pro"
              size="small"
              data-testid="change-plan"
              :loading="planStore.billingRedirecting"
              @click="planStore.startCheckout('pro')"
            />
            <Button
              v-if="!planStore.hasSubscription"
              label="Upgrade to Team"
              size="small"
              severity="secondary"
              outlined
              data-testid="checkout-team"
              :loading="planStore.billingRedirecting"
              @click="planStore.startCheckout('team')"
            />
            <Button
              v-else
              label="Manage billing"
              size="small"
              severity="secondary"
              outlined
              data-testid="manage-billing"
              :loading="planStore.billingRedirecting"
              @click="planStore.openBillingPortal()"
            />
          </div>

          <p
            v-if="planStore.billingError"
            class="mt-2 text-meta text-limit"
            role="alert"
            data-testid="billing-error"
          >
            {{ planStore.billingError }}
          </p>

          <p class="mt-4 pt-3.5 border-t border-line text-meta text-faint">
            Responses reset at the start of each month (UTC). Unpublishing a form
            frees its slot straight away. A member or a pending invitation each
            take a seat.
            <!--
              Seats are bought, not billed after the fact (features/0015): adding
              somebody to a Team plan that is full is two steps, buy then invite,
              and saying so here is the difference between a deliberate trade and
              a product that looks broken.
            -->
            <template v-if="isOwner && isPerSeatPlan">
              Seats are bought in Stripe's billing portal - add one there, then
              send the invitation. Lowering the number removes nobody.
            </template>
            <template v-if="isOwner">
              Cancelling, changing your card and past invoices all live in
              Stripe's billing portal - this application never sees a card
              number.
            </template>
          </p>
        </div>
      </section>

      <!--
        What is left is still genuinely missing. Billing is no longer on this
        list (features/0013), and neither is the Team plan (features/0015).
      -->
      <NotBuiltYet title="Nothing else on this tab yet" tracked="docs/BACKLOG.md">
        Renaming the organization needs an endpoint that returns its name;
        signing out other devices needs the session listing that
        <code class="num">refresh_tokens</code> already has the data for. Until
        then, roles and members are managed in
        <RouterLink to="/dashboard/team">Members</RouterLink>.
      </NotBuiltYet>
      </template>

      <ApiKeysPanel v-else class="mt-5" />
    </div>
  </AppShell>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import Button from 'primevue/button'
import AppShell from '@/layouts/AppShell.vue'
import NotBuiltYet from '@/components/ui/NotBuiltYet.vue'
import UsageMeter from '@/components/plan/UsageMeter.vue'
import ApiKeysPanel from '@/components/settings/ApiKeysPanel.vue'
import { useAuthStore } from '@/stores/auth.store'
import { usePlanStore } from '@/stores/plan.store'
import { useOrganizationStore } from '@/stores/organization.store'

const authStore = useAuthStore()
// `AppShell` loads the plan for the sidebar card, so this screen reads what is
// already there rather than fetching it a second time.
const planStore = usePlanStore()
const route = useRoute()
const router = useRouter()

/**
 * The tabs on this screen, and which one is showing.
 *
 * The tab lives in the query string rather than in a `ref` so that a link can
 * point at it and a reload keeps it — support saying "open Settings, API keys
 * tab" is a URL, not a set of instructions. It is a separate parameter from
 * `?checkout=`, which the Stripe redirect owns.
 */
const tabs = [
  { id: 'general', label: 'General' },
  { id: 'api-keys', label: 'API keys' }
] as const

type TabId = (typeof tabs)[number]['id']

const activeTab = computed<TabId>(() =>
  route.query.tab === 'api-keys' ? 'api-keys' : 'general'
)

function selectTab(tab: TabId) {
  if (tab === activeTab.value) return
  // `replace`, not `push`: flipping a tab is not a place in the history that
  // Back should have to walk through.
  router.replace({ query: { ...route.query, tab: tab === 'general' ? undefined : tab } })
}

/**
 * The caller's own role, read the way `MembersView.vue` already reads it -
 * derived from the members list rather than fetched a second way. A second
 * source for "what am I allowed to do" is a second answer waiting to disagree
 * with the API.
 */
const organizationStore = useOrganizationStore()
const isOwner = computed(() => organizationStore.currentRole === 'owner')

/**
 * Whether this plan's seats are bought rather than declared.
 *
 * Named by the key rather than by "is it Team", because the question the copy
 * below asks is *where does the seat number come from* — and the answer is the
 * portal for exactly the plans the backend puts in `PER_SEAT_PLANS`.
 */
const isPerSeatPlan = computed(() => planStore.plan?.key === 'team')

/** `?checkout=complete` or `?checkout=cancelled`, set by the Stripe redirect. */
const checkoutReturn = computed(() => {
  const value = route.query.checkout
  return value === 'complete' || value === 'cancelled' ? value : null
})

/**
 * Re-reads entitlements after a return from Checkout, a few times.
 *
 * It polls rather than awaits because **the payment is confirmed to the server,
 * not to this browser**: Stripe's webhook may land before, during or after the
 * redirect, and nothing here can be told when. So the page asks again a few
 * times and then stops - it does not poll forever, because a subscription that
 * has not appeared in half a minute needs Stripe looked at, not another request.
 *
 * It writes nothing and grants nothing. Arriving here is not evidence of
 * anything (trap 2); the plan on screen is always the one the server reported.
 */
const ATTEMPTS = 10
const INTERVAL_MS = 3000
let timer: ReturnType<typeof setInterval> | null = null
const attemptsLeft = ref(0)

function stopPolling() {
  if (timer !== null) {
    clearInterval(timer)
    timer = null
  }
}

onMounted(async () => {
  // The role comes from the members list; without this the owner-only controls
  // would never appear on a hard load of this screen.
  await organizationStore.load()

  if (checkoutReturn.value !== 'complete' || planStore.hasSubscription) return

  attemptsLeft.value = ATTEMPTS
  timer = setInterval(async () => {
    attemptsLeft.value -= 1
    await planStore.refresh()

    if (planStore.hasSubscription || attemptsLeft.value <= 0) stopPolling()
  }, INTERVAL_MS)
})

onUnmounted(stopPolling)

/**
 * What sits beside the plan name. Never a price - see the comment in the
 * template - and never a guess: every word here comes from what the server
 * reported about this customer's own subscription.
 */
const planSubtitle = computed(() => {
  const subscription = planStore.subscription
  if (!subscription) return 'Current plan'

  const renews = subscription.currentPeriodEnd
    ? new Date(subscription.currentPeriodEnd).toLocaleDateString()
    : null

  if (subscription.cancelAtPeriodEnd) {
    return renews ? `Ends ${renews}` : 'Ends at the period end'
  }

  // Stripe is retrying the payment, and the plan is deliberately kept until it
  // gives up. Saying so is better than showing "Pro" while the card is failing.
  if (subscription.status === 'past_due') {
    return 'Payment failed - we are retrying'
  }

  return renews ? `Renews ${renews}` : 'Current plan'
})
</script>
