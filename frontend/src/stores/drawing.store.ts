import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useDrawingStore = defineStore('drawing', () => {
  // State
  const gridEnabled = ref(false)
  const gridSize = ref(20)
  const snapToGrid = ref(false)
  const activeDrawingTool = ref<string | null>('cursor')
  const drawingToolbarPosition = ref({ x: 80, y: 150 })

  // Actions
  const toggleGrid = () => {
    gridEnabled.value = !gridEnabled.value
  }

  const toggleSnapToGrid = () => {
    snapToGrid.value = !snapToGrid.value
  }

  const setActiveDrawingTool = (toolId: string | null) => {
    activeDrawingTool.value = toolId
  }

  const updateDrawingToolbarPosition = (position: { x: number, y: number }) => {
    drawingToolbarPosition.value = position
  }

  return {
    // State
    gridEnabled,
    gridSize,
    snapToGrid,
    activeDrawingTool,
    drawingToolbarPosition,

    // Actions
    toggleGrid,
    toggleSnapToGrid,
    setActiveDrawingTool,
    updateDrawingToolbarPosition
  }
}, {
  persist: false
})
