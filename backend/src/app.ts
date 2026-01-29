import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import path from 'path'
import { authRouter } from './routes/auth.js'
import { formsRouter } from './routes/forms.js'
import { uploadRouter } from './routes/upload.js'
import { responsesRouter } from './routes/responses.js'
import { errorHandler } from './middleware/errorHandler.js'

dotenv.config()

export const app = express()

// Middleware
app.use(cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true
}))
app.use(express.json())

// Serve uploaded files
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')))

// Health check
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// Routes
app.use('/api/auth', authRouter)
app.use('/api/forms', formsRouter)
app.use('/api/upload', uploadRouter)
app.use('/api/responses', responsesRouter)

// Error handler
app.use(errorHandler)
