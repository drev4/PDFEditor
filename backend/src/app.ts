import express, { type Request, type Response } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import cookieParser from 'cookie-parser'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import { authRouter } from './routes/auth.js'
import { formsRouter } from './routes/forms.js'
import { formFieldsRouter } from './routes/form-fields.js'
import { uploadRouter } from './routes/upload.js'
import { responsesRouter } from './routes/responses.js'
import { organizationsRouter } from './routes/organizations.js'
import { billingRouter, webhookRouter } from './routes/billing.js'
import { v1Router } from './routes/v1/index.js'
import { errorHandler } from './middleware/errorHandler.js'
import { envBool, envInt } from './config/env.js'
import { pdfFilenameFrom, verifyPdfToken } from './services/pdf-url.js'
import { pdfStorage } from './services/pdf-storage.js'

dotenv.config()

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required')
}

export const app = express()

// How many reverse proxies sit in front of this process. It decides what
// `req.ip` is, and therefore whether the rate limiters in
// `middleware/rateLimit.ts` identify the client or something else entirely.
//
// Too low, and every request behind a load balancer carries the balancer's
// address: one attacker exhausts the limit for every user at once, turning the
// limiter into an outage. Do NOT "fix" that with `true` — that makes `req.ip`
// the leftmost X-Forwarded-For value, which the client sends and can rotate per
// request to bypass the limiter entirely. express-rate-limit rejects `true` for
// exactly this reason.
//
// Set TRUST_PROXY_HOPS to the number of proxies actually in front of this
// process. The default of 0 trusts none, so a deploy that forgets it degrades to
// a shared limit — visible and safe — rather than to no limit at all.
const trustProxyHops = envInt('TRUST_PROXY_HOPS', 0, 0)
app.set('trust proxy', trustProxyHops === 0 ? false : trustProxyHops)

// Response headers (finding S5). Two things this does NOT do, both deliberate:
//
// 1. No Content-Security-Policy on API responses. A CSP constrains a document —
//    what it may load, connect to and execute. This process serves JSON and one
//    PDF; it never serves `index.html`. A policy here would govern nothing while
//    looking like the finding was closed. The policy that matters is delivered
//    with the SPA (`frontend/index.html`), on the origin that runs the
//    application code. The PDF route below sets its own, because that response
//    *is* a document when opened directly.
//
// 2. No HSTS unless the deployment actually terminates TLS. A browser that sees
//    Strict-Transport-Security from `localhost` applies it to `localhost` on
//    every port afterwards, which breaks unrelated local development in a way
//    that is very hard to trace back to here. Off by default; the deployment
//    turns it on. See docs/sot/08-operations.md.
//
// helmet's default `Cross-Origin-Resource-Policy: same-origin` is kept for API
// responses and deliberately overridden on the PDF route — see there for why.
const enableHsts = envBool('ENABLE_HSTS', false)
app.use(helmet({
  contentSecurityPolicy: false,
  strictTransportSecurity: enableHsts
    ? { maxAge: 31536000, includeSubDomains: true }
    : false
}))

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}))
// ─────────────────────────────────────────────────────────────────────────────
// DO NOT MOVE THIS BELOW `express.json()`.
//
// The Stripe webhook is the only route in this application whose caller is
// authenticated by a signature over the **raw request bytes**. `express.json()`
// consumes the stream and hands the handler a parsed object; re-serialising it
// does not reproduce Stripe's bytes, so `stripe.webhooks.constructEvent` fails
// on every single event.
//
// The breakage is silent and total: the endpoint still answers, `stripe listen`
// in development can still appear to work, and in deployment every event is
// rejected as an invalid signature — which means subscriptions are bought and
// never activated, and cancelled and never applied. It is mounted here, above
// the JSON parser, and `routes/billing.ts` gives it `express.raw` of its own.
// ─────────────────────────────────────────────────────────────────────────────
app.use('/api/billing', webhookRouter)

app.use(express.json())
// The refresh token travels in an httpOnly cookie (finding S4). Only the auth
// routes read it; everything else authenticates with a Bearer header.
app.use(cookieParser())

