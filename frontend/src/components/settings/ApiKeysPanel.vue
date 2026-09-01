<template>
  <div data-testid="api-keys-panel">
    <!--
      The plan does not include the API. The customer is told what the tab is
      for and how to get it, and is shown no create form - a button that can only
      answer 402 tells somebody the product is broken when it is enforcing a
      rule (05-frontend-patterns §8).
    -->
    <section
      v-if="planStore.plan && !planStore.plan.hasApiAccess"
      class="px-gutter"
      data-testid="api-keys-upgrade"
    >
      <div class="p-4 rounded-card border border-line max-w-[560px]">
        <h2 class="col-label mb-3">API keys</h2>
        <p class="text-body text-muted">
          The API lets your own systems read your forms and responses. It is part
          of the Team plan, and {{ planStore.plan.name }} does not include it.
        </p>
        <!--
          The canvas puts a price beside this. It is still not rendered, and that
          is permanent: the amount lives in Stripe and the customer sees the real
          one on Stripe's own page (features/0013, trap 7).
        -->
        <p class="mt-2 text-meta text-faint">
          <template v-if="isOwner && planStore.hasSubscription">
            Changing plan is done in the billing portal, where you'll see the
            price before anything is charged.
          </template>
          <template v-else-if="isOwner">
            You'll see the price on the next screen, before anything is charged.
          </template>
          <template v-else>
            Only an owner of this organization can change the plan. Ask them, and
            this tab will let you mint a key straight away.
          </template>
        </p>

        <div v-if="isOwner" class="mt-4 pt-3.5 border-t border-line">
          <Button
            v-if="planStore.hasSubscription"
            label="Manage billing"
            size="small"
            severity="secondary"
            outlined
            data-testid="api-keys-manage-billing"
            :loading="planStore.billingRedirecting"
            @click="planStore.openBillingPortal()"
          />
          <Button
            v-else
            label="Upgrade to Team"
            size="small"
            data-testid="api-keys-upgrade-team"
            :loading="planStore.billingRedirecting"
            @click="planStore.startCheckout('team')"
          />
        </div>
      </div>
    </section>

    <!--
      A member. Distinct from the upgrade state on purpose: `403` and `402` are
      different answers and lead to different places - ask an owner, versus buy
      something (features/0012). Collapsing them sends the customer to the wrong
      one.
    -->
    <section
      v-else-if="planStore.plan && !canManageKeys"
      class="px-gutter"
      data-testid="api-keys-forbidden"
    >
      <div class="p-4 rounded-card border border-line max-w-[560px]">
        <h2 class="col-label mb-3">API keys</h2>
        <p class="text-body text-muted">
          Only an owner or an admin of this organization can see or create API
          keys. Ask one of them for a key, or to be made an admin.
        </p>
      </div>
    </section>

    <template v-else-if="planStore.plan">
      <!--
        The secret, shown once. The server keeps only a hash of it, so if this
        panel is closed without it being copied the key exists and can never be
        used - only revoked. It is the loudest thing on the screen while it is
        here, which is the same treatment the invitation link gets in
        MembersView.vue and for the same reason.
      -->
      <section
        v-if="store.lastCreatedKey"
        class="mx-gutter mb-5 p-4 rounded-card border border-accent bg-accent-soft"
        data-testid="api-key-secret-panel"
      >
        <h2 class="text-row font-semibold">
          Copy “{{ store.lastCreatedKey.name }}” now
        </h2>
        <p class="mt-1 text-meta text-accent-pressed">
          This is the only time this key is shown. We store only a hash of it, so
          it cannot be shown again — if you lose it, revoke it and create another.
        </p>
        <div class="flex gap-2 mt-3">
          <input
            ref="secretInput"
            class="num flex-1 h-control-sm px-2.5 rounded-input border border-line-strong bg-surface text-mono"
            type="text"
            readonly
            data-testid="api-key-secret"
            :value="store.lastCreatedKey.secret"
            @focus="selectSecret"
          />
          <button
            type="button"
            class="h-control-sm px-3.5 rounded-control border border-line-strong bg-surface text-body font-medium hover:bg-surface-sunken transition-colors"
            data-testid="copy-api-key"
            @click="copySecret"
          >
            {{ copied ? 'Copied' : 'Copy' }}
          </button>
        </div>
        <button
          type="button"
          class="mt-3 text-meta text-accent-pressed underline"
          data-testid="dismiss-api-key"
          @click="store.dismissCreatedKey()"
        >
          Done
        </button>
      </section>

      <!--
        The 402 is deliberately absent from this banner. A plan refusing is not
        the request breaking, so it gets the LimitReached dialog instead of a red
        alert saying something went wrong - the same treatment, and the same
        condition, as MembersView.vue gives a seat limit.
      -->
      <p
        v-if="store.error && apiLimitReached === null"
        class="mx-gutter mb-5 px-4 py-3 rounded-card border border-danger bg-danger-soft text-body text-danger"
        role="alert"
        data-testid="api-keys-error"
      >
        {{ store.error }}
      </p>

      <section class="px-gutter">
        <div class="p-4 rounded-card border border-line bg-surface-subtle max-w-[560px]">
          <h2 class="col-label mb-2.5">Create a key</h2>
          <form class="flex flex-wrap gap-2" data-testid="create-key-form" @submit.prevent="submit">
            <input
              v-model="name"
              type="text"
              required
              maxlength="100"
              placeholder="What will use it — “Zapier”, “our CRM”"
              data-testid="api-key-name"
              class="flex-1 min-w-[220px] h-control-sm px-2.5 rounded-input border border-line-strong bg-surface text-body placeholder:text-faint focus:outline-none focus:border-accent focus:shadow-focus"
            />
            <!-- The one accent action on this tab. -->
            <button
              type="submit"
              :disabled="store.loading"
              data-testid="create-key-submit"
              class="h-control-sm px-3.5 rounded-control bg-accent hover:bg-accent-pressed disabled:bg-surface-control disabled:text-disabled text-white text-row font-medium transition-colors"
            >
              Create key
            </button>
          </form>
          <p class="mt-2.5 text-meta text-faint">
            A key reads this organization's forms and responses through
            <code class="num">/api/v1</code>. It belongs to the organization, not
            to you, so it keeps working when you do not.
          </p>
        </div>
      </section>

      <section class="mt-6">
        <table class="w-full" data-testid="api-keys-table">
          <thead>
            <tr class="border-b border-line-soft">
              <th class="col-label text-left px-gutter py-2.5">Key</th>
              <th class="col-label text-left py-2.5 w-[160px]">Last used</th>
              <th class="col-label text-left py-2.5 w-[132px]">Status</th>
              <th class="py-2.5 w-[120px] pr-gutter" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="key in store.keys"
              :key="key.id"
              :data-testid="`api-key-${key.id}`"
              class="border-b border-line-soft hover:bg-surface-subtle transition-colors"
            >
              <td class="px-gutter py-3">
                <div class="text-row font-medium truncate">{{ key.name }}</div>
                <!-- The prefix, never the secret: it is what identifies this row
                     in a list and it authenticates nothing on its own. -->
                <div class="text-mono text-faint truncate">vpk_{{ key.prefix }}…</div>
              </td>
              <td class="py-3 text-meta text-muted">
                <!--
                  `lastUsedAt` is written at most once a minute and its failures
                  are swallowed, so it answers "is this still in use?" and
                  nothing finer. Relative time says exactly that much.
                -->
                {{ key.lastUsedAt ? relativeTime(key.lastUsedAt) : 'Never used' }}
              </td>
              <td class="py-3">
                <StatusPill
                  v-if="key.revokedAt"
                  status="closed"
                  :label="`Revoked ${calendarDate(key.revokedAt)}`"
                />
                <StatusPill v-else status="active" label="Active" />
              </td>
              <td class="py-3 pr-gutter text-right">
                <!--
                  A revoked key keeps its row and offers no action. The row and
                  its timestamp are the only record of when access stopped, which
                  is the question asked once an integration breaks.
                -->
                <button
                  v-if="!key.revokedAt"
                  type="button"
                  :data-testid="`revoke-key-${key.id}`"
                  class="h-control-xs px-2.5 rounded-input text-meta text-muted hover:text-danger hover:bg-danger-soft transition-colors"
                  @click="store.revoke(key.id)"
                >
                  Revoke
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <p
          v-if="!store.keys.length && !store.loading"
          class="px-gutter py-6 text-body text-muted"
          data-testid="api-keys-empty"
        >
          No keys yet. Create one above, and read
          <code class="num">/api/v1/forms</code> with it.
        </p>
      </section>
    </template>

    <LimitReachedDialog
      limit="api"
      :visible="apiLimitReached !== null"
      :message="apiLimitReached"
      @close="apiLimitReached = null"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Button from 'primevue/button'
