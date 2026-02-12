<script setup lang="ts">
import { onUnmounted } from "vue";

type WindowBounds = { x: number; y: number; width: number; height: number };
type Edge = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

type ResizeState =
  | {
      edge: Edge;
      startX: number;
      startY: number;
      startBounds: WindowBounds;
      minW: number;
      minH: number;
    }
  | null;

let activeEdge: Edge | null = null;
let startX = 0;
let startY = 0;
let startBounds: WindowBounds | null = null;
let minW = 0;
let minH = 0;
let captureEl: HTMLElement | null = null;
let capturePointerId: number | null = null;
let state: ResizeState = null;

let rafId: number | null = null;
let pending: WindowBounds | null = null;

const FALLBACK_MIN_W = 160;
const FALLBACK_MIN_H = 120;

const clamp = (value: number, min: number) => Math.max(min, value);

const applyPending = () => {
  rafId = null;
  if (!pending) return;
  const b = pending;
  pending = null;
  window.riverside?.window.setBounds?.(b);
};

const scheduleApply = (b: WindowBounds) => {
  pending = b;
  if (rafId != null) return;
  rafId = window.requestAnimationFrame(applyPending);
};

const stopResize = () => {
  state = null;
  activeEdge = null;
  startBounds = null;
  window.removeEventListener("pointermove", onMove, true);
  window.removeEventListener("pointerup", onUp, true);
  window.removeEventListener("pointercancel", onUp, true);
  try {
    if (captureEl && capturePointerId != null) {
      captureEl.releasePointerCapture?.(capturePointerId);
    }
  } catch {
    // ignore
  }
  captureEl = null;
  capturePointerId = null;
  if (pending) {
    try {
      window.riverside?.window.setBounds?.(pending);
    } catch {
      // ignore
    }
  }
  if (rafId != null) window.cancelAnimationFrame(rafId);
  rafId = null;
  pending = null;
};

const onUp = () => stopResize();

const onMove = (ev: PointerEvent) => {
  const cur = state;
  if (!cur) return;

  const dx = ev.screenX - cur.startX;
  const dy = ev.screenY - cur.startY;

  let x = cur.startBounds.x;
  let y = cur.startBounds.y;
  let width = cur.startBounds.width;
  let height = cur.startBounds.height;

  if (cur.edge.includes("e")) {
    width = clamp(cur.startBounds.width + dx, cur.minW);
  }
  if (cur.edge.includes("s")) {
    height = clamp(cur.startBounds.height + dy, cur.minH);
  }
  if (cur.edge.includes("w")) {
    const next = clamp(cur.startBounds.width - dx, cur.minW);
    x = cur.startBounds.x + (cur.startBounds.width - next);
    width = next;
  }
  if (cur.edge.includes("n")) {
    const next = clamp(cur.startBounds.height - dy, cur.minH);
    y = cur.startBounds.y + (cur.startBounds.height - next);
    height = next;
  }

  scheduleApply({
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
  });
};

const startResize = async (edge: Edge, ev: PointerEvent) => {
  ev.preventDefault();
  ev.stopPropagation();

  stopResize();

  const initialX = ev.screenX;
  const initialY = ev.screenY;

  const el = ev.currentTarget as HTMLElement | null;
  if (el && typeof ev.pointerId === "number") {
    try {
      el.setPointerCapture?.(ev.pointerId);
      captureEl = el;
      capturePointerId = ev.pointerId;
    } catch {
      captureEl = null;
      capturePointerId = null;
    }
  }

  window.addEventListener("pointermove", onMove, true);
  window.addEventListener("pointerup", onUp, true);
  window.addEventListener("pointercancel", onUp, true);

  const [bounds, minSize] = await Promise.all([
    window.riverside?.window.getBounds?.(),
    window.riverside?.window.getMinSize?.(),
  ]);
  if (!bounds) {
    stopResize();
    return;
  }

  const w = Array.isArray(minSize) ? Number(minSize[0] || 0) : 0;
  const h = Array.isArray(minSize) ? Number(minSize[1] || 0) : 0;

  let nextMinW = Number.isFinite(w) && w > 0 ? w : FALLBACK_MIN_W;
  let nextMinH = Number.isFinite(h) && h > 0 ? h : FALLBACK_MIN_H;

  if (nextMinW >= bounds.width) nextMinW = FALLBACK_MIN_W;
  if (nextMinH >= bounds.height) nextMinH = FALLBACK_MIN_H;

  activeEdge = edge;
  startX = initialX;
  startY = initialY;
  startBounds = bounds;
  minW = nextMinW;
  minH = nextMinH;

  state = {
    edge,
    startX: initialX,
    startY: initialY,
    startBounds: bounds,
    minW: nextMinW,
    minH: nextMinH,
  };
};

onUnmounted(() => stopResize());
</script>

<template>
  <div class="pointer-events-none absolute inset-0 z-[90]">
    <div
      class="pointer-events-auto no-drag absolute left-0 top-0 h-3 w-3 cursor-nwse-resize"
      @pointerdown="(e) => startResize('nw', e)"
    />
    <div
      class="pointer-events-auto no-drag absolute right-0 top-0 h-3 w-3 cursor-nesw-resize"
      @pointerdown="(e) => startResize('ne', e)"
    />
    <div
      class="pointer-events-auto no-drag absolute left-0 bottom-0 h-3 w-3 cursor-nesw-resize"
      @pointerdown="(e) => startResize('sw', e)"
    />
    <div
      class="pointer-events-auto no-drag absolute right-0 bottom-0 h-3 w-3 cursor-nwse-resize"
      @pointerdown="(e) => startResize('se', e)"
    />

    <div
      class="pointer-events-auto no-drag absolute left-3 right-3 top-0 h-2 cursor-ns-resize"
      @pointerdown="(e) => startResize('n', e)"
    />
    <div
      class="pointer-events-auto no-drag absolute left-3 right-3 bottom-0 h-2 cursor-ns-resize"
      @pointerdown="(e) => startResize('s', e)"
    />
    <div
      class="pointer-events-auto no-drag absolute top-3 bottom-3 left-0 w-2 cursor-ew-resize"
      @pointerdown="(e) => startResize('w', e)"
    />
    <div
      class="pointer-events-auto no-drag absolute top-3 bottom-3 right-0 w-2 cursor-ew-resize"
      @pointerdown="(e) => startResize('e', e)"
    />
  </div>
</template>
