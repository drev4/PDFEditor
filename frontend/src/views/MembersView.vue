<template>
  <AppShell>
    <div class="members-view flex flex-col flex-grow min-h-0 overflow-y-auto">
      <header class="flex items-end gap-4 px-gutter pt-[26px]">
        <div class="flex-grow min-w-0">
          <h1 class="text-title">Members</h1>
          <p class="mt-0.5 text-body text-muted">
            Everyone with access to this organization's forms and responses.
          </p>
        </div>
        <RouterLink
          to="/dashboard"
          class="text-meta text-muted hover:text-ink transition-colors"
          data-testid="members-back"
        >
          Back to dashboard
        </RouterLink>
      </header>

      <!--
        The seat limit is deliberately absent from this banner. A 402 is the plan
        refusing, not the request breaking, so it gets the LimitReached screen
        below instead of a red alert saying something went wrong
        (features/0015) - the same treatment a publish limit gets.
      -->
      <p
        v-if="store.error && seatLimitReached === null"
        class="mx-gutter mt-5 px-4 py-3 rounded-card border border-danger bg-danger-soft text-body text-danger"
        role="alert"
        data-testid="members-error"
      >
        {{ store.error }}
      </p>

      <!--
        The link is shown once and cannot be recovered: the server stores only a
        hash and there is no email service to send it. If the user closes this
        without copying, the invitation exists and nobody can accept it — so it
        is the loudest thing on the page while it is here, and it is the one
        place the accent border is spent on something that is not an action.
      -->
      <section
        v-if="store.lastCreatedInvitation"
        class="mx-gutter mt-5 p-4 rounded-card border border-accent bg-accent-soft"
        data-testid="invitation-link-panel"
      >
        <h2 class="text-row font-semibold">
          Send this link to {{ store.lastCreatedInvitation.email }}
        </h2>
        <p class="mt-1 text-meta text-accent-pressed">
          This is the only time this link is shown. We cannot email it for them — copy it now
          and send it yourself.
        </p>
        <div class="flex gap-2 mt-3">
          <input
            ref="linkInput"
            class="num flex-1 h-control-sm px-2.5 rounded-input border border-line-strong bg-surface text-mono"
            type="text"
            readonly
            data-testid="invitation-link"
            :value="store.lastCreatedInvitation.link"
            @focus="selectLink"
          />
          <button
            type="button"
            class="h-control-sm px-3.5 rounded-control border border-line-strong bg-surface text-body font-medium hover:bg-surface-sunken transition-colors"
            data-testid="copy-invitation-link"
            @click="copyLink"
          >
            {{ copied ? 'Copied' : 'Copy' }}
          </button>
        </div>
        <button
          type="button"
          class="mt-3 text-meta text-accent-pressed underline"
          data-testid="dismiss-invitation"
          @click="store.dismissCreatedInvitation()"
        >
          Done
        </button>
      </section>

      <section v-if="store.canInvite" class="px-gutter mt-5">
        <div class="p-4 rounded-card border border-line bg-surface-subtle">
          <h2 class="col-label mb-2.5">Invite someone</h2>
          <form class="flex flex-wrap gap-2" data-testid="invite-form" @submit.prevent="submitInvite">
            <input
              v-model="inviteEmail"
              type="email"
              required
              placeholder="name@example.com"
              data-testid="invite-email"
              class="flex-1 min-w-[220px] h-control-sm px-2.5 rounded-input border border-line-strong bg-surface text-body placeholder:text-faint focus:outline-none focus:border-accent focus:shadow-focus"
            />
            <select
              v-model="inviteRole"
              data-testid="invite-role"
              class="h-control-sm px-2.5 rounded-input border border-line-strong bg-surface text-body focus:outline-none focus:border-accent focus:shadow-focus"
            >
              <option value="member">Member — can manage forms</option>
              <option value="admin">Admin — can also invite members</option>
              <option v-if="store.canManageMembers" value="owner">Owner — full control</option>
            </select>
            <!-- The one accent action on this screen. -->
            <button
              type="submit"
              :disabled="store.loading"
              data-testid="invite-submit"
              class="h-control-sm px-3.5 rounded-control bg-accent hover:bg-accent-pressed disabled:bg-surface-control disabled:text-disabled text-white text-row font-medium transition-colors"
            >
              Create invitation
            </button>
          </form>
        </div>
      </section>

      <section class="mt-6">
        <table class="w-full members-table" data-testid="members-table">
          <thead>
            <tr class="border-b border-line-soft">
              <th class="col-label text-left px-gutter py-2.5">Member</th>
              <th class="col-label text-left py-2.5 w-[168px]">Role</th>
              <th class="col-label text-left py-2.5 w-[132px]">Status</th>
              <th class="py-2.5 w-[120px] pr-gutter" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="member in store.members"
              :key="member.id"
              :data-testid="`member-${member.id}`"
              class="border-b border-line-soft hover:bg-surface-subtle transition-colors"
            >
              <td class="px-gutter py-3">
                <div class="flex items-center gap-2.5 min-w-0">
                  <div
                    class="flex items-center justify-center w-[30px] h-[30px] rounded-pill text-micro font-semibold flex-shrink-0"
                    :class="member.id === myId
                      ? 'bg-accent-soft text-accent'
                      : 'bg-surface-track text-muted'"
                  >
                    {{ initialsOf(member) }}
                  </div>
                  <div class="min-w-0">
                    <div class="text-row font-medium truncate">
                      {{ member.name || member.email }}
                      <span v-if="member.id === myId" class="font-normal text-faint">(you)</span>
                    </div>
                    <div class="text-mono text-faint truncate">{{ member.email }}</div>
                  </div>
                </div>
              </td>
              <td class="py-3">
                <select
                  v-if="store.canManageMembers"
                  :value="member.role"
                  :data-testid="`role-${member.id}`"
                  class="h-control-xs px-2.5 rounded-input border border-line-strong bg-surface text-meta focus:outline-none focus:border-accent focus:shadow-focus"
                  @change="onRoleChange(member.id, $event)"
                >
                  <option value="owner">Owner</option>
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                </select>
                <span v-else class="text-meta capitalize">{{ member.role }}</span>
              </td>
              <td class="py-3">
                <StatusPill status="active" label="Active" />
              </td>
              <td class="py-3 pr-gutter text-right">
                <button
                  v-if="store.canManageMembers"
                  type="button"
                  :data-testid="`remove-${member.id}`"
                  class="h-control-xs px-2.5 rounded-input text-meta text-muted hover:text-danger hover:bg-danger-soft transition-colors"
                  @click="store.removeMember(member.id)"
                >
                  Remove
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>

      <!-- Pending invitations stay their own table rather than joining the one
           above: the members table is a list of people who have access, and an
           invitation is a capability nobody has used yet. -->
      <section v-if="store.canInvite && store.invitations.length" class="mt-8">
        <h2 class="col-label px-gutter mb-2.5">Pending invitations</h2>
        <ul>
          <li
            v-for="invitation in store.invitations"
            :key="invitation.id"
            class="flex items-center gap-4 px-gutter py-3 border-b border-line-soft"
          >
            <div
              class="flex items-center justify-center w-[30px] h-[30px] rounded-pill border border-dashed border-line-strong text-faint flex-shrink-0"
            >
              <i class="pi pi-envelope text-[12px]" />
            </div>
            <span class="flex-grow min-w-0 text-row text-muted truncate">{{ invitation.email }}</span>
            <span class="text-meta capitalize text-muted w-[168px]">{{ invitation.role }}</span>
            <StatusPill status="invited" label="Invited" />
            <button
              type="button"
              :data-testid="`revoke-${invitation.id}`"
              class="h-control-xs px-2.5 rounded-input text-meta text-muted hover:text-danger hover:bg-danger-soft transition-colors"
              @click="store.revokeInvitation(invitation.id)"
            >
              Revoke
            </button>
          </li>
        </ul>
      </section>

      <!-- What each role can do. Straight off the artboard, and the only place
           in the product that states the role semantics to the person choosing
           one in the select above. -->
      <section class="px-gutter py-7">
        <h2 class="col-label mb-3">What each role can do</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-[900px]">
          <div
            v-for="role in roleReference"
            :key="role.name"
            class="p-4 rounded-card border border-line"
          >
            <div class="text-body font-semibold mb-1.5">{{ role.name }}</div>
            <p class="text-meta text-muted">{{ role.can }}</p>
          </div>
        </div>
      </section>
    </div>

    <LimitReachedDialog
      limit="seats"
      :visible="seatLimitReached !== null"
      :message="seatLimitReached"
      @close="seatLimitReached = null"
    />
  </AppShell>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { RouterLink } from 'vue-router'
