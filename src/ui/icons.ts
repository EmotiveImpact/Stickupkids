// White line icons, 2px stroke, per the style guide.

const svg = (body: string, size = 24) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS = {
  boot: svg('<path d="M7 3h5v8l6 2.5c1.6.7 2.5 2 2.5 3.5V19H4v-3l3-2z"/><path d="M4 19v2h16.5v-2"/>'),
  undo: svg('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  clear: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  pause: svg('<path d="M9 5v14M15 5v14"/>'),
  play: svg('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>'),
  fast: svg('<path d="M4 6v12l8-6zM12 6v12l8-6z" fill="currentColor"/>'),
  car: svg('<path d="M5 16V11l2-5h10l2 5v5"/><path d="M3 16h18v3H3z"/><circle cx="7.5" cy="16.5" r="1"/><circle cx="16.5" cy="16.5" r="1"/><path d="M5 11h14"/>'),
  siren: svg('<path d="M7 18v-6a5 5 0 0 1 10 0v6"/><path d="M5 18h14v3H5z"/><path d="M12 2v2M4.2 5.2l1.4 1.4M19.8 5.2l-1.4 1.4"/>'),
  phone: svg('<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2"/>'),
  cash: svg('<path d="M3 8h18v10H3z"/><circle cx="12" cy="13" r="2.5"/><path d="M5 5h14M6 21h12"/>'),
  noise: svg('<path d="M2 12h2M6 8v8M10 5v14M14 8v8M18 10v4M22 12h0"/>'),
  bag: svg('<path d="M6 8h12l1.5 12h-15z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  home: svg('<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'),
  redo: svg('<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7"/><path d="M12 17h0"/>'),
  star: svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>'),
  starFill: svg('<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor"/>'),
  mask: svg('<path d="M12 3a8 8 0 0 0-8 8v4a8 8 0 0 0 16 0v-4a8 8 0 0 0-8-8z"/><path d="M7 11h10v3H7z"/>'),
  crew: svg('<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20a6 6 0 0 1 12 0M14 20a4.5 4.5 0 0 1 8 0"/>'),
};

/** A crew member's portrait (made with ChatGPT; masters in art/portraits/). */
export function portrait(name: string): string {
  return `<img class="portrait" src="portraits/${name.toLowerCase()}.jpg" alt="${name}" draggable="false" />`;
}
