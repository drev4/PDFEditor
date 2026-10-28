import { describe, it, expect } from 'vitest'
import { normalizeRespondentName, respondentNameError, RESPONDENT_NAME_MAX_LENGTH } from './respondentName'

// The browser mirror of backend/src/services/respondent-name.ts (features/0054).
describe('respondentName', () => {
  it('normalises the way the server does', () => {
    expect(normalizeRespondentName('  Ada   Lovelace ')).toBe('Ada Lovelace')
  })

  it('accepts a normal name and the maximum length', () => {
    expect(respondentNameError('José Núñez')).toBeNull()
    expect(respondentNameError('a'.repeat(RESPONDENT_NAME_MAX_LENGTH))).toBeNull()
  })

  it('refuses blank, too long and control characters', () => {
    expect(respondentNameError('   ')).toBe('Your name is required')
    expect(respondentNameError('a'.repeat(RESPONDENT_NAME_MAX_LENGTH + 1))).toMatch(/Maximum length/)
    expect(respondentNameError('Ada\tLovelace')).toMatch(/not allowed/)
    expect(respondentNameError(`Ada${String.fromCharCode(0x2028)}`)).toMatch(/not allowed/)
  })
})
