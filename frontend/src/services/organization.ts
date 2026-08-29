import { api } from './api'

export type MembershipRole = 'owner' | 'admin' | 'member'

export interface Member {
  id: string
  email: string
  name: string | null
  role: MembershipRole
  joinedAt: string
}

export interface PendingInvitation {
  id: string
  email: string
  role: MembershipRole
  expiresAt: string
  createdAt: string
}

/**
 * A newly created invitation.
 *
 * `link` is returned exactly once, when the invitation is created, and the
 * server cannot recover it afterwards — there is no email service, so the
 * inviter has to copy it and send it themselves. A UI that loses this value has
 * created an invitation nobody will ever be told about.
 */
export interface CreatedInvitation extends PendingInvitation {
  link: string
}

interface AcceptResponse {
  organizationId: string
  token?: string
  user?: { id: string; email: string; name: string | null; createdAt: string }
}

export const organizationService = {
  async members(): Promise<Member[]> {
    const { members } = await api.get<{ members: Member[] }>('/organizations/members')
    return members
  },

  async changeRole(userId: string, role: MembershipRole): Promise<void> {
    await api.patch(`/organizations/members/${userId}`, { role })
  },

  async removeMember(userId: string): Promise<void> {
    await api.delete(`/organizations/members/${userId}`)
  },

  async pendingInvitations(): Promise<PendingInvitation[]> {
    const { invitations } = await api.get<{ invitations: PendingInvitation[] }>(
      '/organizations/invitations'
    )
    return invitations
  },

  async invite(email: string, role: MembershipRole): Promise<CreatedInvitation> {
    const { invitation } = await api.post<{ invitation: CreatedInvitation }>(
      '/organizations/invitations',
      { email, role }
    )
    return invitation
  },

  async revokeInvitation(id: string): Promise<void> {
    await api.delete(`/organizations/invitations/${id}`)
  },

  /** Unauthenticated when the invited person has no account yet. */
  async acceptInvitation(token: string, password?: string, name?: string): Promise<AcceptResponse> {
    return api.post<AcceptResponse>('/organizations/invitations/accept', { token, password, name })
  }
}
