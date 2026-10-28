import { describe, it, expect } from 'vitest'
import { normalizeRespondentName, RESPONDENT_NAME_MAX_LENGTH } from '../src/services/respondent-name.js'
import { exportResponsesToCSV } from '../src/services/csv-exporter.js'

describe('normalizeRespondentName (features/0054)', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeRespondentName('  Ada   Lovelace  ')).toEqual({ ok: true, name: 'Ada Lovelace' })
  })

  it('keeps letters outside ASCII', () => {
    expect(normalizeRespondentName('José Núñez Ŝtrauß')).toEqual({ ok: true, name: 'José Núñez Ŝtrauß' })
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a number', 7],
    ['an empty string', ''],
    ['only spaces', '    ']
  ])('rejects %s as missing', (_label, value) => {
    expect(normalizeRespondentName(value)).toEqual({ ok: false, error: 'Your name is required' })
  })

  // Checked before whitespace is collapsed, so a newline or tab is refused
  // rather than silently turned into a space.
  it.each([
    ['a newline', 'Ada\nLovelace'],
    ['a tab', 'Ada\tLovelace'],
    ['a NUL', 'Ada\u0000'],
    ['DEL', 'Ada\u007F'],
    ['a line separator', `Ada${String.fromCharCode(0x2028)}Lovelace`]
  ])('rejects %s', (_label, value) => {
    expect(normalizeRespondentName(value).ok).toBe(false)
  })

  it('counts the limit after normalisation', () => {
    const atLimit = 'a'.repeat(RESPONDENT_NAME_MAX_LENGTH)
    expect(normalizeRespondentName(`   ${atLimit}   `)).toEqual({ ok: true, name: atLimit })
    expect(normalizeRespondentName(atLimit + 'a').ok).toBe(false)
  })
})

describe('CSV export carries the declared name', () => {
  const form = {
    fields: [{ id: 'f1', name: 'site', label: 'Site' }]
  } as unknown as Parameters<typeof exportResponsesToCSV>[0]

  function row(respondentName: string | null) {
    return {
      id: 'r1',
      formId: 'form-1',
      ipAddress: null,
      userAgent: null,
      respondentName,
      submittedAt: new Date('2026-10-28T10:00:00.000Z'),
      answers: [{ id: 'a1', responseId: 'r1', fieldId: 'f1', value: 'Depot' }]
    }
  }

  it('puts it in its own column after the date, escaped like any other cell', () => {
    const lines = exportResponsesToCSV(form, [row('Lovelace, Ada'), row(null)]).slice(1).split('\n')

    expect(lines[0]).toBe('"Date Submitted","Declared name","IP Address","Site"')
    expect(lines[1]).toBe('2026-10-28T10:00:00.000Z,"Lovelace, Ada",,Depot')
    expect(lines[2]).toBe('2026-10-28T10:00:00.000Z,,,Depot')
  })
})