import StatusPill from '@/components/ui/StatusPill.vue'
import LimitReachedDialog from '@/components/plan/LimitReachedDialog.vue'
import { useApiKeysStore } from '@/stores/apiKeys.store'
import { usePlanStore } from '@/stores/plan.store'
import { useOrganizationStore } from '@/stores/organization.store'
import { ApiError } from '@/services/api'
import { relativeTime, calendarDate } from '@/utils/formatDate'

/**
 * The API keys tab on Settings
 * ([`features/0021`](../../../../features/0021-api-keys-screen.md)).
 *
 * What it draws is decided by two things the server already answers, and it
 * copies neither rule locally: `plan.hasApiAccess` says whether the plan
 * includes the API, and the caller's membership role says whether this person
 * may manage credentials. Both only choose what is rendered — the endpoints
 * enforce them, and the `402` path below is what happens when this screen's copy
 * of the answer has gone stale.
 */
const store = useApiKeysStore()
const planStore = usePlanStore()
const organizationStore = useOrganizationStore()

/** The `402` message from creating a key; drives the LimitReached dialog. */
const apiLimitReached = ref<string | null>(null)
const name = ref('')
const copied = ref(false)
const secretInput = ref<HTMLInputElement | null>(null)

const isOwner = computed(() => organizationStore.currentRole === 'owner')

