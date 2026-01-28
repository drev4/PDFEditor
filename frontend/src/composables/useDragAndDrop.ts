import { ref, type Ref } from 'vue'
import { useDrawingStore } from '@/stores/drawing.store'
import type { Position, Size } from '@/types/common'

export interface DragState {
  isDragging: Ref<boolean>
  isResizing: Ref<boolean>
  dragStartX: Ref<number>
  dragStartY: Ref<number>
  elementStartX: Ref<number>
  elementStartY: Ref<number>
  resizeHandle: Ref<string | null>
  resizeStartX: Ref<number>
  resizeStartY: Ref<number>
  elementStartWidth: Ref<number>
  elementStartHeight: Ref<number>
}

export interface DragCallbacks {
  onUpdatePosition: (x: number, y: number) => void
  onUpdateSize?: (width: number, height: number, x: number, y: number) => void
  getElementPosition: () => Position
  getElementSize?: () => Size
  getMaintainAspectRatio?: () => boolean
}

export function useDragAndDrop(callbacks: DragCallbacks): DragState & {
  startDrag: (event: MouseEvent) => void
  startResize: (event: MouseEvent, handle: string) => void
  stopDrag: () => void
  stopResize: () => void
} {
  const drawingStore = useDrawingStore()

  // State
  const isDragging = ref(false)
  const isResizing = ref(false)
  const dragStartX = ref(0)
  const dragStartY = ref(0)
  const elementStartX = ref(0)
  const elementStartY = ref(0)
  const resizeHandle = ref<string | null>(null)
  const resizeStartX = ref(0)
  const resizeStartY = ref(0)
  const elementStartWidth = ref(0)
  const elementStartHeight = ref(0)

  const snapToGridValue = (value: number): number => {
    if (!drawingStore.snapToGrid) return value
    return Math.round(value / drawingStore.gridSize) * drawingStore.gridSize
  }

  const startDrag = (event: MouseEvent) => {
    isDragging.value = true
    dragStartX.value = event.clientX
    dragStartY.value = event.clientY
    
    const pos = callbacks.getElementPosition()
    elementStartX.value = pos.x
    elementStartY.value = pos.y

    document.addEventListener('mousemove', onDrag)
    document.addEventListener('mouseup', stopDrag)
    event.preventDefault()
  }

  const onDrag = (event: MouseEvent) => {
    if (!isDragging.value) return

    const deltaX = event.clientX - dragStartX.value
    const deltaY = event.clientY - dragStartY.value

    let newX = elementStartX.value + deltaX
    let newY = elementStartY.value + deltaY

    // Apply snap to grid
    newX = snapToGridValue(newX)
    newY = snapToGridValue(newY)

    callbacks.onUpdatePosition(newX, newY)
  }

  const stopDrag = () => {
    isDragging.value = false
    document.removeEventListener('mousemove', onDrag)
    document.removeEventListener('mouseup', stopDrag)
  }

  const startResize = (event: MouseEvent, handle: string) => {
    if (!callbacks.getElementSize) return

    isResizing.value = true
    resizeHandle.value = handle
    resizeStartX.value = event.clientX
    resizeStartY.value = event.clientY
    
    const pos = callbacks.getElementPosition()
    const size = callbacks.getElementSize()
    
    elementStartX.value = pos.x
    elementStartY.value = pos.y
    elementStartWidth.value = size.width
    elementStartHeight.value = size.height

    document.addEventListener('mousemove', onResize)
    document.addEventListener('mouseup', stopResize)
    event.preventDefault()
  }

  const onResize = (event: MouseEvent) => {
    if (!isResizing.value || !callbacks.getElementSize || !callbacks.onUpdateSize) return

    const deltaX = event.clientX - resizeStartX.value
    const deltaY = event.clientY - resizeStartY.value

    let newWidth = elementStartWidth.value
    let newHeight = elementStartHeight.value
    let newX = elementStartX.value
    let newY = elementStartY.value

    // Calculate aspect ratio
    const aspectRatio = elementStartWidth.value / elementStartHeight.value
    const maintainAspectRatio = callbacks.getMaintainAspectRatio?.() ?? false

    if (maintainAspectRatio) {
      // Maintain aspect ratio - use the larger delta
      const handle = resizeHandle.value!
      const newWidthValue = Math.max(50, 
        handle.includes('e') ? elementStartWidth.value + deltaX : 
        handle.includes('w') ? elementStartWidth.value - deltaX : 
        elementStartWidth.value
      )
      
      newWidth = newWidthValue
      newHeight = newWidthValue / aspectRatio

      // Adjust position based on handle
      if (handle.includes('w')) {
        newX = elementStartX.value + (elementStartWidth.value - newWidth)
      }
      if (handle.includes('n')) {
        newY = elementStartY.value + (elementStartHeight.value - newHeight)
      }
    } else {
      // Free resize
      switch (resizeHandle.value) {
        case 'se': // Bottom-right corner
          newWidth = Math.max(50, elementStartWidth.value + deltaX)
          newHeight = Math.max(50, elementStartHeight.value + deltaY)
          break
        case 'sw': // Bottom-left corner
          newWidth = Math.max(50, elementStartWidth.value - deltaX)
          newHeight = Math.max(50, elementStartHeight.value + deltaY)
          newX = elementStartX.value + (elementStartWidth.value - newWidth)
          break
        case 'ne': // Top-right corner
          newWidth = Math.max(50, elementStartWidth.value + deltaX)
          newHeight = Math.max(50, elementStartHeight.value - deltaY)
          newY = elementStartY.value + (elementStartHeight.value - newHeight)
          break
        case 'nw': // Top-left corner
          newWidth = Math.max(50, elementStartWidth.value - deltaX)
          newHeight = Math.max(50, elementStartHeight.value - deltaY)
          newX = elementStartX.value + (elementStartWidth.value - newWidth)
          newY = elementStartY.value + (elementStartHeight.value - newHeight)
          break
      }
    }

    // Apply snap to grid
    newWidth = snapToGridValue(newWidth)
    newHeight = snapToGridValue(newHeight)
    newX = snapToGridValue(newX)
    newY = snapToGridValue(newY)

    callbacks.onUpdateSize(newWidth, newHeight, newX, newY)
  }

  const stopResize = () => {
    isResizing.value = false
    resizeHandle.value = null
    document.removeEventListener('mousemove', onResize)
    document.removeEventListener('mouseup', stopResize)
  }

  return {
    // State
    isDragging,
    isResizing,
    dragStartX,
    dragStartY,
    elementStartX,
    elementStartY,
    resizeHandle,
    resizeStartX,
    resizeStartY,
    elementStartWidth,
    elementStartHeight,
    
    // Actions
    startDrag,
    startResize,
    stopDrag,
    stopResize
  }
}