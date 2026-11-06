import { useEffect } from "react";

/** Lock the document behind a mobile sheet/modal, including iOS Safari's body scrolling. */
export function useBodyScrollLock(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const y = window.scrollY;
    const body = document.body;
    const html = document.documentElement;
    const old = { position: body.style.position, top: body.style.top, width: body.style.width, overflow: body.style.overflow, touch: body.style.touchAction, overscroll: html.style.overscrollBehavior };
    body.style.position = "fixed";
    body.style.top = `-${y}px`;
    body.style.width = "100%";
    body.style.overflow = "hidden";
    body.style.touchAction = "none";
    html.style.overscrollBehavior = "none";
    return () => {
      body.style.position = old.position; body.style.top = old.top; body.style.width = old.width;
      body.style.overflow = old.overflow; body.style.touchAction = old.touch; html.style.overscrollBehavior = old.overscroll;
      window.scrollTo(0, y);
    };
  }, [open]);
}
