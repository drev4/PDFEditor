import { Router } from 'express'
import { upload } from '../middleware/upload.js'
import { authenticate, AuthRequest } from '../middleware/auth.js'
import { AppError } from '../middleware/errorHandler.js'

export const uploadRouter = Router()

// POST /api/upload - Upload PDF file
uploadRouter.post('/', authenticate, upload.single('pdf'), async (req: AuthRequest, res, next) => {
  try {
    if (!req.file) {
      throw new AppError(400, 'No file uploaded')
    }

    // Get the base URL from environment or default to localhost
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
    const pdfUrl = `${baseUrl}/uploads/pdfs/${req.file.filename}`

    res.status(201).json({
      url: pdfUrl,
      filename: req.file.filename,
      size: req.file.size
    })
  } catch (error) {
    next(error)
  }
})
