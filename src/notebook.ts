import {
  ALIGNS,
  FONTS,
  INKS,
  MAX_IMAGE_BYTES,
  NOTEBOOK_KEY,
  NOTES,
  PAPERS,
  PATTERNS,
  SIZES,
  formatClock,
  formatTime,
  isShortTikTok,
  loadImages,
  loadNotebook,
  newId,
  parseVideo,
  safeLink,
  send,
  type Block,
  type ImageBlock,
  type LinkBlock,
  type Notebook,
  type PublicState,
  type Span,
  type TextBlock,
  type VideoBlock
} from './shared.js';
import { createShield, errorText, everySecond, h, icon, onStorageChange, sessionFraction, setMessage, type Shield } from './ui.js';

type Mode = 'blocked' | 'browser' | 'home';
type SaveStatus = 'saved' | 'saving' | 'error';

interface SegOption {
  label: string;
  title?: string;
  active: boolean;
  className?: string;
  onSelect: () => void;
}

const SETTINGS_KEYS = new Set(['sites', 'blockMode', 'session', 'password', 'protectAlways', 'lockExtensionsPage', 'unlockedUntil']);
const params = new URLSearchParams(location.search);
const blockedUrl = readBlockedUrl();
const mode: Mode = params.get('page') === 'browser' ? 'browser' : blockedUrl ? 'blocked' : 'home';

const topbar = document.getElementById('topbar') as HTMLElement;
const paper = document.getElementById('paper') as HTMLElement;
const blocksEl = document.getElementById('blocks') as HTMLElement;
const inspector = document.getElementById('inspector') as HTMLElement;
const photoInput = document.getElementById('photo-input') as HTMLInputElement;

let state: PublicState | null = null;
let notebook: Notebook;
let images: Record<string, string> = {};
let editing = false;
let selectedId: string | null = null;
let saveTimer: number | undefined;
let dirty = false;
let saveStatus: SaveStatus = 'saved';
let saveError = '';
let topbarNote = '';
let unlocking = false;
let replaceTarget: string | null = null;
let miniShield: Shield | null = null;
let timerText: HTMLElement | null = null;
let detailEl: HTMLElement | null = null;

function readBlockedUrl(): string {
  const raw = location.hash.slice(1);
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function imageIds(book: Notebook): string[] {
  return book.blocks.flatMap((block) => (block.type === 'image' ? [block.imageId] : []));
}

function findBlock(id: string | null): Block | undefined {
  return notebook.blocks.find((block) => block.id === id);
}

function slotFor(id: string): HTMLElement | null {
  return blocksEl.querySelector<HTMLElement>(`.slot[data-id="${CSS.escape(id)}"]`);
}

async function closeTab(): Promise<void> {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id !== undefined) await chrome.tabs.remove(tab.id);
  else window.close();
}

function backToWork(): void {
  if (history.length > 1) history.back();
  else void closeTab();
}

function saveLabel(): string {
  if (saveStatus === 'saving') return 'Saving';
  if (saveStatus === 'error') return saveError || 'Could not save. Your last change is not stored yet.';
  return 'Everything is saved on this computer';
}

function setSaveStatus(status: SaveStatus): void {
  saveStatus = status;
  if (editing && detailEl) detailEl.textContent = saveLabel();
}

function scheduleSave(): void {
  dirty = true;
  setSaveStatus('saving');
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void flush(false), 450);
}

async function flush(cleanup: boolean): Promise<void> {
  window.clearTimeout(saveTimer);
  if (!dirty && !cleanup) return;
  dirty = false;
  try {
    await send('saveNotebook', { notebook, cleanup });
    if (!dirty) setSaveStatus('saved');
  } catch (error) {
    dirty = true;
    saveError = errorText(error);
    setSaveStatus('error');
  }
}

function startEditing(): void {
  if (!state) return;
  if (state.lockReason === 'session') {
    topbarNote = 'You can edit your notebook after this focus session ends.';
    renderTopbar();
    return;
  }
  if (state.lockReason === 'password') {
    unlocking = true;
    topbarNote = '';
    renderTopbar();
    topbar.querySelector<HTMLInputElement>('.topbar-unlock input')?.focus();
    return;
  }
  editing = true;
  selectedId = null;
  unlocking = false;
  topbarNote = '';
  render();
}

