type Handler = (event: never) => void;
type AttrValue = string | number | boolean | null | undefined | Handler;
type Child = Node | string | number | null | undefined | false;

const SVG_NS = 'http://www.w3.org/2000/svg';

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, AttrValue> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) continue;
    if (typeof value === 'function') element.addEventListener(name.slice(2).toLowerCase(), value as EventListener);
    else if (name === 'class') element.className = String(value);
    else if (value === true) element.setAttribute(name, '');
    else element.setAttribute(name, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : String(child));
  }
  return element;
}

export function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number> = {},
  ...children: SVGElement[]
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, String(value));
  element.append(...children);
  return element;
}

const ICONS: Record<string, string[]> = {
  settings: ['M4 7h9', 'M17 7h3', 'M4 17h3', 'M11 17h9', 'M15 5v4', 'M9 15v4'],
  notebook: ['M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7z', 'M7 3v18', 'M4 7h3', 'M4 12h3', 'M4 17h3', 'M11 8h5', 'M11 12h5'],
  lock: ['M6 11h12v10H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
  unlock: ['M6 11h12v10H6z', 'M8.5 11V8a3.5 3.5 0 0 1 6.8-1.2'],
  plus: ['M12 5v14', 'M5 12h14'],
  trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
  up: ['M12 19V5', 'M6 11l6-6 6 6'],
  down: ['M12 5v14', 'M6 13l6 6 6-6'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  back: ['M19 12H5', 'M11 6l-6 6 6 6'],
  check: ['M5 12.5l4.5 4.5L19 7'],
  text: ['M5 7V5h14v2', 'M12 5v14', 'M9 19h6'],
  video: ['M3 6h18v12H3z', 'M10 9.5v5l4.5-2.5z'],
  photo: ['M3 5h18v14H3z', 'M3 16l5-5 4 4 3-3 6 6', 'M15.5 9.5h.01'],
  link: ['M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1', 'M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1'],
  download: ['M12 4v11', 'M7 10l5 5 5-5', 'M5 20h14'],
  upload: ['M12 20V9', 'M7 14l5-5 5 5', 'M5 4h14'],
  shield: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z', 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z']
};

export function icon(name: keyof typeof ICONS): SVGSVGElement {
  const paths = ICONS[name] ?? [];
  return svg(
    'svg',
    {
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 1.9,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
      class: 'icon'
    },
    ...paths.map((d) => svg('path', { d }))
  );
}

export interface Shield {
  root: SVGSVGElement;
  set(fraction: number): void;
  raise(fraction: number): void;
}

export function createShield(count = 36, label = 'Focus timer'): Shield {
  const studs: SVGCircleElement[] = [];
  const studGroup = svg('g', { class: 'studs' });
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
    const stud = svg('circle', {
      cx: (100 + 75 * Math.cos(angle)).toFixed(2),
      cy: (100 + 75 * Math.sin(angle)).toFixed(2),
      r: count > 30 ? 3.6 : 4.6,
      class: 'stud'
    });
    stud.style.setProperty('--i', String(i));
    studs.push(stud);
    studGroup.append(stud);
  }
  const root = svg(
    'svg',
    { viewBox: '0 0 200 200', class: 'shield', role: 'img', 'aria-label': label },
    svg('circle', { cx: 100, cy: 100, r: 98, class: 'rim' }),
    svg('circle', { cx: 100, cy: 100, r: 89, class: 'field' }),
    svg('circle', { cx: 100, cy: 100, r: 89, class: 'edge' }),
    studGroup,
    svg('circle', { cx: 100, cy: 100, r: 62, class: 'inner' })
  );

  function set(fraction: number): void {
    const lit = fraction <= 0 ? 0 : Math.ceil(Math.min(1, fraction) * count);
    studs.forEach((stud, index) => stud.classList.toggle('is-lit', index >= count - lit));
  }

  function raise(fraction: number): void {
    set(0);
    root.classList.add('raising');
    requestAnimationFrame(() => {
      requestAnimationFrame(() => set(fraction));
    });
    window.setTimeout(() => root.classList.remove('raising'), count * 24 + 600);
  }

  return { root, set, raise };
}

export function sessionFraction(session: { startedAt: number; endsAt: number } | null, now = Date.now()): number {
  if (!session) return 0;
  const total = session.endsAt - session.startedAt;
  return total > 0 ? Math.max(0, Math.min(1, (session.endsAt - now) / total)) : 0;
}

export function setMessage(target: HTMLElement | null, text: string, kind: 'error' | 'ok' | 'info' = 'info'): void {
  if (!target) return;
  target.textContent = text;
  target.classList.toggle('is-error', kind === 'error');
  target.classList.toggle('is-ok', kind === 'ok');
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export function everySecond(callback: () => void): void {
  const tick = (): void => {
    callback();
    window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
  };
  window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
}

export function onStorageChange(callback: (keys: Set<string>) => void): void {
  let timer: number | undefined;
  let pending = new Set<string>();
  chrome.storage.onChanged.addListener((changes) => {
    for (const key of Object.keys(changes)) pending.add(key);
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      const keys = pending;
      pending = new Set();
      callback(keys);
    }, 60);
  });
}

export async function openExtensionPage(path: string): Promise<void> {
  await chrome.tabs.create({ url: chrome.runtime.getURL(path) });
}
