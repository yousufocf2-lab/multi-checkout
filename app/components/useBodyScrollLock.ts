import { useEffect } from "react";

// One shared lock for every sheet/modal/menu. Counting the open ones means two overlapping locks
// can't leave the page frozen (the old version could restore another lock's "locked" styles,
// so the page stayed stuck with touch disabled until a reload).
let count = 0;
let saved: { y: number; position: string; top: string; width: string; overflow: string; touch: string; overscroll: string } | null = null;

function lock() {
  count++;
  if (count > 1) return;
  const body = document.body;
  const html = document.documentElement;
  const y = window.scrollY;
  saved = { y, position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow, touch: body.style.touchAction, overscroll: html.style.overscrollBehavior };
  body.style.position = "fixed";
  body.style.top = `-${y}px`;
  body.style.width = "100%";
  body.style.overflow = "hidden";
  body.style.touchAction = "none";
  html.style.overscrollBehavior = "none";
}

function unlock() {
  count = Math.max(0, count - 1);
  if (count > 0 || !saved) return;
  const body = document.body;
  const html = document.documentElement;
  const s = saved;
  saved = null;
  body.style.position = s.position; body.style.top = s.top; body.style.width = s.width;
  body.style.overflow = s.overflow; body.style.touchAction = s.touch; html.style.overscrollBehavior = s.overscroll;
  window.scrollTo(0, s.y);
}

/** Lock the document behind a mobile sheet/modal, including iOS Safari's body scrolling. */
export function useBodyScrollLock(open: boolean) {
  useEffect(() => {
    if (!open) return;
    lock();
    return unlock;
  }, [open]);
}
