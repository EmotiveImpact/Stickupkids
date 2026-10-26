// The part of the window the game can use. Usually that is all of it, but some
// viewers put the page in a frame taller or wider than the screen, which leaves
// the bottom of the HUD off screen. In a frame we watch how much of it shows
// and shrink the game to that, anchored top left.

let shown: { w: number; h: number } | null = null;

/** The usable width and height, in CSS pixels. */
export const fit = {
  get w() {
    return shown ? Math.min(innerWidth, shown.w) : innerWidth;
  },
  get h() {
    return shown ? Math.min(innerHeight, shown.h) : innerHeight;
  },
};

export function watchFit() {
  if (window.top === window || typeof IntersectionObserver === 'undefined') return;
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;pointer-events:none;opacity:0';
  document.body.append(probe);
  // Fine steps, so scrolling the frame keeps the size close.
  const threshold = Array.from({ length: 201 }, (_, i) => i / 200);
  new IntersectionObserver(
    (entries) => {
      const r = entries[entries.length - 1].intersectionRect;
      const w = Math.floor(r.right);
      const h = Math.floor(r.bottom);
      // Too little showing means the frame is scrolled away, not that it is small: leave it.
      const cut = r.width >= 320 && r.height >= 240 && (innerWidth - w > 4 || innerHeight - h > 4);
      const next = cut ? { w, h } : null;
      if (next?.w === shown?.w && next?.h === shown?.h) return;
      shown = next;
      const s = document.documentElement.style;
      if (shown) {
        s.setProperty('--fit-w', `${shown.w}px`);
        s.setProperty('--fit-h', `${shown.h}px`);
      } else {
        s.removeProperty('--fit-w');
        s.removeProperty('--fit-h');
      }
      dispatchEvent(new Event('resize'));
    },
    { threshold },
  ).observe(probe);
}
