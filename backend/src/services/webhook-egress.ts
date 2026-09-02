import dns from 'dns/promises'
import https from 'https'
import net from 'net'
import { AppError } from '../middleware/errorHandler.js'

/**
 * The one place this product makes an HTTP request to an address a **customer**
 * chose (features/0020).
 *
 * The same rule `services/pdf-storage.ts` follows for PDF bytes and
 * `services/pattern-validator.ts` for author-supplied regex
 * (docs/sot/04-backend-patterns.md §8), and it exists for a sharper reason than
 * either: before this feature there was no outbound HTTP anywhere in
 * `backend/src` — no `fetch(`, no axios, no `http.request` — and the only egress
 * was the Stripe SDK, to an address this repository picked. A webhook inverts
 * that. **Nothing outside this file may request a customer-supplied URL.**
 *
 * ## What a naive `fetch(endpoint.url)` gives away
 *
 * The request is made from inside the deployment's own network, so without the
 * checks below a customer can point the product at:
 *
 *   - `http://169.254.169.254/latest/meta-data/`, the cloud metadata service,
 *     which on many providers hands out credentials to anything that asks;
 *   - `http://localhost:3000/api/…`, this very API, from behind whatever proxy,
 *     WAF or rate limiter sits in front of it;
 *   - `10.0.0.0/8` and the rest of the private space, where the database lives,
 *     using delivery latency and error text as a port scanner.
 *
 * ## The four rules, and why each one is load-bearing
 *
 * 1. **`https` only.** A signed payload is not a private one: the signature
 *    proves who sent it, and does nothing to stop a respondent's answers being
 *    read off the wire.
 * 2. **Resolve, then check every address.** Checking the hostname string is not
 *    a check at all — `webhook.customer.com` can resolve to `127.0.0.1`.
 * 3. **Connect to the address that was checked.** This is the subtle one. Two
 *    independent resolutions - one to validate, one by the HTTP client - are a
 *    DNS-rebinding hole: the second can answer differently, deliberately. The
 *    validated addresses are therefore pinned into the connection through
 *    `https.request`'s own `lookup` option, so the socket cannot go anywhere
 *    else.
 * 4. **No redirects.** A `302` to `http://169.254.169.254/` undoes rules 1–3 in
 *    one hop. `https.request` does not follow redirects on its own, which is
 *    exactly why it is used here rather than `fetch`; a 3xx is reported to the
 *    caller as the delivery result it is.
 *
 * Plus two bounds, because a customer's endpoint is not a trusted peer: a total
 * timeout, and a cap on how much of its response is read. An endpoint that
 * accepts the connection and then says nothing must not hold a worker slot for
 * ever - the failure mode features/0017 met with its Redis client, in a new
 * place.
 */

/** The whole delivery, connect included. Deliberately short: this is a signal, not a conversation. */
export const WEBHOOK_TIMEOUT_MS = 10_000

/** How much of a customer's response is read before the socket is destroyed. */
export const MAX_RESPONSE_BYTES = 4 * 1024

/**
 * Address ranges a webhook may never reach.
 *
 * Written out rather than pulled from a library so that every entry can carry
 * the reason it is here, and so that adding one is a code review rather than a
 * dependency bump.
 */
export function isBlockedAddress(address: string): boolean {
  // `::ffff:127.0.0.1` is a v4 address wearing a v6 hat, and it connects to
  // exactly what the v4 form does.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)
  if (mapped) return isBlockedAddress(mapped[1] as string)

  const version = net.isIP(address)
  if (version === 4) return isBlockedV4(address)
  if (version === 6) return isBlockedV6(address)

  // Not an address at all. Refusing is the safe direction: everything that
  // reaches here has already been through `dns.lookup`.
  return true
}

function isBlockedV4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true
  }

  const [a, b] = parts as [number, number, number, number]

  if (a === 0) return true                          // "this host on this network"
  if (a === 10) return true                         // private
  if (a === 127) return true                        // loopback, the whole /8
  if (a === 169 && b === 254) return true           // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true  // private
  if (a === 192 && b === 168) return true           // private
  if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
  if (a === 192 && b === 0) return true             // IETF protocol assignments
  if (a >= 224) return true                         // multicast and reserved

  return false
}

function isBlockedV6(address: string): boolean {
  const value = address.toLowerCase().split('%')[0] as string

  if (value === '::' || value === '::1') return true      // unspecified, loopback
  if (value.startsWith('fe8') || value.startsWith('fe9')) return true
  if (value.startsWith('fea') || value.startsWith('feb')) return true // link-local fe80::/10
  if (value.startsWith('fc') || value.startsWith('fd')) return true   // unique local fc00::/7
  if (value.startsWith('ff')) return true                             // multicast

  return false
}

