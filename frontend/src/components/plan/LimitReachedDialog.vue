<template>
  <Dialog
    :visible="visible"
    modal
    :closable="false"
    :draggable="false"
    :style="{ width: '440px' }"
    :pt="{ header: { class: 'hidden' } }"
    @update:visible="$emit('close')"
  >
    <div class="pt-1" data-testid="limit-reached">
      <div
        class="flex items-center justify-center w-8 h-8 rounded-input bg-limit-soft text-limit mb-3.5"
      >
        <i class="pi pi-lock text-[15px]" />
      </div>

      <h2 class="text-section">
        You've reached the form limit on {{ planStore.plan?.name ?? 'your plan' }}
      </h2>

      <p class="mt-2 text-body text-muted">
        {{ explanation }}
      </p>

      <div v-if="planStore.plan" class="grid grid-cols-2 gap-5 mt-5">
        <UsageMeter
          label="Published forms"
          :used="planStore.usage?.publishedForms ?? 0"
          :limit="planStore.plan.maxPublishedForms"
        />
        <UsageMeter
          label="Responses this month"
          :used="planStore.usage?.responsesThisPeriod ?? 0"
          :limit="planStore.plan.maxResponsesPerMonth"
        />
      </div>

      <!--
        The canvas puts an "Upgrade to Pro" card here with a price on it. The
        upgrade is built now (features/0013); the price is still not rendered,
        and that is deliberate rather than unfinished - the amount lives in
        Stripe and the customer sees the real one on Stripe's own Checkout page,
        which is the only place it is true (trap 7).
      -->
      <p class="mt-5 pt-4 border-t border-line text-meta text-faint">
        <template v-if="canUpgrade">
          Upgrading publishes as many forms as you need. You'll see the price on
          the next screen, before anything is charged.
        </template>
        <template v-else-if="isOwner">
          You're already on the highest plan we sell, so the way to publish this
          one is to unpublish another form.
        </template>
        <template v-else>
          Only an owner of this organization can change the plan, so the way to
          publish this one now is to unpublish another form.
        </template>
      </p>

      <p
        v-if="planStore.billingError"
        class="mt-2 text-meta text-limit"
        role="alert"
        data-testid="limit-billing-error"
      >
        {{ planStore.billingError }}
      </p>
    </div>

    <template #footer>
      <div class="flex items-center justify-end gap-2">
        <Button label="Not now" text severity="secondary" @click="$emit('close')" />
        <Button label="Manage forms" severity="secondary" outlined @click="$emit('close')" />
        <!--
          Owner only, agreeing with `POST /api/billing/checkout`, which answers
          403 to anyone else. Offering a button that is guaranteed to fail is
          worse than not offering it.
        -->
        <Button
          v-if="canUpgrade"
          label="Upgrade"
          data-testid="upgrade-from-limit"
          :loading="planStore.billingRedirecting"
          @click="planStore.startCheckout()"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import Dialog from 'primevue/dialog'
import Button from 'primevue/button'
import { usePlanStore } from '@/stores/plan.store'
import { useOrganizationStore } from '@/stores/organization.store'
import UsageMeter from './UsageMeter.vue'

/**
 * The `LimitReached` artboard: what a `402` from publishing looks like.
 *
 * It exists because the alternative is a red toast saying "Failed to publish",
 * which tells someone that something broke rather than that they hit a limit
 * they can do something about. The canvas's own wording is kept — the form
 * "stays a draft until you free up a slot or upgrade" — because it says the one
 * thing that matters: nothing was lost.
 *
 * `message` is the server's, and it is preferred over anything assembled here.
 * The backend owns the limit; a second copy of the sentence in the frontend is
 * a second thing to keep in step.
 */
const props = defineProps<{
  visible: boolean
  /** The `402` message from the API. */
  message?: string | null
  /** The form that stayed a draft, named the way the canvas names it. */
  formTitle?: string | null
}>()

defineEmits<{ close: [] }>()

const planStore = usePlanStore()

/**
 * Whether this person may buy anything, read the way `MembersView.vue` reads
 * the role rather than by inventing a second source for it.
 *
 * The members list may not have been loaded when this dialog opens - it appears
 * on a 402 from publishing, which can happen anywhere - so it is asked for here.
 * `load()` is idempotent enough for that: it refetches, it does not duplicate.
 */
const organizationStore = useOrganizationStore()
const isOwner = computed(() => organizationStore.currentRole === 'owner')

onMounted(() => {
  if (organizationStore.currentRole === null) organizationStore.load()
})

/**
 * There is a plan above this one, and this person may buy it.
 *
 * `pro` and `dev` are both already unlimited on published forms, and `team`
 * cannot be bought at all (it is priced per seat - features/0013 leaves it out
 * deliberately), so `free` is the only plan an upgrade button makes sense on.
 * Offering one anywhere else would open Checkout for something the customer
 * already has or cannot have.
 */
const canUpgrade = computed(() => isOwner.value && planStore.plan?.key === 'free')

const explanation = computed(() => {
  if (props.message) {
    return props.formTitle
      ? `${props.message} “${props.formTitle}” stays a draft until then.`
      : props.message
  }

  return props.formTitle
    ? `“${props.formTitle}” stays a draft until you free up a slot.`
    : 'This form stays a draft until you free up a slot.'
})
</script>