async function finishEditing(): Promise<void> {
  await flush(true);
  if (saveStatus === 'error') return;
  editing = false;
  selectedId = null;
  render();
}

function unlockForm(): HTMLElement {
  const input = h('input', { class: 'input', type: 'password', placeholder: 'Password', autocomplete: 'current-password', 'aria-label': 'Password' });
  const button = h('button', { type: 'submit', class: 'btn btn-gilt' }, 'Unlock');
  const msg = h('p', { class: 'msg', role: 'status' });
  return h(
    'form',
    {
      class: 'topbar-unlock',
      onsubmit: async (event: SubmitEvent) => {
        event.preventDefault();
        button.disabled = true;
        try {
          await send('unlock', { password: input.value });
          state = await send('getState', {});
          startEditing();
        } catch (error) {
          setMessage(msg, errorText(error), 'error');
          input.select();
          button.disabled = false;
        }
      }
    },
    input,
    button,
    msg
  );
}

function editButton(primary: boolean): HTMLElement {
  const locked = Boolean(state?.locked);
  return h(
    'button',
    { type: 'button', class: `btn ${primary ? 'btn-gilt' : 'btn-outline'}`, onclick: startEditing },
    icon(locked ? 'lock' : 'text'),
    'Edit notebook'
  );
}

function renderTopbar(): void {
  miniShield = null;
  timerText = null;
  const current = state;
  const mark = h('div', { class: 'topbar-mark' });
  if (current?.session) {
    miniShield = createShield(24, 'Focus session timer');
    miniShield.set(sessionFraction(current.session));
    mark.append(miniShield.root);
  } else {
    mark.append(h('img', { src: 'icons/icon48.png', alt: '' }));
  }

  let title: string;
  detailEl = h('p', { class: 'topbar-detail' });
  const actions: Node[] = [];

  if (editing) {
    title = 'Editing your notebook';
    detailEl.textContent = saveLabel();
    actions.push(h('button', { type: 'button', class: 'btn btn-gilt', onclick: () => void finishEditing() }, icon('check'), 'Done'));
  } else if (mode === 'blocked') {
    title = `You reached for ${hostOf(blockedUrl)}`;
    if (current?.session) {
      timerText = h('span', { class: 'clock' }, formatClock(current.session.endsAt - Date.now()));
      detailEl.append('Shield up for ', timerText, '. Read what you wrote, then get back to it.');
    } else {
      detailEl.textContent = 'Gasha is keeping it closed. Read what you wrote, then get back to it.';
    }
    actions.push(
      h('button', { type: 'button', class: 'btn btn-gilt', onclick: backToWork }, icon('back'), 'Back to work'),
      h('button', { type: 'button', class: 'btn btn-outline', onclick: () => void closeTab() }, 'Close tab'),
      editButton(false)
    );
  } else if (mode === 'browser') {
    title = "Chrome's extensions page is locked";
    detailEl.textContent = current?.session
      ? `It opens again when your focus session ends at ${formatTime(current.session.endsAt)}.`
      : 'It opens again when Gasha is unlocked.';
    actions.push(
      h('button', { type: 'button', class: 'btn btn-gilt', onclick: backToWork }, icon('back'), 'Back to work'),
      h('button', { type: 'button', class: 'btn btn-outline', onclick: () => void closeTab() }, 'Close tab')
    );
  } else {
    title = 'Your notebook';
    detailEl.textContent = 'This is what you see when you open a blocked site.';
    actions.push(editButton(true));
  }

  topbar.replaceChildren(
    mark,
    h(
      'div',
      { class: 'topbar-text' },
      h('h1', { class: 'topbar-title' }, title),
      detailEl,
      topbarNote ? h('p', { class: 'topbar-note', role: 'status' }, topbarNote) : null,
      unlocking && !editing ? unlockForm() : null
    ),
    h('div', { class: 'topbar-actions' }, ...actions)
  );
}

function textClass(block: TextBlock): string {
  return ['text', `font-${block.font}`, `size-${block.size}`, `note-${block.note}`, block.bold ? 'is-bold' : '', block.italic ? 'is-italic' : '']
    .filter(Boolean)
    .join(' ');
}

function paintText(element: HTMLElement, block: TextBlock): void {
  element.className = textClass(block);
  element.style.color = block.color;
  element.style.textAlign = block.align;
  element.classList.toggle('is-empty', editing && !block.text);
}

