import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useFormValidation } from './useFormValidation'
import { runPattern } from '@/services/pattern-check'
import type { Field } from '@/services/forms'

/**
 * The pattern check runs in a Worker (features/0035), and jsdom has none. It is
 * mocked here because the subject of this file is what the **composable**
 * decides given a verdict; the supervision that produces the verdict — the
 * deadline, and terminating a worker stuck inside `test()` — is proven for real
 * in `services/pattern-check.spec.ts`.
 */
vi.mock('@/services/pattern-check', () => ({
    runPattern: vi.fn(),
    resetPatternWorker: vi.fn()
}))

/** Behaves like a real regex, for the ordinary cases. */
function patternsWork() {
    vi.mocked(runPattern).mockImplementation(async (pattern: string, value: string) =>
        new RegExp(pattern).test(value) ? 'matched' : 'no-match'
    )
}

describe('useFormValidation', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        patternsWork()
    })

    const createField = (overrides: Partial<Field> = {}): Field => ({
        id: 'field-1',
        formId: 'form-1',
        type: 'text',
        name: 'test_field',
        label: 'Test Field',
        required: false,
        position: { x: 0, y: 0, width: 100, height: 20, page: 1 },
        order: 0,
        createdAt: new Date().toISOString(),
        ...overrides
    })

    it('validates required fields', async () => {
        const { validateField, errors } = useFormValidation()
        const field = createField({ required: true })

        // Invalid case
        const isValid = await validateField(field, '')
        expect(isValid).toBe(false)
        expect(errors.value[field.name]).toBe('This field is required')

        // Valid case
        const isValidNow = await validateField(field, 'some content')
        expect(isValidNow).toBe(true)
        expect(errors.value[field.name]).toBeUndefined()
    })

    it('validates minLength', async () => {
        const { validateField, errors } = useFormValidation()
        const field = createField({
            validation: { minLength: 5 }
        })

        // Too short
        await validateField(field, '123')
        expect(errors.value[field.name]).toContain('Minimum length is 5')

        // Long enough
        await validateField(field, '12345')
        expect(errors.value[field.name]).toBeUndefined()
    })

    it('validates maxLength', async () => {
        const { validateField, errors } = useFormValidation()
        const field = createField({
            validation: { maxLength: 5 }
        })

        // Too long
        await validateField(field, '123456')
        expect(errors.value[field.name]).toContain('Maximum length is 5')

        // Short enough
        await validateField(field, '12345')
        expect(errors.value[field.name]).toBeUndefined()
    })

    it('validates regex patterns', async () => {
        const { validateField, errors } = useFormValidation()
        const field = createField({
            validation: { pattern: '^[0-9]+$' } // Only numbers
        })

        // Invalid pattern
        await validateField(field, 'abc')
        expect(errors.value[field.name]).toBe('Invalid format')

        // Valid pattern
        await validateField(field, '123')
        expect(errors.value[field.name]).toBeUndefined()
    })

    it('validates entire form', async () => {
        const { validate, errors } = useFormValidation()
        const fields: Field[] = [
            createField({ id: 'f1', name: 'field1', required: true }),
            createField({ id: 'f2', name: 'field2', validation: { minLength: 3 } })
        ]

        const responses = {
            'f1': '',
            'f2': 'ab'
        }

        const isValid = await validate(fields, responses)
        expect(isValid).toBe(false)
        expect(errors.value['field1']).toBe('This field is required')
        expect(errors.value['field2']).toContain('Minimum length is 3')
    })

    /**
     * The open half of features/0004, closed by features/0035.
     *
     * The server compiles an author's pattern with RE2, which is linear by
     * construction. The browser used to compile the same pattern with
     * `new RegExp`, which backtracks — and `^(a+)+$` is accepted by RE2
     * (0.05 ms) while being catastrophic natively: features/0004 measured 155
     * seconds at 33 characters, doubling every two.
     *
     * So an author could hang the tab of everyone who filled in their form,
     * with a pattern the product stored without complaint.
     *
     * **These tests hang the runner against the pre-0035 code**, which is the
     * strongest evidence available that the bug was real. The per-test timeout
     * is what turns the hang into a failure.
     */
    describe('a pattern that backtracks catastrophically', () => {
        const CATASTROPHIC = '^(a+)+$'

        it('gives up instead of hanging the tab', async () => {
            // What the deadline produces: the worker was killed mid-`test()`,
            // so there is no verdict. Running the real regex here would hang
            // this test, which is exactly what happened against the old code.
            vi.mocked(runPattern).mockResolvedValue('no-verdict')
            const { validateField, errors } = useFormValidation()
            const field = createField({ validation: { pattern: CATASTROPHIC } })

            // 40 characters that cannot match: the classic worst case.
            await validateField(field, 'a'.repeat(40) + 'b')

            // No verdict is not a failure. The browser could not evaluate the
            // rule in time, so it says nothing and the server decides.
            expect(errors.value[field.name]).toBeUndefined()
        }, 5000)

        it('still answers promptly for an ordinary pattern', async () => {
            const { validateField, errors } = useFormValidation()
            const field = createField({ validation: { pattern: '^[0-9]+$' } })

            await validateField(field, 'abc')
            expect(errors.value[field.name]).toBe('Invalid format')

            await validateField(field, '123')
            expect(errors.value[field.name]).toBeUndefined()
        }, 5000)
    })

    /**
     * RE2 accepts constructs JavaScript rejects — `(?P<n>a)` is a Python-style
     * named group, valid RE2 and a `SyntaxError` here. The server stores it
     * happily, so the browser has to cope with a rule it cannot read.
     */
    it('says nothing about a pattern this engine cannot compile', async () => {
        // `(?P<n>a)` is valid RE2 and a SyntaxError here, so the worker answers
        // "cannot compile" and the composable must stay silent.
        vi.mocked(runPattern).mockResolvedValue('no-verdict')
        const { validateField, errors } = useFormValidation()
        const field = createField({ validation: { pattern: '(?P<n>a)' } })

        await validateField(field, 'anything at all')

        // Never invent a failure for a rule the browser cannot parse.
        expect(errors.value[field.name]).toBeUndefined()
    })

    /**
     * The trap features/0035 exists around. `validate()` is the submit gate in
     * `PublicFormView.vue`. Once it returns a promise, `if (!validate(...))`
     * is always false — a promise is truthy — so every submission would pass.
     * This asserts the awaited value, which is what the caller must use.
     */
    it('still refuses an invalid form when awaited', async () => {
        const { validate } = useFormValidation()
        const fields: Field[] = [createField({ id: 'f1', name: 'field1', required: true })]

        const isValid = await validate(fields, { f1: '' })

        expect(isValid).toBe(false)
    })

    it('handles checkboxes correctly', async () => {
        const { validateField, errors } = useFormValidation()
        const field = createField({ type: 'checkbox', required: true })

        // Unchecked (false) is invalid if required
        await validateField(field, false)
        expect(errors.value[field.name]).toBe('This field is required')

        // Checked (true) is valid
        await validateField(field, true)
        expect(errors.value[field.name]).toBeUndefined()
    })
})
