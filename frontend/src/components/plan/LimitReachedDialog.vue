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
        {{ heading }}
      </h2>

      <p class="mt-2 text-body text-muted">
        {{ explanation }}
      </p>

      <!--
        No meters for `api`: it is a capability, not a quantity. Drawing the
        forms and responses bars beside "your plan does not include the API"
        would invite the customer to read a number as the reason it was refused.
      -->
      <div v-if="planStore.plan && limit !== 'api'" class="grid grid-cols-2 gap-5 mt-5">
        <UsageMeter
          v-if="limit === 'seats'"
          label="Members"
          :used="planStore.usage?.seats ?? 0"
          :limit="planStore.plan.seats"
        />
        <UsageMeter
          v-else
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
        <!--
          The API is Team-only (features/0019), and Team is a different plan
          rather than a bigger allowance - so the way out is a plan change, and
          for somebody who already pays that is the portal's job, not a second
          checkout (features/0015).
        -->
        <template v-if="limit === 'api'">
          <template v-if="isOwner && planStore.hasSubscription">
            The API is part of Team. Change plan in the billing portal - you'll
            see the price there, before anything is charged.
          </template>
          <template v-else-if="isOwner">
            The API is part of Team. You'll see the price on the next screen,
            before anything is charged.
          </template>
          <template v-else>
            The API is part of Team, and only an owner of this organization can
            change the plan. Ask them, and your key will mint straight away.
          </template>
        </template>
        <template v-else-if="limit === 'seats'">
          <!--
            Seats are **bought, not billed after the fact** (features/0015): the
            owner sets the number in Stripe's portal and the invitation is sent
            afterwards. So there is no "add a seat" button here to press - the
            honest thing to say is where the number is changed, and by whom.
          -->
          <template v-if="isOwner && planStore.hasSubscription">
            Seats are added in the billing portal. Buy one there, then send this
            invitation again - nobody is removed and nothing is lost meanwhile.
          </template>
          <template v-else-if="isOwner">
            Upgrading adds seats for the people you want to invite. You'll see the
            price on the next screen, before anything is charged.
          </template>
          <template v-else>
            Only an owner of this organization can buy seats. Ask them to add one,
            and this invitation will go through unchanged.
          </template>
        </template>
        <template v-else-if="canUpgrade">
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
        <Button
          v-if="limit === 'forms'"
          label="Manage forms"
          severity="secondary"
          outlined
          @click="$emit('close')"
        />
        <!--
          Owner only, agreeing with `POST /api/billing/checkout` and
          `/portal`, both of which answer 403 to anyone else. Offering a button
          that is guaranteed to fail is worse than not offering it.
        -->
        <Button
          v-if="limit === 'seats' && isOwner && planStore.hasSubscription"
          label="Add seats"
          data-testid="add-seats-from-limit"
          :loading="planStore.billingRedirecting"
          @click="planStore.openBillingPortal()"
        />
        <!--
          Owner only, like every other control here. An existing subscriber goes
          to the portal to switch plan; a first purchase opens Checkout for Team
          directly, because the portal cannot make one.
        -->
        <Button
          v-else-if="limit === 'api' && isOwner && planStore.hasSubscription"
          label="Manage billing"
          data-testid="manage-billing-from-limit"
          :loading="planStore.billingRedirecting"
          @click="planStore.openBillingPortal()"
        />
        <Button
          v-else-if="limit === 'api' && isOwner"
          label="Upgrade to Team"
          data-testid="upgrade-team-from-limit"
          :loading="planStore.billingRedirecting"
          @click="planStore.startCheckout('team')"
        />
        <Button
          v-else-if="canUpgrade"
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
const props = withDefaults(
  defineProps<{
    visible: boolean
    /** The `402` message from the API. */
    message?: string | null
    /** The form that stayed a draft, named the way the canvas names it. */
    formTitle?: string | null
    /**
     * Which limit was hit (features/0015).
     *
     * `forms` is the original `LimitReached` artboard and stays the default, so
     * every existing call site means exactly what it did. `seats` is the same
     * screen for an invitation that came back `402`: same reasoning — a limit is
     * not a failure — and a different action, because seats are bought in the
     * portal rather than by upgrading.
     *
     * `api` is the third (features/0021): a `402` from minting an API key, which
     * is a capability the plan does not have rather than an allowance that ran
     * out. It renders no meters for that reason.
     */
    limit?: 'forms' | 'seats' | 'api'
  }>(),
  { message: null, formTitle: null, limit: 'forms' }
)

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

const heading = computed(() => {
  const planName = planStore.plan?.name ?? 'your plan'

  if (props.limit === 'seats') return `${planName} doesn't have a seat for this person yet`
  if (props.limit === 'api') return `${planName} doesn't include the API`

  return `You've reached the form limit on ${planName}`
})

const explanation = computed(() => {
  // The server's sentence, always preferred: it is the one that knows the real
  // numbers, and a second copy here is a second thing to keep in step.
  if (props.limit === 'seats') {
    return (
      props.message ??
      'This organization has no free seat, so the invitation was not sent. Nobody was removed.'
    )
  }

  if (props.limit === 'api') {
    return (
      props.message ??
      'No key was created. The keys this organization already has are unaffected.'
    )
  }

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