function placeholder(name: 'video' | 'photo' | 'link', text: string): HTMLElement {
  return h('div', { class: 'placeholder' }, icon(name), h('span', {}, text));
}

function textContent(block: TextBlock): HTMLElement | null {
  if (!editing && !block.text.trim()) return null;
  const element = h('div', {});
  element.textContent = block.text;
  paintText(element, block);
  if (editing) {
    element.contentEditable = 'plaintext-only';
    element.spellcheck = true;
    element.dataset.placeholder = 'Write something to yourself';
    element.setAttribute('role', 'textbox');
    element.setAttribute('aria-multiline', 'true');
    element.setAttribute('aria-label', 'Message');
    element.addEventListener('input', () => {
      block.text = element.innerText.replace(/\n$/, '');
      element.classList.toggle('is-empty', !block.text);
      scheduleSave();
    });
  }
  return element;
}

function videoContent(block: VideoBlock): HTMLElement | null {
  const info = parseVideo(block.url);
  if (!info) return editing ? placeholder('video', 'Paste a YouTube or TikTok link in the panel to show a video here.') : null;
  return h(
    'div',
    { class: `video ${info.provider}${info.vertical ? ' is-vertical' : ''}` },
    h('iframe', {
      src: info.embedUrl,
      title: info.provider === 'youtube' ? 'YouTube video' : 'TikTok video',
      allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen; clipboard-write',
      allowfullscreen: true,
      loading: 'lazy',
      referrerpolicy: 'strict-origin-when-cross-origin'
    })
  );
}

function imageContent(block: ImageBlock): HTMLElement | null {
  const data = images[block.imageId];
  if (!data) return editing ? placeholder('photo', 'This photo could not be found. Pick another one in the panel.') : null;
  return h(
    'figure',
    { class: 'photo' },
    h('img', { src: data, alt: block.caption || 'A photo from your notebook' }),
    block.caption ? h('figcaption', {}, block.caption) : null
  );
}

function linkContent(block: LinkBlock): HTMLElement | null {
  if (!block.url) return editing ? placeholder('link', 'Add the web address in the panel.') : null;
  const link = h(
    'a',
    { class: 'link', href: block.url },
    h('span', { class: 'link-label' }, block.label || 'Open link'),
    h('span', { class: 'link-host' }, hostOf(block.url))
  );
  if (editing) link.addEventListener('click', (event) => event.preventDefault());
  return link;
}

function blockContent(block: Block): HTMLElement | null {
  switch (block.type) {
    case 'text':
      return textContent(block);
    case 'video':
      return videoContent(block);
    case 'image':
      return imageContent(block);
    case 'link':
      return linkContent(block);
  }
}

function renderSlot(block: Block): HTMLElement | null {
  const content = blockContent(block);
  if (!content) return null;
  const slot = h('div', { class: `slot span-${block.span}${editing && block.id === selectedId ? ' is-selected' : ''}`, 'data-id': block.id }, content);
  if (editing) {
    slot.addEventListener('click', () => select(block.id));
    slot.addEventListener('focusin', () => select(block.id));
  }
  return slot;
}

function refreshSlot(id: string): void {
  const block = findBlock(id);
  const slot = slotFor(id);
  if (!block || !slot) return;
  const next = renderSlot(block);
  if (next) slot.replaceWith(next);
  else slot.remove();
}

function renderPaper(): void {
  paper.className = `paper paper-${notebook.paper.color} pattern-${notebook.paper.pattern}`;
}

function renderBlocks(): void {
  const slots = notebook.blocks.map(renderSlot).filter((slot): slot is HTMLElement => slot !== null);
  if (!slots.length) {
    slots.push(
      h(
        'p',
        { class: 'empty-notebook' },
        editing
          ? 'Your notebook is empty. Add a message, a video, a photo, or a link from the panel.'
          : 'Your notebook is empty. Click Edit notebook to write yourself a note.'
      )
    );
  }
  blocksEl.replaceChildren(...slots);
}

function select(id: string | null): void {
  if (selectedId === id) return;
  selectedId = id;
  for (const slot of blocksEl.querySelectorAll<HTMLElement>('.slot')) slot.classList.toggle('is-selected', slot.dataset.id === id);
  renderInspector();
}

