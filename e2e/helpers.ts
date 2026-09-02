import { expect, type Page, type APIRequestContext } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const API_URL = 'http://localhost:3000/api'

export interface TestUser {
  email: string
  password: string
  name: string
}

/**
 * A genuinely unique address.
 *
 * `Date.now()` on its own is not enough: parallel workers import a spec module
 * in the same millisecond, and the previous version of this suite shared one
 * email across every test in a describe block. The second registration then
 * returns `400 Email already registered`, the app never leaves `/register`, and
 * the following `waitForURL('/dashboard')` times out. The uuid fragment is what
 * actually makes this unique.
 */
export function uniqueEmail(prefix = 'e2e'): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`
}

export function newUser(prefix = 'e2e'): TestUser {
  return {
    email: uniqueEmail(prefix),
    password: 'TestPassword123!',
    name: 'E2E User'
  }
}

/**
 * Registers a brand new user through the UI and leaves the page on `/dashboard`.
 *
 * Use this instead of inlining the registration steps. Every test gets its own
 * account, so no test can be broken by another test's data or by the order they
 * run in.
 */
export async function registerNewUser(page: Page, prefix = 'e2e'): Promise<TestUser> {
  const user = newUser(prefix)

  await page.goto('/register')
  await page.fill('[data-testid="register-name-input"]', user.name)
  await page.fill('[data-testid="register-email-input"]', user.email)
  await page.fill('#register-password-input', user.password)
  await page.fill('#register-confirm-password-input', user.password)
  await page.click('[data-testid="register-submit-button"]')
  await page.waitForURL(/\/dashboard/)

  return user
}

/** Logs an already-registered user in through the UI. */
export async function loginUser(page: Page, user: TestUser): Promise<void> {
  await page.goto('/login')
  await page.fill('[data-testid="login-email-input"]', user.email)
  await page.fill('#login-password-input', user.password)
  await page.click('[data-testid="login-submit-button"]')
  await page.waitForURL(/\/dashboard/)
}

export interface SeededForm {
  author: TestUser
  token: string
  formId: string
  shareId: string
  fieldId: string
  fieldLabel: string
}

/**
 * Creates a published form with one text field, over the real HTTP API, and
 * returns its `shareId`.
 *
 * Through the API rather than Prisma on purpose: a database seed would skip the
 * routes, and this suite's whole value is that it exercises them. It would, for
 * instance, have sailed straight through the bulk-save data-loss defect that
 * `features/0001` fixed, because that bug lived in a handler.
 *
 * Through the API rather than the editor UI also on purpose: these tests are
 * about the public submission flow, and driving the authoring UI would make them
 * fail whenever the editor breaks.
 */
export async function createPublishedForm(
  request: APIRequestContext,
  fieldLabel = 'Your answer'
): Promise<SeededForm> {
  const author = newUser('author')

  const registered = await request.post(`${API_URL}/auth/register`, { data: author })
  expect(registered.ok(), `register failed: ${await registered.text()}`).toBeTruthy()
  const { token } = await registered.json()
  const headers = { Authorization: `Bearer ${token}` }

  // A real PDF, so the viewer has something to render.
  const pdfPath = path.join(process.cwd(), 'backend', 'test-fixtures', 'valid.pdf')
  const uploaded = await request.post(`${API_URL}/upload`, {
    headers,
    multipart: {
      pdf: {
        name: 'valid.pdf',
        mimeType: 'application/pdf',
        buffer: fs.readFileSync(pdfPath)
      }
    }
  })
  expect(uploaded.ok(), `upload failed: ${await uploaded.text()}`).toBeTruthy()
  const { url: pdfUrl } = await uploaded.json()

  const created = await request.post(`${API_URL}/forms`, {
    headers,
    data: { title: `E2E Form ${Date.now()}`, description: 'Created by the E2E suite', pdfUrl }
  })
  expect(created.ok(), `create form failed: ${await created.text()}`).toBeTruthy()
  const { form } = await created.json()

  // The bulk save is a diff keyed on `id`; omitting `id` creates. See features/0001.
  const savedFields = await request.post(`${API_URL}/forms/${form.id}/fields/bulk`, {
    headers,
    data: {
      fields: [
        {
          type: 'text',
          name: 'answer',
          label: fieldLabel,
          required: false,
          position: { x: 50, y: 50, width: 200, height: 30, page: 1 },
          order: 0
        }
      ]
    }
  })
  expect(savedFields.ok(), `bulk save failed: ${await savedFields.text()}`).toBeTruthy()
  const { fields } = await savedFields.json()

  const published = await request.patch(`${API_URL}/forms/${form.id}/status`, {
    headers,
    data: { status: 'published' }
  })
  expect(published.ok(), `publish failed: ${await published.text()}`).toBeTruthy()

  return {
    author,
    token,
    formId: form.id,
    shareId: form.shareId,
    fieldId: fields[0].id,
    fieldLabel
  }
}
