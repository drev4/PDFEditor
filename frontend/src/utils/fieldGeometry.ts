/**
 * Align and distribute, as geometry (features/0048).
 *
 * Everything here works in **stored** coordinates — the upright, base-scale
 * space `pdfFieldEmbedder` writes against — and never in screen pixels. That is
 * why nothing in this file knows about rotation, zoom or the canvas: a caller
 * that has a screen rectangle has to map it back first (`utils/pdfCoordinates.ts`),
 * and the editor's callers refuse the operation on a turned page instead.
 *
 * Pure on purpose. These are the easiest thing in the whole change to get
 * subtly wrong and the easiest to test, so they are kept apart from any store.
 */

export interface Rect {
  id: string
  x: number
  y: number
  width: number
  height: number
}

/** Where a field ends up. Only the corner moves; nothing here resizes. */
export interface Placement {
  id: string
  x: number
  y: number
}

export type AlignMode = 'left' | 'right' | 'top' | 'bottom' | 'center-x' | 'center-y'
export type DistributeAxis = 'horizontal' | 'vertical'

const place = (rect: Rect, x: number, y: number): Placement => ({ id: rect.id, x, y })

/**
 * Aligns two or more fields against the bounding box of the set.
 *
 * Note that `right` and `bottom` align **edges**, not corners: the widest field
 * usually starts furthest left and still reaches furthest right, so aligning on
 * `x` alone would move the one field the author was aligning everything to.
 */
export function alignRects(rects: Rect[], mode: AlignMode): Placement[] {
  if (rects.length < 2) return []

  const left = Math.min(...rects.map(r => r.x))
  const right = Math.max(...rects.map(r => r.x + r.width))
  const top = Math.min(...rects.map(r => r.y))
  const bottom = Math.max(...rects.map(r => r.y + r.height))
  const centreX = (left + right) / 2
  const centreY = (top + bottom) / 2

  return rects.map(rect => {
    switch (mode) {
      case 'left': return place(rect, left, rect.y)
      case 'right': return place(rect, right - rect.width, rect.y)
      case 'top': return place(rect, rect.x, top)
      case 'bottom': return place(rect, rect.x, bottom - rect.height)
      case 'center-x': return place(rect, centreX - rect.width / 2, rect.y)
      case 'center-y': return place(rect, rect.x, centreY - rect.height / 2)
    }
  })
}

/**
 * Spaces the centres of three or more fields evenly.
 *
 * The two outermost fields stay exactly where they are — they are the span the
 * author already chose — and everything between them is redistributed along it.
 * Centres rather than gaps, because fields of different widths distributed by
 * gap look wrong to the eye that put them there.
 */
export function distributeRects(rects: Rect[], axis: DistributeAxis): Placement[] {
  if (rects.length < 3) return []

  const centre = (rect: Rect) =>
    axis === 'horizontal' ? rect.x + rect.width / 2 : rect.y + rect.height / 2

  const ordered = [...rects].sort((a, b) => centre(a) - centre(b))
  const first = ordered[0]!
  const last = ordered[ordered.length - 1]!
  const step = (centre(last) - centre(first)) / (ordered.length - 1)

  return ordered.map((rect, index) => {
    const target = centre(first) + step * index
    return axis === 'horizontal'
      ? place(rect, target - rect.width / 2, rect.y)
      : place(rect, rect.x, target - rect.height / 2)
  })
}
