import multer from 'multer'
import { nanoid } from 'nanoid'

/**
 * Accepts the multipart upload and holds it in memory (features/0016).
 *
 * **`memoryStorage`, and the number behind that choice matters**, because it is
 * a trade rather than a free simplification. It was `diskStorage` writing
 * straight into `uploads/pdfs`, which is exactly what stopped this API running
 * as more than one replica. A driver-backed store cannot be a multer
 * destination, so the bytes have to be somewhere while the handler validates
 * them — and the alternatives are a temp file (a local disk again, with cleanup
 * to get wrong) or streaming straight to the store (which forfeits validating
 * the PDF *before* it is kept, so every hostile or corrupt upload becomes an
 * object somebody has to delete).
 *
 * The number: `fileSize` below caps one upload at 10 MB, so the worst case is
 * 10 MB × concurrent uploads. That concurrency is bounded — `POST /api/upload`
 * sits behind `authenticate`, so it is not an anonymous surface, and a
 * deployment that wants a hard ceiling should bound it at the reverse proxy.
 * The failure mode did change and it is worth knowing: a full disk used to
 * produce a failed request, and memory exhaustion takes the process down for
 * everybody. That is the cost of not having a disk to fall back on.
 */
const storage = multer.memoryStorage()

/**
 * The stored name for a fresh upload.
 *
 * `nanoid(12)-<timestamp>.pdf`, unchanged from the `diskStorage` version — the
 * shape is load-bearing. `SAFE_FILENAME` in `services/pdf-url.ts` and
 * `SAFE_KEY` in `services/pdf-storage.ts` both encode it, and nanoid's default
 * alphabet is exactly `A-Za-z0-9_-`, which is what makes a name from here safe
 * to put in a path or an object key.
 */
export function newPdfKey(): string {
  return `${nanoid(12)}-${Date.now()}.pdf`
}

const fileFilter = (req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  if (file.mimetype === 'application/pdf') {
    cb(null, true)
  } else {
    cb(new Error('Only PDF files are allowed'))
  }
}

// 10MB limit.
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024
  }
})
