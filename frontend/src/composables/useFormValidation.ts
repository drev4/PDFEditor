import { ref } from 'vue'
import type { Field } from '@/services/forms'
import { runPattern } from '@/services/pattern-check'

export interface ValidationResult {
    isValid: boolean
    errors: Record<string, string>
}

export function useFormValidation() {
    const errors = ref<Record<string, string>>({})

    const checkField = async (field: Field, value: any): Promise<string | null> => {
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
                // Off the main thread and on a clock (features/0035). The
                // author's pattern is compiled by RE2 on the server, which is
                // linear, and by a backtracking engine here — `^(a+)+$` is
                // valid RE2 and hangs this tab. `runPattern` bounds it by
                // killing the worker.
                //
                // `no-verdict` deliberately produces **no error**: it means the
                // browser could not read the rule, not that the value is wrong,
                // and the server checks the same rule with an engine that can.
                const verdict = await runPattern(field.validation.pattern, strVal)
                if (verdict === 'no-match') {
                    return 'Invalid format'
                }
            }
        }

        return null
    }

    const validateField = async (field: Field, value: any): Promise<boolean> => {
        const error = await checkField(field, value)

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

    /**
     * **This is a submit gate.** `PublicFormView.vue` calls it as
     * `if (!await validate(...)) return`, and the `await` is load-bearing: a
     * promise is always truthy, so dropping it would let every submission
     * through silently — no error, no console line, and the server still
     * refusing the values, so it would look like the check had merely gone
     * quiet. That trap is why features/0035 migrated the caller in the same
     * change.
     */
    const validate = async (fields: Field[], responses: Record<string, any>): Promise<boolean> => {
        const newErrors: Record<string, string> = {}
        let isValid = true

        // Sequential rather than `Promise.all`: each pattern check may occupy
        // the shared worker, and a form's worth of fields is a handful.
        for (const field of fields) {
            const error = await checkField(field, responses[field.id])
            if (error) {
                newErrors[field.name] = error
                isValid = false
            }
        }

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