function seg(options: SegOption[], label: string): HTMLElement {
  return h(
    'div',
    { class: 'seg', role: 'group', 'aria-label': label },
    ...options.map((option) =>
      h(
        'button',
        {
          type: 'button',
          class: option.className ?? '',
          title: option.title ?? option.label,
          'aria-pressed': option.active ? 'true' : 'false',
          onclick: option.onSelect
        },
        option.label
      )
    )
  );
}

function group(label: string, ...children: Node[]): HTMLElement {
  return h('div', { class: 'ins-group' }, h('span', { class: 'ins-label' }, label), ...children);
}

function swatch(color: string, label: string, active: boolean, onSelect: () => void, extraClass = ''): HTMLElement {
  const button = h('button', {
    type: 'button',
    class: `swatch ${extraClass}`.trim(),
    title: label,
    'aria-label': label,
    'aria-pressed': active ? 'true' : 'false',
    onclick: onSelect
  });
  button.style.setProperty('--swatch', color);
  return button;
}

function updateText(block: TextBlock, patch: Partial<TextBlock>): void {
  Object.assign(block, patch);
  const element = slotFor(block.id)?.querySelector<HTMLElement>('.text');
  if (element) paintText(element, block);
  renderInspector();
  scheduleSave();
}

function setSpan(block: Block, span: Span): void {
  block.span = span;
  const slot = slotFor(block.id);
  if (slot) {
    slot.classList.toggle('span-1', span === 1);
    slot.classList.toggle('span-2', span === 2);
  }
  renderInspector();
  scheduleSave();
}

function moveBlock(id: string, delta: number): void {
  const index = notebook.blocks.findIndex((block) => block.id === id);
  const target = index + delta;
  const block = notebook.blocks[index];
  if (index < 0 || !block || target < 0 || target >= notebook.blocks.length) return;
  notebook.blocks.splice(index, 1);
  notebook.blocks.splice(target, 0, block);
  renderBlocks();
  renderInspector();
  scheduleSave();
  slotFor(id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function deleteBlock(id: string): void {
  notebook.blocks = notebook.blocks.filter((block) => block.id !== id);
  selectedId = null;
  renderBlocks();
  renderInspector();
  scheduleSave();
}

function insertBlock(block: Block): void {
  notebook.blocks.push(block);
  selectedId = block.id;
  renderBlocks();
  renderInspector();
  scheduleSave();
  slotFor(block.id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function addMessage(): void {
  const block: TextBlock = {
    id: newId(),
    type: 'text',
    span: 2,
    text: '',
    font: 'hand',
    size: 'l',
    color: notebook.paper.color === 'night' ? '#ffffff' : '#1e1a1d',
    align: 'left',
    bold: false,
    italic: false,
    note: 'none'
  };
  insertBlock(block);
  slotFor(block.id)?.querySelector<HTMLElement>('.text')?.focus();
}

function addVideo(): void {
  insertBlock({ id: newId(), type: 'video', span: 2, url: '' });
  inspector.querySelector<HTMLInputElement>('input[name="video-url"]')?.focus();
}

function addLink(): void {
  insertBlock({ id: newId(), type: 'link', span: 1, label: 'Open my work', url: '' });
  inspector.querySelector<HTMLInputElement>('input[name="link-url"]')?.focus();
}

function pickPhoto(target: string | null): void {
  replaceTarget = target;
  photoInput.click();
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('That photo could not be read.'));
    reader.readAsDataURL(blob);
  });
}

async function compressPhoto(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Pick an image file, like a JPG or PNG.');
  if (file.type === 'image/gif' && file.size <= 4 * 1024 * 1024) return readAsDataUrl(file);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Chrome cannot open that photo format. Try a JPG or PNG.');
  }
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL('image/webp', 0.86);
  if (dataUrl.length > MAX_IMAGE_BYTES * 1.37) throw new Error('That photo is too large. Try a smaller one.');
  return dataUrl;
}

