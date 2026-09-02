import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useOrganizationStore } from './organization.store'
import { useAuthStore } from './auth.store'
import { organizationService } from '../services/organization'

vi.mock('../services/organization')

const members = [
  { id: 'u1', email: 'owner@example.com', name: 'Owner', role: 'owner' as const, joinedAt: '2026-01-01' },
  { id: 'u2', email: 'member@example.com', name: null, role: 'member' as const, joinedAt: '2026-01-02' }
]

describe('Organization Store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.mocked(organizationService.members).mockResolvedValue(members)
    vi.mocked(organizationService.pendingInvitations).mockResolvedValue([])
  })

  function signInAs(id: string) {
    const auth = useAuthStore()
    auth.user = { id, email: 'x@example.com', name: null, createdAt: '2026-01-01' }
  }

  describe('permissions derived from the caller role', () => {
    it('lets an owner invite and manage members', async () => {
      signInAs('u1')
      const store = useOrganizationStore()

      await store.load()

      expect(store.currentRole).toBe('owner')
      expect(store.canInvite).toBe(true)
      expect(store.canManageMembers).toBe(true)
    })

    it('lets a plain member do neither', async () => {
      signInAs('u2')
      const store = useOrganizationStore()

      await store.load()

      expect(store.currentRole).toBe('member')
      expect(store.canInvite).toBe(false)
      expect(store.canManageMembers).toBe(false)
    })

    it('does not treat a missing role as permission', async () => {
      signInAs('someone-not-in-this-list')
      const store = useOrganizationStore()

      await store.load()

      expect(store.currentRole).toBeNull()
      expect(store.canInvite).toBe(false)
      expect(store.canManageMembers).toBe(false)
    })
  })

  describe('a plain member loading the page', () => {
    it('shows an empty invitation list rather than an error', async () => {
      signInAs('u2')
      vi.mocked(organizationService.pendingInvitations).mockRejectedValue(new Error('403'))
      const store = useOrganizationStore()

      await store.load()

      // Listing invitations is owner/admin only. A member being refused is the
      // expected server behaviour, not something to put in front of them.
      expect(store.invitations).toEqual([])
      expect(store.error).toBeNull()
      expect(store.members).toHaveLength(2)
    })
  })

  describe('the created invitation link', () => {
    it('is kept after creating, because it is the only copy', async () => {
      signInAs('u1')
      const created = {
        id: 'inv1',
        email: 'new@example.com',
        role: 'member' as const,
        expiresAt: '2026-02-01',
        createdAt: '2026-01-10',
        link: 'http://localhost:5173/invitations/the-token'
      }
      vi.mocked(organizationService.invite).mockResolvedValue(created)
      const store = useOrganizationStore()
      await store.load()

      await store.invite('new@example.com', 'member')

      // The server hashes the token and nothing emails it, so if this is lost
      // the invitation exists and nobody can ever accept it.
      expect(store.lastCreatedInvitation).toEqual(created)
      expect(store.invitations[0]).toEqual(created)
    })

    it('is cleared when the invitation it belongs to is revoked', async () => {
      signInAs('u1')
      const created = {
        id: 'inv1',
        email: 'new@example.com',
        role: 'member' as const,
        expiresAt: '2026-02-01',
        createdAt: '2026-01-10',
        link: 'http://localhost:5173/invitations/the-token'
      }
      vi.mocked(organizationService.invite).mockResolvedValue(created)
      vi.mocked(organizationService.revokeInvitation).mockResolvedValue(undefined)
      const store = useOrganizationStore()
      await store.load()
      await store.invite('new@example.com', 'member')

      await store.revokeInvitation('inv1')

      // Leaving a dead link on screen invites someone to send it.
      expect(store.lastCreatedInvitation).toBeNull()
      expect(store.invitations).toHaveLength(0)
    })
  })

  describe('member management', () => {
    it('reflects a role change locally', async () => {
      signInAs('u1')
      vi.mocked(organizationService.changeRole).mockResolvedValue(undefined)
      const store = useOrganizationStore()
      await store.load()

      await store.changeRole('u2', 'admin')

      expect(store.members.find(m => m.id === 'u2')!.role).toBe('admin')
    })

    it('removes a member locally', async () => {
      signInAs('u1')
      vi.mocked(organizationService.removeMember).mockResolvedValue(undefined)
      const store = useOrganizationStore()
      await store.load()

      await store.removeMember('u2')

      expect(store.members.map(m => m.id)).toEqual(['u1'])
    })

    it('surfaces a refusal instead of pretending it worked', async () => {
      signInAs('u1')
      vi.mocked(organizationService.changeRole).mockRejectedValue(
        new Error('This is the only owner. Make someone else an owner before changing this role.')
      )
      const store = useOrganizationStore()
      await store.load()

      await expect(store.changeRole('u1', 'member')).rejects.toThrow()

      expect(store.error).toMatch(/only owner/i)
      expect(store.members.find(m => m.id === 'u1')!.role).toBe('owner')
    })
  })

  /**
   * The active organization (features/0023).
   *
   * Most accounts have one organization and none of this shows. What is asserted
   * is the case that used to be ambiguous: two memberships, and a switch that
   * has to leave nothing of the previous tenant on screen.
   */
  describe('switching organization', () => {
    const organizations = [
      { id: 'org-1', name: 'Personal', slug: 'personal', role: 'owner' as const },
      { id: 'org-2', name: 'Acme', slug: 'acme', role: 'member' as const }
    ]

    beforeEach(() => {
      vi.mocked(organizationService.list).mockResolvedValue({
        organizations,
        activeOrganizationId: 'org-1'
      })
      vi.mocked(organizationService.setActive).mockResolvedValue(undefined)
    })

    it('knows which organization it is acting in', async () => {
      const store = useOrganizationStore()

      await store.loadOrganizations()

      expect(store.activeOrganizationId).toBe('org-1')
      expect(store.activeOrganization?.name).toBe('Personal')
      expect(store.hasMultipleOrganizations).toBe(true)
    })

    it('does not offer a switch to an account with one organization', async () => {
      vi.mocked(organizationService.list).mockResolvedValue({
        organizations: [organizations[0]!],
        activeOrganizationId: 'org-1'
      })
      const store = useOrganizationStore()

      await store.loadOrganizations()

      // A switcher with one entry implies a choice that does not exist.
      expect(store.hasMultipleOrganizations).toBe(false)
    })

    it('clears the previous organization members and re-reads them', async () => {
      const store = useOrganizationStore()
      await store.loadOrganizations()
      await store.load()
      expect(store.members).toHaveLength(2)

      vi.mocked(organizationService.members).mockResolvedValue([
        { id: 'u9', email: 'someone@acme.example', name: null, role: 'admin', joinedAt: '2026-02-01' }
      ])
      await store.setActiveOrganization('org-2')

      expect(organizationService.setActive).toHaveBeenCalledWith('org-2')
      expect(store.activeOrganizationId).toBe('org-2')
      // Everything on screen is now about a different tenant. Leaving the old
      // members under a new organization name is worse than a moment of loading.
      expect(store.members.map(m => m.id)).toEqual(['u9'])
    })

    it('surfaces a refused switch and does not pretend it happened', async () => {
      vi.mocked(organizationService.setActive).mockRejectedValue(
        new Error('Organization not found')
      )
      const store = useOrganizationStore()
      await store.loadOrganizations()

      await expect(store.setActiveOrganization('org-3')).rejects.toThrow()

      expect(store.activeOrganizationId).toBe('org-1')
      expect(store.error).toMatch(/not found/i)
    })
  })
})
