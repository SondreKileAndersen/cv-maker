import { PointerEvent, useRef, useState } from 'react';

export type DragPreview = { id: string; left: number; top: number; width: number; height: number };

export function usePointerSort(ids: string[], onMove: (from: number, to: number) => void) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const activeId = useRef<string | null>(null);
  const pointerOffsetY = useRef(0);
  const dragHeight = useRef(0);
  const rowElements = useRef(new Map<string, HTMLElement>());

  function getRowRef(id: string) {
    return (element: HTMLElement | null) => {
      if (element) rowElements.current.set(id, element);
      else rowElements.current.delete(id);
    };
  }

  function start(id: string, event: PointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const rect = rowElements.current.get(id)?.getBoundingClientRect();
    if (!rect) return;
    activeId.current = id;
    pointerOffsetY.current = event.clientY - rect.top;
    dragHeight.current = rect.height;
    setDraggingId(id);
    setDragPreview({ id, left: rect.left, top: rect.top, width: rect.width, height: rect.height });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent<HTMLButtonElement>) {
    const currentId = activeId.current;
    if (!currentId) return;
    setDragPreview(current => current ? { ...current, top: event.clientY - pointerOffsetY.current } : current);

    const from = ids.indexOf(currentId);
    if (from < 0) return;
    const deadZone = 10;
    const draggedCenterY = event.clientY - pointerOffsetY.current + dragHeight.current / 2;
    const previousId = ids[from - 1];
    const nextId = ids[from + 1];
    const previousRect = previousId ? rowElements.current.get(previousId)?.getBoundingClientRect() : undefined;
    const nextRect = nextId ? rowElements.current.get(nextId)?.getBoundingClientRect() : undefined;

    if (previousRect && draggedCenterY < previousRect.top + previousRect.height / 2 - deadZone) {
      onMove(from, from - 1);
      return;
    }

    if (nextRect && draggedCenterY > nextRect.top + nextRect.height / 2 + deadZone) {
      onMove(from, from + 1);
    }
  }

  function end() {
    activeId.current = null;
    setDraggingId(null);
    setDragPreview(null);
  }

  function handleProps(id: string) {
    return {
      onPointerDown: (event: PointerEvent<HTMLButtonElement>) => start(id, event),
      onPointerMove: (event: PointerEvent<HTMLButtonElement>) => move(event),
      onPointerUp: end,
      onPointerCancel: end
    };
  }

  return { draggingId, dragPreview, getRowRef, handleProps };
}
