/** Arms a one-shot capture-phase `click` listener that swallows the very
 *  next click anywhere in the document — used to suppress the trailing
 *  click a `mouseup` always fires after a drag that ended over a different
 *  element than it started on, where a same-element `onClick` flag check
 *  can't intercept it (the click never reaches that element's handler at
 *  all — see `useColumnOrder`'s module comment for the full explanation). */
export function suppressNextClick(): void {
  window.addEventListener(
    "click",
    (ev) => {
      ev.stopPropagation();
      ev.preventDefault();
    },
    { capture: true, once: true },
  );
}
