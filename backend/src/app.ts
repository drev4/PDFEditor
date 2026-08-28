import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import { authRouter } from './routes/auth.js'
import { formsRouter } from './routes/forms.js'
import { formFieldsRouter } from './routes/form-fields.js'
import { uploadRouter } from './routes/upload.js'
import { responsesRouter } from './routes/responses.js'
import { errorHandler } from './middleware/errorHandler.js'
import { envInt } from './config/env.js'
import { pdfFilenameFrom, verifyPdfToken } from './services/pdf-url.js'

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

app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}))
app.use(express.json())

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
app.get('/uploads/pdfs/:token/:filename', (req, res) => {
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

  const pdfPath = path.join(process.cwd(), 'uploads', 'pdfs', filename)
  if (!fs.existsSync(pdfPath)) {
    return res.status(404).json({ error: 'File not found' })
  }

  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`)
  // The URL is a bearer capability. A shared cache holding these bytes under it
  // would keep serving them past the expiry the token exists to enforce.
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')

  return res.sendFile(pdfPath)
})

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

app.use(errorHandler)
