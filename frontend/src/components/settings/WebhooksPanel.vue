<template>
  <div data-testid="webhooks-panel">
    <!--
      A member. The server answers 403 to all three routes, so this is not a
      screen with things hidden - there is nothing here for this person. Distinct
      copy from the two states below: "ask someone" and "buy something" and "this
      deployment is broken" send the customer to three different places.
    -->
    <section v-if="!canManage" class="px-gutter" data-testid="webhooks-forbidden">
      <div class="p-4 rounded-card border border-line max-w-[560px]">
        <h2 class="col-label mb-3">Webhooks</h2>
        <p class="text-body text-muted">
          Only an owner or an admin of this organization can see or configure
          webhook endpoints. Ask one of them.
        </p>
      </div>
    </section>

    <template v-else>
      <!--
        The deployment cannot deliver: no job queue, or no signing key. Nothing
        the customer can do about it, and it is shown **before** the list and
        with an empty one too - that is exactly the moment somebody is about to
        configure an endpoint that would never fire.
      -->
      <section
        v-if="!store.deliverable"
        class="mx-gutter mb-5 p-4 rounded-card border border-limit bg-limit-soft"
        data-testid="webhooks-undeliverable"
      >
        <h2 class="text-row font-semibold text-limit">Webhooks are not delivering</h2>
        <p class="mt-1 text-meta text-limit">
          This installation has no job queue or no signing key configured, so
          nothing is being sent and new endpoints cannot be created. Anything
          already configured is listed below, unchanged. This is a server
          setting, not something your plan or your account can change.
        </p>
      </section>

      <!--
        The plan does not include webhooks. Same entitlement as the read API -
        one capability, one flag - and the same treatment as the API keys tab.
      -->
      <section
        v-else-if="planStore.plan && !planStore.plan.hasApiAccess"
        class="px-gutter mb-5"
        data-testid="webhooks-upgrade"
      >
        <div class="p-4 rounded-card border border-line max-w-[560px]">
          <h2 class="col-label mb-3">Webhooks</h2>
          <p class="text-body text-muted">
            A webhook posts each new response to your own server, signed, with
            retries. It is part of the Team plan, and
            {{ planStore.plan.name }} does not include it.
          </p>
          <p class="mt-2 text-meta text-faint">
            <template v-if="isOwner && planStore.hasSubscription">
              Changing plan is done in the billing portal, where you'll see the
              price before anything is charged.
            </template>
            <template v-else-if="isOwner">
              You'll see the price on the next screen, before anything is charged.
            </template>
            <template v-else>
              Only an owner of this organization can change the plan.
            </template>
          </p>

          <div v-if="isOwner" class="mt-4 pt-3.5 border-t border-line">
            <Button
              v-if="planStore.hasSubscription"
              label="Manage billing"
              size="small"
              severity="secondary"
              outlined
              data-testid="webhooks-manage-billing"
              :loading="planStore.billingRedirecting"
              @click="planStore.openBillingPortal()"
            />
            <Button
              v-else
              label="Upgrade to Team"
              size="small"
              data-testid="webhooks-upgrade-team"
              :loading="planStore.billingRedirecting"
              @click="planStore.startCheckout('team')"
            />
          </div>
        </div>
      </section>

      <!--
        The secret, shown once. Encrypted rather than hashed on the server
        (it has to sign), but never returned twice - and there is no rotation
        yet, so losing it means deleting the endpoint and re-pointing the
        receiver at a new one.
      -->
      <section
        v-if="store.lastCreatedEndpoint"
        class="mx-gutter mb-5 p-4 rounded-card border border-accent bg-accent-soft"
        data-testid="webhook-secret-panel"
      >
        <h2 class="text-row font-semibold">Copy this signing secret now</h2>
        <p class="mt-1 text-meta text-accent-pressed">
          This is the only time it is shown. Your server uses it to verify the
          <code class="num">X-VuePDF-Signature</code> header — an HMAC over
          <code class="num">&lt;timestamp&gt;.&lt;raw body&gt;</code>, so verify
          the raw bytes you received rather than re-serialised JSON.
        </p>
        <div class="flex gap-2 mt-3">
          <input
            ref="secretInput"
            class="num flex-1 h-control-sm px-2.5 rounded-input border border-line-strong bg-surface text-mono"
            type="text"
            readonly
            data-testid="webhook-secret"
            :value="store.lastCreatedEndpoint.secret"
            @focus="selectSecret"
          />
          <button
            type="button"
            class="h-control-sm px-3.5 rounded-control border border-line-strong bg-surface text-body font-medium hover:bg-surface-sunken transition-colors"
            data-testid="copy-webhook-secret"
            @click="copySecret"
          >
            {{ copied ? 'Copied' : 'Copy' }}
          </button>
        </div>
        <button
          type="button"
          class="mt-3 text-meta text-accent-pressed underline"
          data-testid="dismiss-webhook-secret"
          @click="store.dismissCreatedEndpoint()"
        >
          Done
        </button>
      </section>

      <!--
        The 402 is deliberately absent from this banner: a plan refusing is not
        the request breaking, so it gets the LimitReached dialog instead.
      -->
      <p
        v-if="store.error && apiLimitReached === null"
        class="mx-gutter mb-5 px-4 py-3 rounded-card border border-danger bg-danger-soft text-body text-danger"
        role="alert"
        data-testid="webhooks-error"
      >
        {{ store.error }}
      </p>

      <section v-if="canCreate" class="px-gutter">
        <div class="p-4 rounded-card border border-line bg-surface-subtle max-w-[560px]">
          <h2 class="col-label mb-2.5">Add an endpoint</h2>
          <form class="flex flex-wrap gap-2" data-testid="create-webhook-form" @submit.prevent="submit">
            <input
              v-model="url"
              type="url"
              required
              placeholder="https://your-server.example.com/hooks/vuepdf"
              data-testid="webhook-url"
              class="flex-1 min-w-[260px] h-control-sm px-2.5 rounded-input border border-line-strong bg-surface text-body placeholder:text-faint focus:outline-none focus:border-accent focus:shadow-focus"
            />
            <!-- The one accent action on this tab. -->
            <button
              type="submit"
              :disabled="store.loading"
              data-testid="create-webhook-submit"
              class="h-control-sm px-3.5 rounded-control bg-accent hover:bg-accent-pressed disabled:bg-surface-control disabled:text-disabled text-white text-row font-medium transition-colors"
            >
              Add endpoint
            </button>
          </form>
          <p class="mt-2.5 text-meta text-faint">
            <!--
              Only one event exists. No picker is drawn for a single value, and
              none may be drawn for values the backend would reject.
            -->
            We'll post <code class="num">response.created</code> to it over
            https, signed, and retry with backoff if your server is unreachable.
            The URL must be https and must not point inside a private network.
          </p>
        </div>
      </section>

      <section class="mt-6">
        <ul data-testid="webhooks-list">
          <li
            v-for="endpoint in store.endpoints"
            :key="endpoint.id"
            :data-testid="`webhook-${endpoint.id}`"
            class="border-b border-line-soft"
          >
            <div class="flex items-center gap-4 px-gutter py-3">
              <div class="flex-grow min-w-0">
                <div class="text-mono truncate">{{ endpoint.url }}</div>
                <div class="text-meta text-faint truncate">
                  {{ endpoint.events.join(', ') }} · added
                  {{ calendarDate(endpoint.createdAt) }}
                  <!--
                    `consecutiveFailures` counts failures **since the last
                    success**, not ever - the queue zeroes it on any successful
                    delivery. Named for what it is, so a 0 is not read as "this
                    has never failed" while the log below says otherwise.
                  -->
                  <template v-if="endpoint.consecutiveFailures > 0">
                    · {{ endpoint.consecutiveFailures }} failed since the last
                    success
                  </template>
                </div>
                <div
                  v-if="endpoint.lastError"
                  class="text-meta text-danger truncate"
                  :data-testid="`webhook-error-${endpoint.id}`"
                >
                  {{ endpoint.lastError }}
                </div>
              </div>

              <StatusPill
                v-if="endpoint.disabledAt"
                status="closed"
                :label="`Disabled ${calendarDate(endpoint.disabledAt)}`"
              />
              <StatusPill v-else status="active" label="Active" />

              <div class="flex items-center gap-1.5">
                <button
                  type="button"
                  class="h-control-xs px-2.5 rounded-input text-meta text-muted hover:text-ink hover:bg-surface-sunken transition-colors"
                  :data-testid="`deliveries-${endpoint.id}`"
                  @click="toggleDeliveries(endpoint.id)"
                >
                  {{ store.openDeliveriesFor === endpoint.id ? 'Hide history' : 'History' }}
                </button>
                <!--
                  Re-enable exists because the queue disables an endpoint after
                  ten consecutive failures and nothing else can switch it back
                  on. It keeps the id and the secret, which delete-and-recreate
                  would not.
                -->
                <button
                  v-if="endpoint.disabledAt"
                  type="button"
                  class="h-control-xs px-2.5 rounded-input text-meta text-accent hover:bg-accent-soft transition-colors"
                  :data-testid="`reenable-${endpoint.id}`"
                  @click="store.reenable(endpoint.id)"
                >
                  Re-enable
                </button>
                <button
                  type="button"
                  class="h-control-xs px-2.5 rounded-input text-meta text-muted hover:text-danger hover:bg-danger-soft transition-colors"
                  :data-testid="`delete-${endpoint.id}`"
                  @click="confirmingDelete = endpoint.id"
                >
                  Delete
                </button>
              </div>
            </div>

            <!--
              Deleting takes the delivery history with it (onDelete: Cascade), so
              it says so before doing it rather than after.
            -->
            <div
              v-if="confirmingDelete === endpoint.id"
              class="px-gutter pb-3.5 -mt-1"
              :data-testid="`confirm-delete-${endpoint.id}`"
            >
              <div class="p-3 rounded-input border border-danger bg-danger-soft">
                <p class="text-meta text-danger">
                  Delete this endpoint? Its delivery history goes with it, and we
                  stop sending. The secret cannot be recovered, so a new endpoint
                  means re-pointing your server at a new one.
                </p>
                <div class="flex gap-2 mt-2.5">
                  <button
                    type="button"
                    class="h-control-xs px-2.5 rounded-input bg-danger text-white text-meta font-medium"
                    :data-testid="`confirm-delete-yes-${endpoint.id}`"
                    @click="remove(endpoint.id)"
                  >
                    Delete it
                  </button>
                  <button
                    type="button"
                    class="h-control-xs px-2.5 rounded-input text-meta text-muted hover:bg-surface-sunken"
                    @click="confirmingDelete = null"
                  >
                    Keep it
                  </button>
                </div>
              </div>
            </div>

            <!--
              The history. Readable even when the deployment cannot deliver - the
              queue being off does not make the past untrue, and that is exactly
              when somebody is looking for why nothing arrived.
            -->
            <div
              v-if="store.openDeliveriesFor === endpoint.id"
              class="px-gutter pb-4"
              :data-testid="`deliveries-panel-${endpoint.id}`"
            >
              <table v-if="store.deliveries.length" class="w-full">
                <thead>
                  <tr class="border-b border-line-soft">
                    <th class="col-label text-left py-2">Event</th>
                    <th class="col-label text-left py-2 w-[92px]">Attempt</th>
                    <th class="col-label text-left py-2 w-[112px]">Result</th>
                    <th class="col-label text-left py-2 w-[180px]">When</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="delivery in store.deliveries"
                    :key="delivery.id"
                    class="border-b border-line-soft"
                    :data-testid="`delivery-${delivery.id}`"
                  >
                    <td class="py-2">
                      <div class="text-meta">{{ delivery.eventType }}</div>
                      <div class="text-mono text-faint truncate">{{ delivery.eventId }}</div>
                    </td>
                    <td class="py-2 num text-meta">{{ delivery.attempt }}</td>
                    <td class="py-2 text-meta">
                      <span :class="delivery.succeeded ? 'text-published' : 'text-danger'">
                        {{ delivery.status ?? 'no reply' }}
                      </span>
                      <div v-if="delivery.error" class="text-meta text-faint truncate">
                        {{ delivery.error }}
                      </div>
                    </td>
                    <td class="py-2 text-meta text-muted">
                      {{ relativeTime(delivery.createdAt) }}
                      <span v-if="delivery.durationMs !== null" class="num text-faint">
                        · {{ delivery.durationMs }}ms
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p v-else class="py-3 text-meta text-muted" :data-testid="`no-deliveries-${endpoint.id}`">
                Nothing sent to this endpoint yet.
              </p>
              <p class="mt-2 text-meta text-faint">
                We keep what happened, not what was sent: the body of a response
                event contains the answers somebody typed into your form, and a
                log holding those would outlive the form itself.
              </p>
            </div>
          </li>
        </ul>

        <p
          v-if="!store.endpoints.length && !store.loading"
          class="px-gutter py-6 text-body text-muted"
          data-testid="webhooks-empty"
        >
          No endpoints yet. Add one and every new response is posted to it.
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
import { useWebhooksStore } from '@/stores/webhooks.store'
import { usePlanStore } from '@/stores/plan.store'
import { useOrganizationStore } from '@/stores/organization.store'
import { ApiError } from '@/services/api'
import { relativeTime, calendarDate } from '@/utils/formatDate'

