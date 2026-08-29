import { nanoid } from 'nanoid'

/**
 * A URL-safe slug for a new organization.
 *
 * The readable part is a courtesy — it is derived from whatever the user gave
 * us and may be empty, duplicated or entirely non-Latin. Uniqueness comes from
 * the `nanoid` suffix alone, never from the name, so this needs no collision
 * loop and no retry: two organizations called "Acme" get two different slugs
 * without either signup having to wait for the other.
 *
 * `slug` is `@unique` in the schema, so a collision would surface as a failed
 * insert rather than as two organizations sharing a URL.
 */
export function organizationSlug(nameOrEmail: string): string {
  const readable = nameOrEmail
    .toLowerCase()
    .split('@')[0]
    .normalize('NFD')
    // Strip combining accents so "José" becomes "jose" rather than "jos".
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)

  return readable ? `${readable}-${nanoid(8)}` : `org-${nanoid(12)}`
}

/** The display name for a personal organization. */
export function personalOrganizationName(name: string | null | undefined, email: string): string {
  const trimmed = name?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : email.split('@')[0]
}
