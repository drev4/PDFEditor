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

dotenv.config()

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required')
}

export const app = express()

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