import AppShell from '@/layouts/AppShell.vue'
import StatusPill from '@/components/ui/StatusPill.vue'
import { useAuthStore } from '@/stores/auth.store'
import { useOrganizationStore } from '@/stores/organization.store'
import { usePlanStore } from '@/stores/plan.store'
import LimitReachedDialog from '@/components/plan/LimitReachedDialog.vue'
import { ApiError } from '@/services/api'
import type { Member, MembershipRole } from '@/services/organization'

const store = useOrganizationStore()
const authStore = useAuthStore()
const planStore = usePlanStore()

/** The `402` message from inviting; drives the LimitReached dialog. */
const seatLimitReached = ref<string | null>(null)
const inviteEmail = ref('')
const inviteRole = ref<MembershipRole>('member')
const copied = ref(false)
const linkInput = ref<HTMLInputElement | null>(null)

const myId = computed(() => authStore.user?.id)

/**
 * What each role can actually do, read out of the route guards in
 * `backend/src/routes/organizations.ts` rather than off the design canvas.
 *
 * The canvas says a member sees "only the forms they created". That is the
 * target design in docs/sot/10-saas-roadmap.md and it is *not* what the code
 * enforces: `backend/src/routes/forms.ts` scopes forms to the organization and
 * checks membership, not role, so every member reaches every form. Printing the
 * canvas's wording here would be telling a customer their data is partitioned
 * when it is not. Filed in docs/BACKLOG.md.
 */
