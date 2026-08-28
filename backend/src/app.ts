import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import { authRouter } from './routes/auth.js'
import { formsRouter } from './routes/forms.js'
import { formFieldsRouter } from './routes/form-fields.js'
import { uploadRouter } from './routes/upload.js'
import { responsesRouter } from './routes/responses.js'
import { errorHandler } from './middleware/errorHandler.js'
import { envInt } from './config/env.js'

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

app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')))

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use('/api/auth', authRouter)
app.use('/api/forms', formsRouter)
app.use('/api/forms', formFieldsRouter)
app.use('/api/upload', uploadRouter)
app.use('/api/responses', responsesRouter)

app.use(errorHandler)
