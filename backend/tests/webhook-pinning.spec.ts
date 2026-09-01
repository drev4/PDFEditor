import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import https from 'https'
import type { AddressInfo } from 'net'
import { deliver } from '../src/services/webhook-egress.js'

/**
 * The DNS-rebinding defence, tested where it actually lives (features/0020).
 *
 * `webhook-egress.spec.ts` covers the address blocklist and the URL checks, and
 * `tests/integration/webhook-delivery.spec.ts` covers a real delivery — but
 * **neither one could catch the removal of the pinned `lookup`**, which the
 * module's own comment calls the subtle rule. Found by
 * `saas-readiness-reviewer`: the integration spec delivers to
 * `https://127.0.0.1:<port>`, a hostname that resolves to itself, so a
 * `deliver()` that had quietly gone back to ordinary DNS would pass it
 * unchanged.
 *
 * This test makes the two answers different on purpose. The URL's hostname is
 * under `.invalid`, a TLD RFC 2606 guarantees will never resolve, while the
 * validated address handed to `deliver` is the local server. So:
 *
 *   - **with** the pin, the request lands on the server below and the test
 *     passes;
 *   - **without** it, `https.request` performs its own lookup, gets `ENOTFOUND`,
 *     and the delivery fails — offline, instantly, and for exactly the right
 *     reason.
 *
 * It is also the only test that proves the two halves of the guard compose: an
 * address that `assertDeliverableUrl` approved is the address the socket
 * actually goes to, rather than one a second resolution chose.
 */
describe('a delivery connects to the address that was checked', () => {
  let server: https.Server
  let port: number
  let received: { host: string | undefined; body: string } | null = null

  beforeAll(async () => {
    const selfsigned = await import('selfsigned')
    const pems = await selfsigned.default.generate(
      [{ name: 'commonName', value: '127.0.0.1' }],
      { days: 1 }
    )

    server = https.createServer({ key: pems.private, cert: pems.cert }, (req, res) => {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        received = { host: req.headers.host, body }
        res.writeHead(200).end('ok')
      })
    })

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port

    // The certificate is self-signed; the guard's own TLS verification is not
    // what this file is about.
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  })

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()))
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
  })

  it('uses the validated address, not a fresh resolution of the hostname', async () => {
    const result = await deliver({
      // Never resolvable (RFC 2606). Any lookup of it fails.
      target: {
        url: new URL(`https://pinning.invalid:${port}/hook`),
        addresses: [{ address: '127.0.0.1', family: 4 }]
      },
      body: JSON.stringify({ pinned: true }),
      headers: { 'X-Test': 'pinning' }
    })

    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)

    // It reached the server the *address* points at, while still presenting the
    // hostname from the URL — which is what a real customer endpoint behind a
    // load balancer needs, and what proves the pin is doing the routing.
    expect(received).not.toBeNull()
    expect(received!.host).toContain('pinning.invalid')
    expect(JSON.parse(received!.body)).toEqual({ pinned: true })
  })

  it('reports a failure rather than throwing when the pinned address refuses', async () => {
    const result = await deliver({
      target: {
        url: new URL('https://pinning.invalid:1/hook'),
        addresses: [{ address: '127.0.0.1', family: 4 }]
      },
      body: '{}',
      headers: {}
    })

    // A customer's broken endpoint is an expected condition, not an exception:
    // the queue decides what to do about it, and it can only do that if this
    // resolves.
    expect(result.ok).toBe(false)
    expect(result.status).toBeNull()
    expect(result.error).toBeTruthy()
  })
})
