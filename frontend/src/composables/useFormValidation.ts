import { ref } from 'vue'
import type { Field } from '@/services/forms'

export interface ValidationResult {
    isValid: boolean
    errors: Record<string, string>
}

export function useFormValidation() {
    const errors = ref<Record<string, string>>({})

    const checkField = (field: Field, value: any): string | null => {
        // Required check
        if (field.required) {
            if (value === null || value === undefined || value === '') {
                return 'This field is required'
            }
            if (field.type === 'checkbox' && value !== true) {
                return 'This field is required'
            }
            if (Array.isArray(value) && value.length === 0) {
                return 'This field is required'
            }
        }

        // If empty and not required, skip other checks
        if (!value && value !== 0 && value !== false) {
            return null
        }

        // Min/Max Length (for text/textarea)
        if (field.type === 'text' || field.type === 'textarea') {
            const strVal = String(value)
            if (field.validation?.minLength && strVal.length < field.validation.minLength) {
                return `Minimum length is ${field.validation.minLength} characters`
            }
            if (field.validation?.maxLength && strVal.length > field.validation.maxLength) {
                return `Maximum length is ${field.validation.maxLength} characters`
            }
            if (field.validation?.pattern) {
                try {
                    const regex = new RegExp(field.validation.pattern)
                    if (!regex.test(strVal)) {
                        return 'Invalid format'
                    }
                } catch (e) {
                    console.error('Invalid regex pattern:', field.validation.pattern)
                }
            }
        }

        return null
    }

    const validateField = (field: Field, value: any): boolean => {
        const error = checkField(field, value)

        if (error) {
            // Create new object to maintain reactivity
            errors.value = { ...errors.value, [field.name]: error }
            return false
        } else {
            if (errors.value[field.name]) {
                const newErrors = { ...errors.value }
                delete newErrors[field.name]
                errors.value = newErrors
            }
            return true
        }
    }

    const validate = (fields: Field[], responses: Record<string, any>): boolean => {
        const newErrors: Record<string, string> = {}
        let isValid = true

        fields.forEach(field => {
            const error = checkField(field, responses[field.id])
            if (error) {
                newErrors[field.name] = error
                isValid = false
            }
        })

        errors.value = newErrors
        return isValid
    }

    const clearError = (fieldName: string) => {
        if (errors.value[fieldName]) {
            const newErrors = { ...errors.value }
            delete newErrors[fieldName]
            errors.value = newErrors
        }
    }

    return {
        errors,
        validateField,
        validate,
        clearError
    }
}
