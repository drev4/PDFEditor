import type { Ref } from 'vue'
import { useDocumentStore } from '@/stores/document.store'
import { useSearchStore } from '@/stores/search.store'
import type { PDFDocumentProxy, PDFPageViewport, PDFPageTextItem } from '@/types/pdfjs'

interface SearchMatch {
  pageIndex: number
  textIndex: number
  text: string
  bounds: {
    x: number
    y: number
    width: number
    height: number
  }
}

export function usePDFSearch(
  pdfDoc: Ref<PDFDocumentProxy | null>,
  canvasRef: Ref<HTMLCanvasElement | null>,
  searchCanvasRef: Ref<HTMLCanvasElement | null>
) {
  const documentStore = useDocumentStore()
  const searchStore = useSearchStore()

  const searchTextInPDF = async () => {
    if (!pdfDoc.value || !searchStore.searchQuery) {
      searchStore.setSearchMatches([])
      searchStore.setIsSearching(false)
      return
    }

    try {
      const matches: SearchMatch[] = []
      const query = searchStore.searchQuery.toLowerCase()

      for (let pageNum = 1; pageNum <= pdfDoc.value.numPages; pageNum++) {
        const page = await pdfDoc.value.getPage(pageNum)
        const textContent = await page.getTextContent()
        const viewport = page.getViewport({ scale: 1.0 })

        textContent.items.forEach((item: PDFPageTextItem) => {
          const text = item.str.toLowerCase()
          if (text.includes(query)) {
            const fontSize = Math.sqrt(
              (item.transform[2] * item.transform[2]) +
              (item.transform[3] * item.transform[3])
            )

            matches.push({
              pageIndex: pageNum - 1,
              textIndex: matches.length,
              text: item.str,
              bounds: {
                x: item.transform[4],
                y: viewport.height - item.transform[5] - fontSize,
                width: item.width,
                height: fontSize
              }
            })
          }
        })
      }

      searchStore.setSearchMatches(matches)
      searchStore.setIsSearching(false)
      await drawSearchHighlights()
    } catch (error) {
      console.error('Error searching text:', error)
      searchStore.setIsSearching(false)
    }
  }

  const drawSearchHighlights = async () => {
    if (!searchCanvasRef.value || !canvasRef.value || !documentStore.activeDocument) return

    const searchCanvas = searchCanvasRef.value
    const mainCanvas = canvasRef.value

    searchCanvas.width = mainCanvas.width
    searchCanvas.height = mainCanvas.height

    const ctx = searchCanvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, searchCanvas.width, searchCanvas.height)

    const currentPage = documentStore.activeDocument.currentPage - 1
    const currentPageMatches = searchStore.searchMatches.filter(
      (match: SearchMatch) => match.pageIndex === currentPage
    )

    if (!pdfDoc.value) return

    const currentScale = documentStore.activeDocument.scale

    currentPageMatches.forEach((match: SearchMatch) => {
      const isCurrentMatch = searchStore.searchMatches.indexOf(match) === searchStore.currentMatchIndex

      ctx.fillStyle = isCurrentMatch ? 'rgba(255, 165, 0, 0.4)' : 'rgba(255, 255, 0, 0.3)'

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