// Uploaded PDFs. This used to be `express.static('/uploads')`, which made every
// PDF any customer had ever uploaded fetchable forever by anyone holding the URL
// — no token, no expiry, no way to withdraw access once a link leaked into a
// browser history or a proxy log (finding S1). The file is now reachable only
// through a URL signed by `services/pdf-url.ts`, which the API mints fresh on
// every read of a form.
//
// This route is deliberately unauthenticated: an anonymous respondent has to be
// able to load the PDF of a published form. The capability is the signature, not
// a session.
app.get('/uploads/pdfs/:token/:filename', async (req, res) => {
  // **Everything below is inside this try, and it must stay that way.** The
  // handler became `async` when the bytes moved behind a storage driver
  // (features/0016), and Express 4 does not catch a rejected promise from an
  // async handler — it becomes an unhandled rejection, which Node 22 turns into
  // `process.exit(1)`. This route is unauthenticated and the `s3` driver
  // rethrows anything that is not a 404, so one organization's expired
  // credential or throttled request would have taken the API down for every
  // customer sharing the process. Found by review, reproduced, and covered by
  // `tests/security-headers.spec.ts`.
  try {
    return await servePdf(req, res)
  } catch (error) {
    // Logged in full here, and described to nobody: which provider, bucket or
    // credential failed is useful to an attacker and useless to a respondent,
    // who can only try again.
    console.error('Failed to serve an uploaded PDF:', error)
    return res.status(500).json({ error: 'Unable to read this file right now.' })
  }
})

async function servePdf(req: Request<{ token: string; filename: string }>, res: Response) {
  const invalidLink = { error: 'This link is invalid or has expired.' }

  // Never let anything but a filename this service could have issued reach the
  // filesystem.
  const filename = pdfFilenameFrom(req.params.filename)
  if (!filename) {
    return res.status(403).json(invalidLink)
  }

  // `invalid` and `expired` deliberately return the same response — see
  // `verifyPdfToken`.
  if (verifyPdfToken(req.params.token, filename) !== 'ok') {
    return res.status(403).json(invalidLink)
  }

  // Through `services/pdf-storage.ts`, which is the only thing that knows where
  // the bytes live (features/0016). This route no longer joins a path, and must
  // not: on the `s3` driver there is no path to join.
  const body = await pdfStorage().getStream(filename)
  if (!body) {
    return res.status(404).json({ error: 'File not found' })
  }

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`)
  // The URL is a bearer capability. A shared cache holding these bytes under it
  // would keep serving them past the expiry the token exists to enforce.
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')

  // Overrides helmet's default of `same-origin`. The SPA is a different origin
  // from this API — they are separate servers in development and `VITE_API_URL`
  // is compile-time, so they are separate in production too — and it has to be
  // able to fetch this file. Under the default, every PDF in the editor and
  // every published form silently fails to render.
  //
  // This is a real widening, and the reason it is acceptable is that the token
  // is the access control: the URL is unguessable and expires. It is not a
  // decision to repeat for any other route.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')

  // The bytes are attacker-supplied and served from our own origin, so if this
  // URL is opened directly as a document it must not be able to act as one:
  // no scripts, no plugins, no subresources, no same-origin access to anything.
  // pdf.js fetches these bytes and renders them to a canvas, so this policy has
  // no effect on the application's own viewer.
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'none'; object-src 'none'; frame-ancestors 'none'; sandbox"
  )
  // helmet's global default is SAMEORIGIN, which would disagree with the
  // `frame-ancestors 'none'` above for any browser falling back to the legacy
  // header. Nothing on this origin needs to frame a PDF.
  res.setHeader('X-Frame-Options', 'DENY')

  // Streamed rather than `res.sendFile`, because a storage driver has no local
  // path to hand Express. One behaviour is lost with it and is recorded here
  // rather than discovered later: `sendFile` advertises `Accept-Ranges` and
  // answers range requests, so pdf.js could fetch a large document in parts.
  // It now always fetches the whole file. Acceptable at a 10 MB upload cap, and
  // the alternative — implementing ranges over a driver — is a feature, not a
  // detail of this move.
  body.on('error', () => {
    // The headers are already sent by the time bytes start flowing, so there is
    // no status left to change. Destroy the response rather than leaving the
    // client hanging on a truncated document it might mistake for a whole one.
    res.destroy()
  })

  return body.pipe(res)
}

// Anything else under /uploads — including every URL of the old unsigned shape —
// is gone. Answered here rather than by Express's default so the client gets
// this API's JSON error shape instead of an HTML page.
app.use('/uploads', (_req, res) => {
  res.status(404).json({ error: 'Not found' })
})

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use('/api/auth', authRouter)
app.use('/api/forms', formsRouter)
app.use('/api/forms', formFieldsRouter)
app.use('/api/upload', uploadRouter)
app.use('/api/responses', responsesRouter)
app.use('/api/organizations', organizationsRouter)
// The webhook is NOT here — see the raw-body mount above `express.json()`.
app.use('/api/billing', billingRouter)

// The published API (features/0019). Everything above this line serves the SPA
// and may change in any release; everything under `/api/v1` is a contract with
// people outside this repository, authenticated by an API key rather than a
// session. See docs/sot/06-api-reference.md.
app.use('/api/v1', v1Router)

app.use(errorHandler)