const roleReference = [
  {
    name: 'Owner',
    can: 'Everything an admin can do, plus changing roles and removing members. An organization always keeps at least one.',
  },
  {
    name: 'Admin',
    can: 'Every form and response in the organization, plus inviting members and revoking invitations.',
  },
  {
    name: 'Member',
    can: 'Every form and response in the organization. Cannot invite anyone or change who has access.',
  },
]

onMounted(() => {
  store.load()
  // The dialog renders the seats meter, and this screen is where somebody
  // discovers the limit. Loading it here means the numbers are already right
  // when the 402 arrives, rather than appearing a moment later.
  planStore.load()
})

function initialsOf(member: Member) {
  const source = member.name || member.email
  const parts = source.split(/[\s@.]+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
}

async function submitInvite() {
  seatLimitReached.value = null

  try {
    await store.invite(inviteEmail.value, inviteRole.value)
    inviteEmail.value = ''
    copied.value = false
    // Sending an invitation spends a seat, which the Members meter shows.
    planStore.refresh()
  } catch (error) {
    // Branching on the status, never on the message: `402` is the plan refusing
    // and `403` is a permission failure, and the two are distinguished by code
    // on purpose (features/0012). Nothing was lost - the address is still in the
    // field, so the invitation can be sent again once a seat exists.
    if (error instanceof ApiError && error.status === 402) {
      seatLimitReached.value = error.message
      planStore.refresh()
      return
    }
    // The store already holds the message; the template renders it.
  }
}

function selectLink() {
  linkInput.value?.select()
}

async function copyLink() {
  const link = store.lastCreatedInvitation?.link
  if (!link) return

  try {
    await navigator.clipboard.writeText(link)
    copied.value = true
  } catch {
    // Clipboard access can be refused (permissions, insecure context). Falling
    // back to selecting the text means the user can still copy it by hand,
    // which matters more here than anywhere else in the app.
    selectLink()
  }
}

function onRoleChange(userId: string, event: Event) {
  const role = (event.target as HTMLSelectElement).value as MembershipRole
  store.changeRole(userId, role)
}
</script>
