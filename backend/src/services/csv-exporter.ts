import type { Field, Form, Answer } from '@prisma/client'

interface ResponseWithAnswers {
  id: string
  formId: string
  ipAddress: string | null
  userAgent: string | null
  submittedAt: Date
  answers: Answer[]
}

function escapeCsvValue(val: string): string {
  if (val.includes('"') || val.includes(',') || val.includes('\n') || val.includes('\r')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}

export function exportResponsesToCSV(
  form: Form & { fields: Field[] },
  responses: ResponseWithAnswers[]
): string {
  const headers = ['Date Submitted', 'IP Address', ...form.fields.map(f => f.label || f.name)]

  const csvRows = responses.map(resp => {
    const date = resp.submittedAt.toISOString()
    const ip = resp.ipAddress || ''
    const answers = form.fields.map(field => {
      const ans = resp.answers.find(a => a.fieldId === field.id)
      return ans ? escapeCsvValue(String(ans.value)) : ''
    })
    return [date, ip, ...answers].join(',')
  })

  const headerRow = headers.map(h => `"${h.replace(/"/g, '""')}"`).join(',')
  return '\uFEFF' + [headerRow, ...csvRows].join('\n')
}