async function handlePhoto(file: File): Promise<void> {
  topbarNote = 'Adding your photo';
  renderTopbar();
  try {
    const dataUrl = await compressPhoto(file);
    const imageId = newId();
    await send('saveImage', { id: imageId, dataUrl });
    images[imageId] = dataUrl;
    const target = findBlock(replaceTarget);
    if (target?.type === 'image') {
      target.imageId = imageId;
      refreshSlot(target.id);
      renderInspector();
      scheduleSave();
    } else {
      insertBlock({ id: newId(), type: 'image', span: 1, imageId, caption: '' });
    }
    topbarNote = '';
  } catch (error) {
    topbarNote = errorText(error);
  }
  replaceTarget = null;
  renderTopbar();
}

async function resolveShortLink(raw: string): Promise<string> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`, {
      signal: controller.signal,
      credentials: 'omit',
      redirect: 'follow'
    });
    controller.abort();
    return response.url || raw;
  } catch {
    return raw;
  } finally {
    window.clearTimeout(timer);
  }
}

function textControls(block: TextBlock): Node[] {
  const custom = h('input', {
    type: 'color',
    value: block.color,
    'aria-label': 'Pick any color',
    oninput: (event: Event) => updateText(block, { color: (event.target as HTMLInputElement).value.toLowerCase() })
  });
  const customSwatch = h('label', { class: 'swatch swatch-custom', title: 'Any color' }, custom);
  if (!INKS.some((ink) => ink.value === block.color)) customSwatch.setAttribute('aria-pressed', 'true');

  return [
    group(
      'Font',
      h(
        'div',
        { class: 'font-grid' },
        ...FONTS.map((font) =>
          h(
            'button',
            {
              type: 'button',
              class: `font-option font-${font.key}`,
              'aria-pressed': block.font === font.key ? 'true' : 'false',
              onclick: () => updateText(block, { font: font.key })
            },
            font.label
          )
        )
      )
    ),
    group(
      'Size',
      seg(
        SIZES.map((size) => ({
          label: size.key.toUpperCase(),
          title: size.label,
          active: block.size === size.key,
          onSelect: () => updateText(block, { size: size.key })
        })),
        'Size'
      )
    ),
    group(
      'Color',
      h(
        'div',
        { class: 'swatches' },
        ...INKS.map((ink) => swatch(ink.value, ink.label, block.color === ink.value, () => updateText(block, { color: ink.value }))),
        customSwatch
      )
    ),
    group(
      'Style',
      h(
        'div',
        { class: 'ins-row' },
        seg(
          [
            { label: 'B', title: 'Bold', active: block.bold, onSelect: () => updateText(block, { bold: !block.bold }) },
            { label: 'I', title: 'Italic', className: 'is-italic-label', active: block.italic, onSelect: () => updateText(block, { italic: !block.italic }) }
          ],
          'Text style'
        ),
        seg(
          ALIGNS.map((align) => ({
            label: align.label,
            active: block.align === align.key,
            onSelect: () => updateText(block, { align: align.key })
          })),
          'Alignment'
        )
      )
    ),
    group(
      'Background',
      h(
        'div',
        { class: 'swatches' },
        ...NOTES.map((note) =>
          swatch(
            note.key === 'none' ? 'transparent' : `var(--note-${note.key})`,
            note.label,
            block.note === note.key,
            () => updateText(block, { note: note.key }),
            `is-square swatch-note-${note.key}${note.key === 'none' ? ' swatch-none' : ''}`
          )
        )
      )
    )
  ];
}

function videoControls(block: VideoBlock): Node[] {
  const input = h('input', {
    class: 'input',
    type: 'url',
    name: 'video-url',
    value: block.url,
    placeholder: 'youtube.com/watch?v=... or a TikTok link',
    'aria-label': 'Video link'
  });
  const msg = h('p', { class: 'msg', role: 'status' });
  const info = parseVideo(block.url);
  if (info) setMessage(msg, info.provider === 'youtube' ? 'Showing a YouTube video.' : 'Showing a TikTok video.', 'ok');

  const apply = async (): Promise<void> => {
    const raw = input.value.trim();
    if (!raw) {
      setMessage(msg, 'Paste a link to a YouTube or TikTok video.', 'error');
      return;
    }
    let link = raw;
    if (isShortTikTok(raw)) {
      setMessage(msg, 'Opening the TikTok link');
      link = await resolveShortLink(raw);
    }
    const found = parseVideo(link);
    if (!found) {
      setMessage(msg, 'No video found in that link. Paste a YouTube or TikTok video link.', 'error');
      return;
    }
    block.url = link;
    refreshSlot(block.id);
    renderInspector();
    scheduleSave();
  };

  return [
    group(
      'Video link',
      h(
        'form',
        {
          class: 'ins-form',
          onsubmit: (event: SubmitEvent) => {
            event.preventDefault();
            void apply();
          }
        },
        input,
        h('button', { type: 'submit', class: 'btn btn-velvet btn-sm' }, 'Show this video'),
        msg
      )
    ),
    h('p', { class: 'ins-hint' }, 'Works with YouTube videos, YouTube Shorts, and TikTok videos. Embedded videos still play while those sites are blocked.')
  ];
}

function photoControls(block: ImageBlock): Node[] {
  return [
    group(
      'Photo',
      h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => pickPhoto(block.id) }, icon('photo'), 'Replace photo')
    ),
    group(
      'Caption',
      h('input', {
        class: 'input',
        type: 'text',
        value: block.caption,
        maxlength: 300,
        placeholder: 'Write a caption',
        'aria-label': 'Caption',
        oninput: (event: Event) => {
          block.caption = (event.target as HTMLInputElement).value;
          refreshSlot(block.id);
          scheduleSave();
        }
      })
    )
  ];
}

function linkControls(block: LinkBlock): Node[] {
  const msg = h('p', { class: 'msg', role: 'status' });
  return [
    group(
      'Button text',
      h('input', {
        class: 'input',
        type: 'text',
        value: block.label,
        maxlength: 120,
        'aria-label': 'Button text',
        oninput: (event: Event) => {
          block.label = (event.target as HTMLInputElement).value;
          refreshSlot(block.id);
          scheduleSave();
        }
      })
    ),
    group(
      'Web address',
      h('input', {
        class: 'input',
        type: 'url',
        name: 'link-url',
        value: block.url,
        placeholder: 'docs.google.com/your-essay',
        'aria-label': 'Web address',
        onchange: (event: Event) => {
          const raw = (event.target as HTMLInputElement).value;
          const link = safeLink(raw);
          if (raw.trim() && !link) {
            setMessage(msg, 'That is not a web address. Try something like docs.google.com', 'error');
            return;
          }
          setMessage(msg, link ? 'Saved.' : '', 'ok');
          block.url = link;
          refreshSlot(block.id);
          scheduleSave();
        }
      }),
      msg
    )
  ];
}

function blockSection(block: Block): HTMLElement {
  const titles: Record<Block['type'], string> = { text: 'Message', video: 'Video', image: 'Photo', link: 'Link' };
  const controls =
    block.type === 'text'
      ? textControls(block)
      : block.type === 'video'
        ? videoControls(block)
        : block.type === 'image'
          ? photoControls(block)
          : linkControls(block);
  const index = notebook.blocks.indexOf(block);
  return h(
    'section',
    { class: 'ins-section' },
    h('h2', {}, `Selected ${titles[block.type].toLowerCase()}`),
    ...controls,
    group(
      'Width',
      seg(
        [
          { label: 'Half page', active: block.span === 1, onSelect: () => setSpan(block, 1) },
          { label: 'Full page', active: block.span === 2, onSelect: () => setSpan(block, 2) }
        ],
        'Width'
      )
    ),
    h(
      'div',
      { class: 'arrange ins-group' },
      h('button', { type: 'button', class: 'btn btn-outline btn-sm', disabled: index <= 0, onclick: () => moveBlock(block.id, -1) }, icon('up'), 'Move up'),
      h(
        'button',
        { type: 'button', class: 'btn btn-outline btn-sm', disabled: index >= notebook.blocks.length - 1, onclick: () => moveBlock(block.id, 1) },
        icon('down'),
        'Move down'
      ),
      h('button', { type: 'button', class: 'btn btn-danger btn-sm', onclick: () => deleteBlock(block.id) }, icon('trash'), 'Delete')
    )
  );
}

function pageSection(): HTMLElement {
  const paperColors: Record<string, string> = {
    white: '#ffffff',
    cream: '#fbf5e6',
    blush: '#fcedf0',
    sage: '#edf4ea',
    sky: '#e9f2fb',
    night: '#201a2a'
  };
  return h(
    'section',
    { class: 'ins-section' },
    h('h2', {}, 'Page'),
    group(
      'Paper',
      seg(
        PATTERNS.map((pattern) => ({
          label: pattern.label,
          active: notebook.paper.pattern === pattern.key,
          onSelect: () => {
            notebook.paper.pattern = pattern.key;
            renderPaper();
            renderInspector();
            scheduleSave();
          }
        })),
        'Paper pattern'
      )
    ),
    group(
      'Paper color',
      h(
        'div',
        { class: 'swatches' },
        ...PAPERS.map((option) =>
          swatch(paperColors[option.key] ?? '#ffffff', option.label, notebook.paper.color === option.key, () => {
            notebook.paper.color = option.key;
            renderPaper();
            renderInspector();
            scheduleSave();
          }, 'is-square')
        )
      )
    )
  );
}

function addSection(): HTMLElement {
  const add = (name: 'text' | 'video' | 'photo' | 'link', label: string, action: () => void): HTMLElement =>
    h('button', { type: 'button', class: 'add-btn', onclick: action }, icon(name), label);
  return h(
    'section',
    { class: 'ins-section' },
    h('h2', {}, 'Add to your notebook'),
    h(
      'div',
      { class: 'add-grid' },
      add('text', 'Message', addMessage),
      add('video', 'Video', addVideo),
      add('photo', 'Photo', () => pickPhoto(null)),
      add('link', 'Link', addLink)
    )
  );
}

function renderInspector(): void {
  inspector.hidden = !editing;
  if (!editing) {
    inspector.replaceChildren();
    return;
  }
  const scroll = inspector.scrollTop;
  const block = findBlock(selectedId);
  const sections: Node[] = [addSection()];
  if (block) sections.push(blockSection(block));
  else sections.push(h('p', { class: 'ins-hint' }, 'Click anything in your notebook to change its font, color, size, or position.'));
  sections.push(pageSection());
  inspector.replaceChildren(...sections);
  inspector.scrollTop = scroll;
}

function render(): void {
  document.body.classList.toggle('is-editing', editing);
  renderTopbar();
  renderPaper();
  renderBlocks();
  renderInspector();
}

function tick(): void {
  if (!state?.session) return;
  const remaining = state.session.endsAt - Date.now();
  if (remaining <= 0) {
    void send('getState', {}).then((next) => {
      state = next;
      renderTopbar();
    });
    return;
  }
  if (timerText) timerText.textContent = formatClock(remaining);
  miniShield?.set(sessionFraction(state.session));
}

async function onChanges(keys: Set<string>): Promise<void> {
  if ([...keys].some((key) => SETTINGS_KEYS.has(key))) {
    state = await send('getState', {});
    if (editing && state.locked) {
      editing = false;
      selectedId = null;
      dirty = false;
      topbarNote = 'Editing stopped because Gasha is locked.';
      notebook = await loadNotebook();
      images = await loadImages(imageIds(notebook));
      render();
      return;
    }
    renderTopbar();
  }
  if (keys.has(NOTEBOOK_KEY) && !editing) {
    notebook = await loadNotebook();
    images = await loadImages(imageIds(notebook));
    renderPaper();
    renderBlocks();
  }
}

async function init(): Promise<void> {
  if (window.top !== window) {
    document.body.replaceChildren();
    return;
  }
  document.title = mode === 'blocked' ? `${hostOf(blockedUrl)} is blocked` : 'Your notebook';
  const [current, book] = await Promise.all([send('getState', {}), loadNotebook()]);
  state = current;
  notebook = book;
  images = await loadImages(imageIds(notebook));
  render();
  if (params.has('edit')) startEditing();

  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--topbar-h', `${topbar.offsetHeight}px`);
  }).observe(topbar);

  paper.addEventListener('click', (event) => {
    if (editing && !(event.target as HTMLElement).closest('.slot')) select(null);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && editing && selectedId) {
      (document.activeElement as HTMLElement | null)?.blur();
      select(null);
    }
  });
  photoInput.addEventListener('change', () => {
    const file = photoInput.files?.[0];
    photoInput.value = '';
    if (file) void handlePhoto(file);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && dirty) void flush(false);
  });
  window.addEventListener('pagehide', () => {
    if (dirty) void send('saveNotebook', { notebook });
  });
  onStorageChange((keys) => void onChanges(keys));
  everySecond(tick);
}

void init();
