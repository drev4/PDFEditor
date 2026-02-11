import { describe, it, expect } from 'vitest'
import { useFormValidation } from './useFormValidation'
import type { Field } from '@/services/forms'

describe('useFormValidation', () => {
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

    it('validates required fields', () => {
        const { validateField, errors } = useFormValidation()
        const field = createField({ required: true })

        // Invalid case
        const isValid = validateField(field, '')
        expect(isValid).toBe(false)
        expect(errors.value[field.name]).toBe('This field is required')

        // Valid case
        const isValidNow = validateField(field, 'some content')
        expect(isValidNow).toBe(true)
        expect(errors.value[field.name]).toBeUndefined()
    })

    it('validates minLength', () => {
        const { validateField, errors } = useFormValidation()
        const field = createField({
            validation: { minLength: 5 }
        })

        // Too short
        validateField(field, '123')
        expect(errors.value[field.name]).toContain('Minimum length is 5')

        // Long enough
        validateField(field, '12345')
        expect(errors.value[field.name]).toBeUndefined()
    })

    it('validates maxLength', () => {
        const { validateField, errors } = useFormValidation()
        const field = createField({
            validation: { maxLength: 5 }
        })

        // Too long
        validateField(field, '123456')
        expect(errors.value[field.name]).toContain('Maximum length is 5')

        // Short enough
        validateField(field, '12345')
        expect(errors.value[field.name]).toBeUndefined()
    })

    it('validates regex patterns', () => {
        const { validateField, errors } = useFormValidation()
        const field = createField({
            validation: { pattern: '^[0-9]+$' } // Only numbers
        })

        // Invalid pattern
        validateField(field, 'abc')
        expect(errors.value[field.name]).toBe('Invalid format')

        // Valid pattern
        validateField(field, '123')
        expect(errors.value[field.name]).toBeUndefined()
    })

    it('validates entire form', () => {
        const { validate, errors } = useFormValidation()
        const fields: Field[] = [
            createField({ id: 'f1', name: 'field1', required: true }),
            createField({ id: 'f2', name: 'field2', validation: { minLength: 3 } })
        ]

        const responses = {
            'f1': '',
            'f2': 'ab'
        }

        const isValid = validate(fields, responses)
        expect(isValid).toBe(false)
        expect(errors.value['field1']).toBe('This field is required')
        expect(errors.value['field2']).toContain('Minimum length is 3')
    })

    it('handles checkboxes correctly', () => {
        const { validateField, errors } = useFormValidation()
        const field = createField({ type: 'checkbox', required: true })

        // Unchecked (false) is invalid if required
        validateField(field, false)
        expect(errors.value[field.name]).toBe('This field is required')

        // Checked (true) is valid
        validateField(field, true)
        expect(errors.value[field.name]).toBeUndefined()
    })
})