export interface DeliverableUrl {
  url: URL
  /** Every address the hostname resolved to, all of them already checked. */
  addresses: { address: string; family: number }[]
}

/**
 * Validates a customer-supplied URL, resolving it in the process.
 *
 * Called at **configuration time**, so a bad endpoint is refused with a message
 * while somebody is looking at a screen — and again at delivery time, because a
 * name that was public when it was saved can point somewhere else tomorrow.
 */
export async function assertDeliverableUrl(raw: string): Promise<DeliverableUrl> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new AppError(400, 'That is not a valid URL')
  }

  if (url.protocol !== 'https:') {
    throw new AppError(400, 'A webhook URL must use https')
  }

  if (url.username || url.password) {
    // They would end up in the delivery log and in any error text, and they are
    // never how a webhook authenticates - the signature is.
    throw new AppError(400, 'A webhook URL must not contain credentials')
  }

  let resolved: { address: string; family: number }[]
  try {
    resolved = await dns.lookup(url.hostname, { all: true })
  } catch {
    throw new AppError(400, `Could not resolve ${url.hostname}`)
  }

  if (resolved.length === 0) {
    throw new AppError(400, `Could not resolve ${url.hostname}`)
  }

  // **Every** address, not the first: a hostname that answers with one public
  // and one private address must be refused, or the choice of which to connect
  // to belongs to whoever controls the DNS.
  const blocked = resolved.filter(entry => isBlockedAddress(entry.address))
  if (blocked.length > 0) {
    throw new AppError(
      400,
      `${url.hostname} resolves to an internal address (${blocked[0]!.address}), which is not reachable from here`
    )
  }

  return { url, addresses: resolved }
}

export interface DeliveryResult {
  ok: boolean
  status: number | null
  durationMs: number
  /** Short, and safe to store: never a payload, never a credential. */
  error: string | null
}

/**
 * Sends one signed payload, once.
 *
 * No retries here on purpose - retrying is the queue's job
 * (`services/webhook-queue.ts`), which is what gives it backoff, persistence and
 * a limit. This function's contract is "one attempt, bounded, and it always
 * resolves": a network failure is a `DeliveryResult` with `ok: false`, not a
 * throw, because a customer's broken endpoint is an expected condition rather
 * than an exception.
 *
 * **2xx is success and everything else is not**, including a 3xx: redirects are
 * not followed (see the module comment), so a customer answering `302` is
 * telling us to go somewhere we have not checked.
 */
export async function deliver(options: {
  target: DeliverableUrl
  body: string
  headers: Record<string, string>
}): Promise<DeliveryResult> {
  const { target, body, headers } = options
  const started = Date.now()

  return new Promise<DeliveryResult>(resolve => {
    let settled = false
    const finish = (result: Omit<DeliveryResult, 'durationMs'>) => {
      if (settled) return
      settled = true
      resolve({ ...result, durationMs: Date.now() - started })
    }

    const request = https.request(
      {
        protocol: target.url.protocol,
        hostname: target.url.hostname,
        port: target.url.port || 443,
        path: `${target.url.pathname}${target.url.search}`,
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'VuePDF-Webhooks/1'
        },
        timeout: WEBHOOK_TIMEOUT_MS,
        // Rule 3: the socket resolves through the addresses that were already
        // checked, so no second DNS answer can redirect it. This is the whole
        // defence against DNS rebinding, and it is one option.
        lookup: (_hostname, opts, callback) => {
          const all = target.addresses
          if (typeof opts === 'function') return (opts as Function)(null, all[0]!.address, all[0]!.family)
          if (opts && (opts as { all?: boolean }).all) {
            return callback(null, all as never)
          }
          return callback(null, all[0]!.address as never, all[0]!.family as never)
        }
      },
      response => {
        let read = 0
        response.on('data', (chunk: Buffer) => {
          read += chunk.length
          // The body is not wanted at all; this only stops a customer streaming
          // gigabytes at a worker.
          if (read > MAX_RESPONSE_BYTES) response.destroy()
        })
        response.on('end', () => {
          const status = response.statusCode ?? 0
          finish({
            ok: status >= 200 && status < 300,
            status,
            error: status >= 200 && status < 300 ? null : `Endpoint answered ${status}`
          })
        })
        response.on('error', error => {
          finish({ ok: false, status: response.statusCode ?? null, error: shortError(error) })
        })
      }
    )

    request.on('timeout', () => {
      request.destroy()
      finish({ ok: false, status: null, error: `No answer within ${WEBHOOK_TIMEOUT_MS}ms` })
    })

    request.on('error', error => {
      finish({ ok: false, status: null, error: shortError(error) })
    })

    request.end(body)
  })
}

/** Errors are stored and shown to a customer, so they stay short and boring. */
function shortError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 200)
}
