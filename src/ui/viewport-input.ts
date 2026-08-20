import { Viewport } from '../core/viewport.ts';

/**
 * Pointer and wheel handling for one panel.
 *
 * Wheel deltas are converted to a change in `z`, not in scale, so the geometric
 * zoom curve does the work and one notch always feels the same regardless of
 * how far in you already are.
 */

const WHEEL_PIXEL = 0.0022;
const WHEEL_LINE = 0.035;
const WHEEL_PAGE = 0.35;
const PINCH_KEY = 0.012;

export interface ViewportInputHost {
  readonly viewport: Viewport;
  indexOf(element: HTMLElement): number;
  onInteractionStart(): void;
  onInteractionEnd(): void;
}

export function attachViewportInput(element: HTMLElement, host: ViewportInputHost): () => void {
  const pointers = new Map<number, { x: number; y: number }>();
  let dragging = false;
  let pinchDistance = 0;
  let lastX = 0;
  let lastY = 0;

  const local = (event: { clientX: number; clientY: number }) => {
    const rect = element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? WHEEL_LINE : event.deltaMode === 2 ? WHEEL_PAGE : WHEEL_PIXEL;
    // Trackpad pinch arrives as ctrl+wheel and should feel stronger.
    const gain = event.ctrlKey ? 2.5 : 1;
    host.viewport.zoomBy(-event.deltaY * unit * gain, host.indexOf(element), local(event));
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    // Otherwise the browser starts a text selection or an image drag instead.
    event.preventDefault();
    element.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 2) {
      pinchDistance = distance(pointers);
      dragging = false;
    } else {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      element.classList.add('is-dragging');
      host.onInteractionStart();
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const index = host.indexOf(element);

    if (pointers.size >= 2) {
      const next = distance(pointers);
      if (pinchDistance > 0 && next > 0) {
        const centre = centroid(pointers);
        const rect = element.getBoundingClientRect();
        host.viewport.zoomBy(Math.log2(next / pinchDistance) * PINCH_KEY * 40, index, {
          x: centre.x - rect.left,
          y: centre.y - rect.top,
        });
      }
      pinchDistance = next;
      return;
    }

    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    host.viewport.pan(dx, dy, index);
  };

  const endPointer = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
    if (pointers.size < 2) pinchDistance = 0;
    if (pointers.size === 0 && dragging) {
      dragging = false;
      element.classList.remove('is-dragging');
      host.onInteractionEnd();
    }
  };

  const onDoubleClick = (event: MouseEvent) => {
    event.preventDefault();
    host.viewport.toggleFit(host.indexOf(element), local(event));
  };

  element.addEventListener('wheel', onWheel, { passive: false });
  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', endPointer);
  element.addEventListener('pointercancel', endPointer);
  element.addEventListener('dblclick', onDoubleClick);

  return () => {
    element.removeEventListener('wheel', onWheel);
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', endPointer);
    element.removeEventListener('pointercancel', endPointer);
    element.removeEventListener('dblclick', onDoubleClick);
  };
}

function distance(pointers: Map<number, { x: number; y: number }>): number {
  const [a, b] = [...pointers.values()];
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function centroid(pointers: Map<number, { x: number; y: number }>): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const p of pointers.values()) {
    x += p.x;
    y += p.y;
  }
  const n = Math.max(1, pointers.size);
  return { x: x / n, y: y / n };
}
