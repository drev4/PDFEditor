import { describe, it, expect } from 'vitest'
import {
  assertDeliverableUrl,
  isBlockedAddress,
  WEBHOOK_TIMEOUT_MS
} from '../src/services/webhook-egress.js'

/**
 * The guard on the first outbound request this product makes to an address a
 * **customer** chose (features/0020).
 *
 * Until this feature there was no `fetch(`, no axios and no `http.request`
 * anywhere in `backend/src` — the only egress was the Stripe SDK, to an address
 * this repository picked. A webhook inverts that, and the naive implementation
 * turns the product into a proxy inside its own network:
 *
 *   - `http://169.254.169.254/latest/meta-data/` — the cloud metadata service,
 *     which on many deployments hands out credentials;
 *   - `http://localhost:3000/api/...` — this very API, from inside, behind
 *     whatever sits in front of it;
 *   - `10.0.0.0/8` and friends — the network the database is on, with delivery
 *     latency and error text as a port scanner.
 *
 * These are unit tests on purpose: the property is "this address is refused",
 * and refusing it must not require a network round trip to find out.
 */
describe('webhook egress guard', () => {
  describe('addresses that must never be reached', () => {
    const blocked = [
      ['loopback v4', '127.0.0.1'],
      ['loopback v4, the whole /8', '127.9.9.9'],
      ['loopback v6', '::1'],
      ['this host', '0.0.0.0'],
      ['cloud metadata', '169.254.169.254'],
      ['link-local v4', '169.254.1.1'],
      ['link-local v6', 'fe80::1'],
      ['private 10/8', '10.0.0.5'],
      ['private 172.16/12', '172.20.1.1'],
      ['private 192.168/16', '192.168.1.1'],
      ['carrier-grade NAT', '100.64.0.1'],
      ['unique local v6', 'fd00::1'],
      ['multicast', '224.0.0.1'],
      ['IPv4-mapped loopback', '::ffff:127.0.0.1']
    ] as const

    it.each(blocked)('blocks %s (%s)', (_name, address) => {
      expect(isBlockedAddress(address)).toBe(true)
    })

    it.each([
      ['a public v4', '93.184.216.34'],
      ['a public v6', '2606:2800:220:1:248:1893:25c8:1946'],
      ['172.32 is not private', '172.32.0.1']
    ])('allows %s (%s)', (_name, address) => {
      expect(isBlockedAddress(address)).toBe(false)
    })
  })

  describe('the URL a customer may configure', () => {
    it('refuses plain http, whatever the host', async () => {
      // Not a transport preference: a payload signed for one customer would
      // otherwise cross the internet in clear text, and the signature does not
      // make the answers in it private.
      await expect(assertDeliverableUrl('http://example.com/hook')).rejects.toThrow(/https/i)
    })

    it('refuses a literal private address', async () => {
      await expect(assertDeliverableUrl('https://169.254.169.254/latest/meta-data/'))
        .rejects.toThrow(/private|internal|not reachable/i)
      await expect(assertDeliverableUrl('https://127.0.0.1:3000/api')).rejects.toThrow()
      await expect(assertDeliverableUrl('https://10.0.0.1/hook')).rejects.toThrow()
    })

    it('refuses a hostname that resolves to a private address', async () => {
      // `localhost` is the honest version of the DNS case: a name, resolved,
      // pointing inside. A customer-controlled domain can do exactly this, and
      // checking the *string* rather than the resolution is the hole.
      await expect(assertDeliverableUrl('https://localhost/hook')).rejects.toThrow()
    })

    it('refuses credentials in the URL', async () => {
      // They would be logged and stored, and they are never how a webhook
      // authenticates — the signature is.
      await expect(assertDeliverableUrl('https://user:pass@example.com/hook')).rejects.toThrow()
    })

    it('refuses a URL that is not one', async () => {
      await expect(assertDeliverableUrl('not a url')).rejects.toThrow()
      await expect(assertDeliverableUrl('ftp://example.com/hook')).rejects.toThrow()
    })
  })

  it('bounds a delivery in time', () => {
    // A customer endpoint that accepts the connection and never answers must
    // not hold a worker slot for ever — the failure mode features/0017 met with
    // its Redis client, in a new place.
    expect(WEBHOOK_TIMEOUT_MS).toBeGreaterThan(0)
    expect(WEBHOOK_TIMEOUT_MS).toBeLessThanOrEqual(15_000)
  })
})