/**
 * The webhooks tab on Settings
 * ([`features/0022`](../../../../features/0022-webhooks-screen.md)).
 *
 * Three separate things can make this unavailable and the screen keeps them
 * apart, because they lead to three different places: the **deployment** cannot
 * deliver (a server setting), the **plan** does not include it (a purchase), or
 * the **person** is not an owner or admin (ask someone). Only the last one hides
 * the list — the other two still show what is configured, because seeing it is
 * how somebody works out why nothing is arriving.
 */
const store = useWebhooksStore()
const planStore = usePlanStore()
const organizationStore = useOrganizationStore()

/** The `402` from creating an endpoint; drives the LimitReached dialog. */
const apiLimitReached = ref<string | null>(null)
const url = ref('')
const copied = ref(false)
const secretInput = ref<HTMLInputElement | null>(null)
const confirmingDelete = ref<string | null>(null)

const isOwner = computed(() => organizationStore.currentRole === 'owner')

/** Matches `requireRole(req, ['owner', 'admin'])` on every one of these routes. */
const canManage = computed(
  () => organizationStore.currentRole === 'owner' || organizationStore.currentRole === 'admin'
)

/** All three have to be true, and each absence has its own explanation above. */
const canCreate = computed(
  () => canManage.value && store.deliverable && planStore.plan?.hasApiAccess === true
)

