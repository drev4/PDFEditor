<template>
  <div class="members-view">
    <header class="members-header">
      <div>
        <h1>Team</h1>
        <p class="subtitle">People who can see and edit this organization's forms.</p>
      </div>
      <router-link to="/dashboard" class="link-back" data-testid="members-back">
        Back to dashboard
      </router-link>
    </header>

    <p v-if="store.error" class="error" role="alert" data-testid="members-error">
      {{ store.error }}
    </p>

    <!--
      The link is shown once and cannot be recovered: the server stores only a
      hash and there is no email service to send it. If the user closes this
      without copying, the invitation exists and nobody can accept it — so it is
      the loudest thing on the page while it is here.
    -->
    <section
      v-if="store.lastCreatedInvitation"
      class="invitation-created"
      data-testid="invitation-link-panel"
    >
      <h2>Send this link to {{ store.lastCreatedInvitation.email }}</h2>
      <p class="warning">
        This is the only time this link is shown. We cannot email it for them — copy it now
        and send it yourself.
      </p>
      <div class="link-row">
        <input
          ref="linkInput"
          class="link-input"
          type="text"
          readonly
          data-testid="invitation-link"
          :value="store.lastCreatedInvitation.link"
          @focus="selectLink"
        />
        <button type="button" data-testid="copy-invitation-link" @click="copyLink">
          {{ copied ? 'Copied' : 'Copy' }}
        </button>
      </div>
      <button type="button" class="dismiss" data-testid="dismiss-invitation" @click="store.dismissCreatedInvitation()">
        Done
      </button>
    </section>

    <section v-if="store.canInvite" class="invite-form">
      <h2>Invite someone</h2>
      <form data-testid="invite-form" @submit.prevent="submitInvite">
        <input
          v-model="inviteEmail"
          type="email"
          required
          placeholder="name@example.com"
          data-testid="invite-email"
        />
        <select v-model="inviteRole" data-testid="invite-role">
          <option value="member">Member — can manage forms</option>
          <option value="admin">Admin — can also invite members</option>
          <option v-if="store.canManageMembers" value="owner">Owner — full control</option>
        </select>
        <button type="submit" :disabled="store.loading" data-testid="invite-submit">
          Create invitation
        </button>
      </form>
    </section>

    <section class="members-list">
      <h2>Members</h2>
      <table data-testid="members-table">
        <thead>
          <tr><th>Person</th><th>Role</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="member in store.members" :key="member.id" :data-testid="`member-${member.id}`">
            <td>
              <span class="name">{{ member.name || member.email }}</span>
              <span class="email">{{ member.email }}</span>
            </td>
            <td>
              <select
                v-if="store.canManageMembers"
                :value="member.role"
                :data-testid="`role-${member.id}`"
                @change="onRoleChange(member.id, $event)"
              >
                <option value="owner">Owner</option>
                <option value="admin">Admin</option>
                <option value="member">Member</option>
              </select>
              <span v-else>{{ member.role }}</span>
            </td>
            <td>
              <button
                v-if="store.canManageMembers"
                type="button"
                :data-testid="`remove-${member.id}`"
                @click="store.removeMember(member.id)"
              >
                Remove
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </section>

    <section v-if="store.canInvite && store.invitations.length" class="pending">
      <h2>Pending invitations</h2>
      <ul>
        <li v-for="invitation in store.invitations" :key="invitation.id">
          <span>{{ invitation.email }} — {{ invitation.role }}</span>
          <button
            type="button"
            :data-testid="`revoke-${invitation.id}`"
            @click="store.revokeInvitation(invitation.id)"
          >
            Revoke
          </button>
        </li>
      </ul>
    </section>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useOrganizationStore } from '@/stores/organization.store'
import type { MembershipRole } from '@/services/organization'

const store = useOrganizationStore()
const inviteEmail = ref('')
const inviteRole = ref<MembershipRole>('member')
const copied = ref(false)
const linkInput = ref<HTMLInputElement | null>(null)

onMounted(() => store.load())

async function submitInvite() {
  try {
    await store.invite(inviteEmail.value, inviteRole.value)
    inviteEmail.value = ''
    copied.value = false
  } catch {
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

<style scoped>
.members-view { max-width: 900px; margin: 0 auto; padding: 2rem 1rem; }
.members-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
.subtitle { color: #6b7280; margin-top: 0.25rem; }
.error { color: #b91c1c; background: #fef2f2; padding: 0.75rem 1rem; border-radius: 6px; }
.invitation-created { border: 2px solid #2563eb; background: #eff6ff; padding: 1rem; border-radius: 8px; margin: 1.5rem 0; }
.invitation-created .warning { color: #1e40af; font-weight: 600; }
.link-row { display: flex; gap: 0.5rem; margin: 0.75rem 0; }
.link-input { flex: 1; font-family: monospace; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 4px; }
.dismiss { background: transparent; border: none; color: #1e40af; text-decoration: underline; cursor: pointer; padding: 0; }
.invite-form form { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.invite-form input { flex: 1; min-width: 220px; padding: 0.5rem; border: 1px solid #cbd5e1; border-radius: 4px; }
table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; }
th, td { text-align: left; padding: 0.6rem 0.5rem; border-bottom: 1px solid #e5e7eb; }
.name { display: block; font-weight: 600; }
.email { display: block; color: #6b7280; font-size: 0.875rem; }
.pending ul { list-style: none; padding: 0; }
.pending li { display: flex; justify-content: space-between; align-items: center; padding: 0.5rem 0; border-bottom: 1px solid #e5e7eb; }
button { padding: 0.5rem 0.9rem; border: 1px solid #cbd5e1; border-radius: 4px; background: white; cursor: pointer; }
</style>
