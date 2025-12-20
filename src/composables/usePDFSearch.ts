import { usePdfStore } from '@/stores/pdfStore'

export function usePDFSearch(pdfDoc: any, canvasRef: any, searchCanvasRef: any) {
  const pdfStore = usePdfStore()

  const searchTextInPDF = async () => {
    if (!pdfDoc.value || !pdfStore.searchQuery) {
      pdfStore.setSearchMatches([])
      pdfStore.setIsSearching(false)
      return
    }

    try {
      const matches: any[] = []
      const query = pdfStore.searchQuery.toLowerCase()

      // Search in all pages - use scale 1.0 to get base coordinates
      for (let pageNum = 1; pageNum <= pdfDoc.value.numPages; pageNum++) {
        const page = await pdfDoc.value.getPage(pageNum)
        const textContent = await page.getTextContent()
        const viewport = page.getViewport({ scale: 1.0 }) // Base scale

        textContent.items.forEach((item: any) => {
          const text = item.str.toLowerCase()
          if (text.includes(query)) {
            // Calculate font size from transform matrix
            const fontSize = Math.sqrt(
              (item.transform[2] * item.transform[2]) +
              (item.transform[3] * item.transform[3])
            )

            // Get width - use the actual width
            const textWidth = item.width

            // Store coordinates at scale 1.0 (base coordinates)
            matches.push({
              pageIndex: pageNum - 1,
              textIndex: matches.length,
              text: item.str,
              bounds: {
                x: item.transform[4],
                y: viewport.height - item.transform[5] - fontSize,
                width: textWidth,
                height: fontSize
              }
            })
          }
        })
      }

      pdfStore.setSearchMatches(matches)
      pdfStore.setIsSearching(false)

      // Draw highlights for current page
      await drawSearchHighlights()
    } catch (error) {
      console.error('Error searching text:', error)
      pdfStore.setIsSearching(false)
    }
  }

  const drawSearchHighlights = async () => {
    if (!searchCanvasRef.value || !canvasRef.value || !pdfStore.activeDocument) return

    const searchCanvas = searchCanvasRef.value
    const mainCanvas = canvasRef.value

    // Match search canvas size to main canvas
    searchCanvas.width = mainCanvas.width
    searchCanvas.height = mainCanvas.height

    const ctx = searchCanvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, searchCanvas.width, searchCanvas.height)

    // Draw highlights for matches on current page
    const currentPageMatches = pdfStore.searchMatches.filter(
      (match: any) => match.pageIndex === pdfStore.activeDocument!.currentPage - 1
    )

    if (!pdfDoc.value) return

    // Get the current scale to apply to base coordinates
    const currentScale = pdfStore.activeDocument.scale

    currentPageMatches.forEach((match: any) => {
      const isCurrentMatch = pdfStore.searchMatches.indexOf(match) === pdfStore.currentMatchIndex

      // Highlight color: yellow for all matches, orange for current match
      ctx.fillStyle = isCurrentMatch ? 'rgba(255, 165, 0, 0.4)' : 'rgba(255, 255, 0, 0.3)'

      // Apply current scale to base coordinates
      ctx.fillRect(
        match.bounds.x * currentScale,
        match.bounds.y * currentScale,
        match.bounds.width * currentScale,
        match.bounds.height * currentScale
      )
    })
  }

  const clearSearchHighlights = () => {
    if (searchCanvasRef.value) {
      const ctx = searchCanvasRef.value.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, searchCanvasRef.value.width, searchCanvasRef.value.height)
      }
    }
  }

  return {
    searchTextInPDF,
    drawSearchHighlights,
    clearSearchHighlights
  }
}
