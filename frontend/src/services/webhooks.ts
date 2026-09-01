import { api } from './api'

/**
 * Webhook endpoints, as the management screen sees them
 * ([`features/0020`](../../../features/0020-outbound-webhooks.md) built them,
 * [`features/0022`](../../../features/0022-webhooks-screen.md) made them
 * reachable).
 *
 * All of this is the session API. Configuring a place for customer data to be
 * sent is something a person does while signed in — an API key that could add
 * one would turn a leaked credential into an exfiltration channel.
 */

/** One configured endpoint. **Never carries the secret**, encrypted or not. */
export interface WebhookEndpoint {
  id: string
  url: string
  events: string[]
  /**
   * When delivery was switched off, or `null` while it works.
   *
   * The queue disables an endpoint after ten consecutive failures. It is not
   * permanent — `reenable` clears it — but nothing clears it on its own, and a
   * disabled endpoint receives nothing meanwhile.
   */
  disabledAt: string | null
  /** The last delivery error, kept so the screen can say *why* it stopped. */
  lastError: string | null
  /**
   * Failures **since the last success**, not failures ever: the queue resets it
   * to zero on any successful delivery. Reading it as a lifetime total is wrong
   * and the screen must not label it that way.
   */
  consecutiveFailures: number
  createdAt: string
}

/**
 * A newly created endpoint, with the one and only copy of its signing secret.
 *
 * Unlike an API key's, this secret is **encrypted rather than hashed** server
 * side, because it has to be used to sign. That does not make it recoverable
 * here: nothing returns it a second time, deliberately, and there is no rotation
 * yet either (filed in `docs/BACKLOG.md`), so losing it means deleting the
 * endpoint and re-pointing the receiver at a new one.
 */
export interface CreatedWebhookEndpoint extends WebhookEndpoint {
  secret: string
}

/**
 * One delivery attempt.
 *
 * **There is no payload here and there never will be.** `webhook_deliveries`
 * stores no request body, because `response.created` carries the answers a
 * member of the public typed into a form, and a log holding them would be a
 * second copy of respondent personal data outliving the form it came from.
 */
export interface WebhookDelivery {
  id: string
  eventId: string
  eventType: string
  /** Which retry this was; the queue makes several with exponential backoff. */
  attempt: number
  /** The HTTP status the customer's server answered, or `null` if it never did. */
  status: number | null
  durationMs: number | null
  succeeded: boolean
  error: string | null
  createdAt: string
}

export interface WebhookList {
  webhooks: WebhookEndpoint[]
  /**
   * Whether this **deployment** can deliver at all — it needs a job queue and a
   * signing key.
   *
   * Nothing the customer can fix, and not the same as the plan refusing: one is
   * a bug report and the other is a purchase. The list is returned either way,
   * on purpose, because seeing what is configured is how somebody diagnoses why
   * nothing is arriving.
   */
  deliverable: boolean
}

export const webhookService = {
  async list(): Promise<WebhookList> {
    return api.get<WebhookList>('/organizations/webhooks')
  },

  async create(url: string): Promise<CreatedWebhookEndpoint> {
    const { webhook } = await api.post<{ webhook: CreatedWebhookEndpoint }>(
      '/organizations/webhooks',
      { url }
    )
    return webhook
  },

  /**
   * Switches a disabled endpoint back on, keeping its id and its secret.
   *
   * Sends no body: this is not a general update, and the server ignores one.
   * Re-pointing an endpoint at a different URL under the same secret is a
   * different feature.
   */
  async reenable(id: string): Promise<WebhookEndpoint> {
    const { webhook } = await api.patch<{ webhook: WebhookEndpoint }>(
      `/organizations/webhooks/${id}`,
      {}
    )
    return webhook
  },

  /** Deletes the endpoint **and its delivery history**, which cascades. */
  async remove(id: string): Promise<void> {
    await api.delete(`/organizations/webhooks/${id}`)
  },

  async deliveries(id: string): Promise<WebhookDelivery[]> {
    const { deliveries } = await api.get<{ deliveries: WebhookDelivery[] }>(
      `/organizations/webhooks/${id}/deliveries`
    )
    return deliveries
  }
}