/**
 * Load as soon as the caller is known to be allowed to read.
 *
 * Deliberately **not** gated on the plan, unlike the API keys tab: an
 * organization that has downgraded may still have endpoints configured, and
 * `DELETE` keeps working without the plan precisely so they can be turned off.
 * Hiding them would leave live endpoints nobody can see.
 */
watch(
  () => canManage.value,
  allowed => {
    if (allowed && !store.endpoints.length) store.load()
  },
  { immediate: true }
)

async function submit() {
  apiLimitReached.value = null

  try {
    await store.create(url.value)
    url.value = ''
    copied.value = false
  } catch (error) {
    // On the status, never the message. `402` is the plan and gets the limit
    // dialog; `503` and `400` are the error banner, and they say different
    // things — one is the installation, the other is the URL just typed.
    if (error instanceof ApiError && error.status === 402) {
      apiLimitReached.value = error.message
      planStore.refresh()
      return
    }
    // The store holds the message; the template renders it.
  }
}

function toggleDeliveries(id: string) {
  if (store.openDeliveriesFor === id) {
    store.closeDeliveries()
    return
  }
  store.openDeliveries(id)
}

async function remove(id: string) {
  confirmingDelete.value = null
  await store.remove(id)
}

function selectSecret() {
  secretInput.value?.select()
}

async function copySecret() {
  const secret = store.lastCreatedEndpoint?.secret
  if (!secret) return

  try {
    await navigator.clipboard.writeText(secret)
    copied.value = true
  } catch {
    // Refused permissions or an insecure context. Selecting the text leaves the
    // customer able to copy it by hand, which matters more here than anywhere:
    // this value does not come back.
    selectSecret()
  }
}
</script>
