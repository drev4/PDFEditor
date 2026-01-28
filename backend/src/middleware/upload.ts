import multer from 'multer'
import path from 'path'
import { nanoid } from 'nanoid'
import fs from 'fs'

// Ensure uploads directory exists
const uploadsDir = path.join(process.cwd(), 'uploads', 'pdfs')
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true })
}

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir)
  },
  filename: (req, file, cb) => {
    // Generate unique filename: nanoid-timestamp.pdf
    const uniqueName = `${nanoid(12)}-${Date.now()}.pdf`
    cb(null, uniqueName)
  }
})

// File filter to only accept PDFs
const fileFilter = (req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (file.mimetype === 'application/pdf') {
    cb(null, true)
  } else {
    cb(new Error('Only PDF files are allowed'))
  }
}

// Configure multer with 10MB limit
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
})
