import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import {
  organizationService,
  type Member,
  type PendingInvitation,
  type CreatedInvitation,
  type MembershipRole,
  type OrganizationSummary
} from '../services/organization'
import { useAuthStore } from './auth.store'
import { useAsyncAction } from '../composables/useAsyncAction'

export const useOrganizationStore = defineStore('organization', () => {
  const members = ref<Member[]>([])
  const invitations = ref<PendingInvitation[]>([])

  /**
   * The organizations this account belongs to, and the one it is acting in
   * (features/0023).
   *
   * Here rather than in a store of its own: this store already owns members and
   * the caller's role, and a second store for the same resource would be a
   * second answer to "which organization am I in".
   */
  const organizations = ref<OrganizationSummary[]>([])
  const activeOrganizationId = ref<string | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  /**
   * The link for the invitation just created, held until the user dismisses it.
   *
   * This is the only copy. The server hashes the token and cannot reproduce it,
   * and nothing emails it — so losing this value means the invitation exists
   * and nobody can ever accept it. It is deliberately kept in the store rather
   * than in a component that might unmount.
   */
  const lastCreatedInvitation = ref<CreatedInvitation | null>(null)

  /** The signed-in user's own role, derived rather than fetched separately. */
  const currentRole = computed<MembershipRole | null>(() => {
    const authStore = useAuthStore()
    const me = members.value.find(m => m.id === authStore.user?.id)
    return me?.role ?? null
  })

  const canInvite = computed(() => currentRole.value === 'owner' || currentRole.value === 'admin')
  const canManageMembers = computed(() => currentRole.value === 'owner')

  async function load() {
    return useAsyncAction(
      { loading, error },
      async () => {
        members.value = await organizationService.members()
        // Only owners and admins may list invitations; a plain member seeing
        // an empty list is correct, not an error worth showing them.
        try {
          invitations.value = await organizationService.pendingInvitations()
        } catch {
          invitations.value = []
        }
      },
      { fallbackMessage: 'Could not load the organization' }
    )
  }

  /** Loads the organization list. Cheap, and every signed-in screen wants it. */
  async function loadOrganizations() {
    return useAsyncAction(
      { loading, error },
      async () => {
        const result = await organizationService.list()
        organizations.value = result.organizations
        activeOrganizationId.value = result.activeOrganizationId
      },
      { fallbackMessage: 'Could not load your organizations', skipLoading: true }
    )
  }

  /**
   * Switches organization.
   *
   * Everything on screen afterwards belongs to a different tenant, so the caller
   * is expected to reload what it shows rather than leave stale numbers under a
   * new name. This store clears its own members list for exactly that reason.
   */
  async function setActiveOrganization(organizationId: string) {
    return useAsyncAction(
      { loading, error },
      async () => {
        await organizationService.setActive(organizationId)
        activeOrganizationId.value = organizationId
        members.value = []
        invitations.value = []
        await load()
      },
      { fallbackMessage: 'Could not switch organization' }
    )
  }

  async function invite(email: string, role: MembershipRole) {
    return useAsyncAction(
      { loading, error },
      async () => {
        const created = await organizationService.invite(email, role)
        lastCreatedInvitation.value = created
        invitations.value = [created, ...invitations.value]
        return created
      },
      { fallbackMessage: 'Could not create the invitation' }
    )
  }

  async function revokeInvitation(id: string) {
    return useAsyncAction(
      { loading, error },
      async () => {
        await organizationService.revokeInvitation(id)
        invitations.value = invitations.value.filter(i => i.id !== id)
        if (lastCreatedInvitation.value?.id === id) lastCreatedInvitation.value = null
      },
      { fallbackMessage: 'Could not revoke the invitation' }
    )
  }

  async function changeRole(userId: string, role: MembershipRole) {
    return useAsyncAction(
      { loading, error },
      async () => {
        await organizationService.changeRole(userId, role)
        members.value = members.value.map(m => (m.id === userId ? { ...m, role } : m))
      },
      { fallbackMessage: 'Could not change the role' }
    )
  }

  async function removeMember(userId: string) {
    return useAsyncAction(
      { loading, error },
      async () => {
        await organizationService.removeMember(userId)
        members.value = members.value.filter(m => m.id !== userId)
      },
      { fallbackMessage: 'Could not remove the member' }
    )
  }

  function dismissCreatedInvitation() {
    lastCreatedInvitation.value = null
  }

  const activeOrganization = computed(
    () => organizations.value.find(o => o.id === activeOrganizationId.value) ?? null
  )

  /** A switcher with one entry is furniture, so the shell asks before drawing. */
  const hasMultipleOrganizations = computed(() => organizations.value.length > 1)

  return {
    members,
    invitations,
    organizations,
    activeOrganizationId,
    activeOrganization,
    hasMultipleOrganizations,
    loading,
    error,
    lastCreatedInvitation,
    currentRole,
    canInvite,
    canManageMembers,
    load,
    loadOrganizations,
    setActiveOrganization,
    invite,
    revokeInvitation,
    changeRole,
    removeMember,
    dismissCreatedInvitation
  }
})