/**
 * Who may list, create and revoke — `owner` or `admin`, matching
 * `requireRole(req, ['owner', 'admin'])` on all three routes.
 *
 * Read through `organizationStore.currentRole`, the same source `MembersView`
 * and `SettingsView` use. A second source for "what may I do" is a second answer
 * waiting to disagree with the API.
 */
const canManageKeys = computed(
  () => organizationStore.currentRole === 'owner' || organizationStore.currentRole === 'admin'
)

/**
 * Load once it is known that the call will be allowed.
 *
 * The role arrives asynchronously (`SettingsView` loads the members list), so
 * this waits for it rather than firing a request that would answer `403` and
 * leave an error on a screen the customer cannot act on. The plan gate is here
 * for the same reason: an organization without the API has no keys to list.
 */
watch(
  () => canManageKeys.value && planStore.plan?.hasApiAccess === true,
  allowed => {
    if (allowed && !store.keys.length) store.load()
  },
  { immediate: true }
)

async function submit() {
  apiLimitReached.value = null

  try {
    await store.create(name.value)
    name.value = ''
    copied.value = false
  } catch (error) {
    // On the status, never on the message: `402` is the plan refusing and `403`
    // is a permission failure (features/0012). This path stays even though
    // `hasApiAccess` already hid the form — the plan can change between the page
    // loading and this button being pressed, and the server is the only thing
    // that decides.
    if (error instanceof ApiError && error.status === 402) {
      apiLimitReached.value = error.message
      planStore.refresh()
      return
    }
    // The store holds the message; the template renders it.
  }
}

function selectSecret() {
  secretInput.value?.select()
}

async function copySecret() {
  const secret = store.lastCreatedKey?.secret
  if (!secret) return

  try {
    await navigator.clipboard.writeText(secret)
    copied.value = true
  } catch {
    // Clipboard access can be refused outright (permissions, an insecure
    // context). Selecting the text leaves the customer able to copy it by hand,
    // which matters more here than anywhere else in the app: this value does not
    // come back.
    selectSecret()
  }
}
</script>
