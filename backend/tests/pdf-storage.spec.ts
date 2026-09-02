import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { LocalPdfStorage, pdfStorage, setPdfStorage } from '../src/services/pdf-storage.js'

/**
 * The storage service ([`features/0016`](../../features/0016-object-storage-for-uploaded-pdfs.md)).
 *
 * Two things are worth testing at this level and the rest belongs higher up:
 * the **key guard**, because it is the last thing between a request-supplied
 * string and a filesystem path, and the **driver selection**, because its
 * failure mode is the one this feature exists to prevent — accepting uploads
 * onto a disk that is about to disappear.
 *
 * The `s3` driver's actual behaviour is not exercised here. Mocking the AWS SDK
 * would assert that this code calls the mock the way this code calls the mock,
 * which is worth nothing; it is verified against a real S3-compatible endpoint
 * (MinIO in `docker-compose.yml`) and the result recorded in the feature's
 * Outcome.
 */
describe('pdf storage', () => {
  let directory: string
  let storage: LocalPdfStorage

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vuepdf-storage-'))
    storage = new LocalPdfStorage(directory)
  })

  afterEach(() => {
    setPdfStorage(null)
    delete process.env.PDF_STORAGE_DRIVER
    delete process.env.PDF_STORAGE_BUCKET
    fs.rmSync(directory, { recursive: true, force: true })
  })

  describe('the key guard', () => {
    it.each([
      ['a parent-directory escape', '../../etc/passwd'],
      ['a nested path', 'a/b.pdf'],
      ['a backslash path', '..\\windows\\system32'],
      ['an absolute path', '/etc/passwd'],
      ['a name that is not a PDF', 'notes.txt'],
      ['a double extension', 'x.backup.pdf'],
      ['an empty name', '']
    ])('refuses %s', async (_label, key) => {
      // Every caller is supposed to have run the name through `pdfFilenameFrom`
      // first. This is the backstop, and it throws rather than returning a
      // falsy value so that a caller which skipped that check cannot quietly
      // carry on with a path it built itself.
      await expect(storage.get(key)).rejects.toThrow(/unsafe PDF key/i)
      await expect(storage.put(key, Buffer.from('x'))).rejects.toThrow(/unsafe PDF key/i)
      await expect(storage.exists(key)).rejects.toThrow(/unsafe PDF key/i)
      await expect(storage.remove(key)).rejects.toThrow(/unsafe PDF key/i)
    })

    it('accepts the shape uploads actually produce', async () => {
      // `nanoid(12)-<timestamp>.pdf`, the name `middleware/upload.ts` mints.
      await expect(storage.put('V1StGXR8_Z5j-1788000000000.pdf', Buffer.from('%PDF-'))).resolves
        .toBeUndefined()
    })
  })

  describe('the local driver', () => {
    const KEY = 'abc123def456-1788000000000.pdf'

    it('round-trips a document', async () => {
      await storage.put(KEY, Buffer.from('%PDF-1.7 hello'))

      expect(await storage.exists(KEY)).toBe(true)
      expect((await storage.get(KEY)).toString()).toBe('%PDF-1.7 hello')
    })

    it('reports a missing document rather than throwing, where the caller expects that', async () => {
      expect(await storage.exists(KEY)).toBe(false)
      expect(await storage.getStream(KEY)).toBeNull()
    })

    it('treats removing something that is not there as success', async () => {
      // The invalid-upload cleanup path calls this on files that may never have
      // been written; turning that into an error would report a second, more
      // confusing failure on top of the first.
      await expect(storage.remove(KEY)).resolves.toBeUndefined()
    })

    it('leaves no temporary file behind after a write', async () => {
      await storage.put(KEY, Buffer.from('%PDF-'))

      // `put` writes to a temporary name and renames into place so a reader
      // never sees a half-written document. The temporary must not survive.
      expect(fs.readdirSync(directory)).toEqual([KEY])
    })

    it('replaces a document without a window where it is absent or short', async () => {
      const big = Buffer.alloc(512 * 1024, 'a')
      await storage.put(KEY, big)

      const replacement = Buffer.alloc(512 * 1024, 'b')
      const write = storage.put(KEY, replacement)

      // Read while the replacement is in flight. Because the write goes to a
      // temporary name and is renamed in, every read sees one whole document —
      // never a truncated one, which `writeFile` would expose.
      const during = await storage.get(KEY)
      expect(during.length).toBe(big.length)

      await write
      expect((await storage.get(KEY)).subarray(0, 1).toString()).toBe('b')
    })
  })

  describe('driver selection', () => {
    it('defaults to local when nothing is configured', () => {
      expect(pdfStorage()).toBeInstanceOf(LocalPdfStorage)
    })

    it('refuses to start on a driver it does not recognise', () => {
      process.env.PDF_STORAGE_DRIVER = 'gcs'

      // Deliberately not the `envInt`/`resolvePlan` treatment. Falling back to
      // local disk would accept uploads and lose them at the next deploy, so
      // there is no safe direction to guess in.
      expect(() => pdfStorage()).toThrow(/Unknown PDF_STORAGE_DRIVER/)
    })

    it('refuses s3 without a bucket rather than silently using the disk', () => {
      process.env.PDF_STORAGE_DRIVER = 's3'

      expect(() => pdfStorage()).toThrow(/requires PDF_STORAGE_BUCKET/)
    })
  })
})
