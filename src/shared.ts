export type BlockMode = 'always' | 'session';
export type LockReason = 'session' | 'password' | null;

export interface PasswordRecord {
  salt: string;
  hash: string;
  iterations: number;
}

export interface Session {
  startedAt: number;
  endsAt: number;
  minutes: number;
}

export interface Stats {
  sessions: number;
  minutes: number;
}

export interface Settings {
  sites: string[];
  blockMode: BlockMode;
  protectAlways: boolean;
  lockExtensionsPage: boolean;
  password: PasswordRecord | null;
  session: Session | null;
  stats: Stats;
}

export type SettingsPatch = Partial<Pick<Settings, 'blockMode' | 'protectAlways' | 'lockExtensionsPage'>>;

export interface PublicState {
  now: number;
  sites: string[];
  blockMode: BlockMode;
  protectAlways: boolean;
  lockExtensionsPage: boolean;
  hasPassword: boolean;
  session: Session | null;
  stats: Stats;
  blocking: boolean;
  locked: boolean;
  lockReason: LockReason;
  unlockedUntil: number;
  retryAt: number;
}

export const DEFAULTS: Settings = {
  sites: [],
  blockMode: 'always',
  protectAlways: false,
  lockExtensionsPage: true,
  password: null,
  session: null,
  stats: { sessions: 0, minutes: 0 }
};

export const MAX_SESSION_MINUTES = 1440;
export const MAX_SITES = 500;
export const UNLOCK_WINDOW_MINUTES = 10;
export const PRESETS = [25, 45, 60, 90, 120, 180] as const;
export const NOTEBOOK_KEY = 'notebook';
export const IMAGE_PREFIX = 'image:';
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export const SUGGESTIONS = [
  'youtube.com',
  'instagram.com',
  'tiktok.com',
  'x.com',
  'reddit.com',
  'facebook.com',
  'netflix.com',
  'twitch.tv',
  'snapchat.com',
  'discord.com'
] as const;

export const FONTS = [
  { key: 'clean', label: 'Clean' },
  { key: 'hand', label: 'Handwriting' },
  { key: 'marker', label: 'Marker' },
  { key: 'poster', label: 'Poster' },
  { key: 'classic', label: 'Classic' },
  { key: 'typewriter', label: 'Typewriter' },
  { key: 'script', label: 'Script' }
] as const;

export const SIZES = [
  { key: 's', label: 'Small' },
  { key: 'm', label: 'Medium' },
  { key: 'l', label: 'Large' },
  { key: 'xl', label: 'Huge' }
] as const;

export const ALIGNS = [
  { key: 'left', label: 'Left' },
  { key: 'center', label: 'Center' },
  { key: 'right', label: 'Right' }
] as const;

export const INKS = [
  { value: '#1e1a1d', label: 'Ink' },
  { value: '#4e1023', label: 'Velvet' },
  { value: '#c8312b', label: 'Red pen' },
  { value: '#d9631e', label: 'Orange' },
  { value: '#b98a1e', label: 'Gold' },
  { value: '#21794a', label: 'Green' },
  { value: '#2346b8', label: 'Blue pen' },
  { value: '#6a3baa', label: 'Purple' },
  { value: '#d23c80', label: 'Pink' },
  { value: '#ffffff', label: 'White' }
] as const;

export const NOTES = [
  { key: 'none', label: 'No background' },
  { key: 'yellow', label: 'Yellow note' },
  { key: 'pink', label: 'Pink note' },
  { key: 'blue', label: 'Blue note' },
  { key: 'green', label: 'Green note' },
  { key: 'dark', label: 'Dark note' }
] as const;

export const PATTERNS = [
  { key: 'lined', label: 'Lined' },
  { key: 'grid', label: 'Grid' },
  { key: 'dots', label: 'Dots' },
  { key: 'plain', label: 'Plain' }
] as const;

export const PAPERS = [
  { key: 'white', label: 'White' },
  { key: 'cream', label: 'Cream' },
  { key: 'blush', label: 'Blush' },
  { key: 'sage', label: 'Sage' },
  { key: 'sky', label: 'Sky' },
  { key: 'night', label: 'Night' }
] as const;

export type FontKey = (typeof FONTS)[number]['key'];
export type SizeKey = (typeof SIZES)[number]['key'];
export type AlignKey = (typeof ALIGNS)[number]['key'];
export type NoteKey = (typeof NOTES)[number]['key'];
export type PatternKey = (typeof PATTERNS)[number]['key'];
export type PaperKey = (typeof PAPERS)[number]['key'];
export type Span = 1 | 2;

export interface TextBlock {
  id: string;
  type: 'text';
  span: Span;
  text: string;
  font: FontKey;
  size: SizeKey;
  color: string;
  align: AlignKey;
  bold: boolean;
  italic: boolean;
  note: NoteKey;
}

export interface VideoBlock {
  id: string;
  type: 'video';
  span: Span;
  url: string;
}

export interface ImageBlock {
  id: string;
  type: 'image';
  span: Span;
  imageId: string;
  caption: string;
}

export interface LinkBlock {
  id: string;
  type: 'link';
  span: Span;
  label: string;
  url: string;
}

export type Block = TextBlock | VideoBlock | ImageBlock | LinkBlock;

export interface Notebook {
  version: 1;
  paper: { pattern: PatternKey; color: PaperKey };
  blocks: Block[];
}

export interface Backup {
  app: 'gasha';
  version: 1;
  exportedAt: string;
  sites: string[];
  blockMode: BlockMode;
  lockExtensionsPage: boolean;
  notebook: Notebook;
  images: Record<string, string>;
}

export const STARTER_NOTEBOOK: Notebook = {
  version: 1,
  paper: { pattern: 'lined', color: 'white' },
  blocks: [
    {
      id: 'starter-title',
      type: 'text',
      span: 2,
      text: 'Why did you open this?',
      font: 'marker',
      size: 'xl',
      color: '#4e1023',
      align: 'left',
      bold: false,
      italic: false,
      note: 'none'
    },
    {
      id: 'starter-intro',
      type: 'text',
      span: 2,
      text: 'This is your notebook. Fill it with whatever gets you back on track: a note to yourself, a video that fires you up, a photo of what you are working toward, or a link to the work you should be doing.',
      font: 'clean',
      size: 'm',
      color: '#1e1a1d',
      align: 'left',
      bold: false,
      italic: false,
      note: 'none'
    },
    {
      id: 'starter-note-one',
      type: 'text',
      span: 1,
      text: 'Close the tab.\nOpen the work.',
      font: 'hand',
      size: 'l',
      color: '#1e1a1d',
      align: 'left',
      bold: true,
      italic: false,
      note: 'yellow'
    },
    {
      id: 'starter-note-two',
      type: 'text',
      span: 1,
      text: 'Future you is counting on you.',
      font: 'hand',
      size: 'l',
      color: '#1e1a1d',
      align: 'left',
      bold: true,
      italic: false,
      note: 'pink'
    }
  ]
};

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;
const IPV4 = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const ID = /^[a-z0-9-]{4,40}$/i;
const DATA_IMAGE = /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i;

export function isValidHost(host: string): boolean {
  return host === 'localhost' || IPV4.test(host) || DOMAIN.test(host);
}

export function normalizeEntry(raw: unknown): string | null {
  let text = String(raw ?? '').trim().replace(/\s+/g, '');
  if (!text) return null;
  text = text.replace(SCHEME, '').replace(/^\*\.?/, '');
  let url: URL;
  try {
    url = new URL(`http://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/\.$/, '').replace(/^www\./, '');
  if (!isValidHost(host)) return null;
  const path = `${url.pathname}${url.search}`.replace(/\/+$/, '');
  return `${host}${path}`;
}

export function splitEntry(entry: string): { host: string; path: string } {
  const index = entry.indexOf('/');
  if (index === -1) return { host: entry, path: '' };
  return { host: entry.slice(0, index), path: entry.slice(index) };
}

export function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function findMatch(url: string, entries: readonly string[]): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.replace(/\.$/, '');
  const rest = `${parsed.pathname}${parsed.search}`.toLowerCase();
  for (const entry of entries) {
    const { host: domain, path } = splitEntry(entry);
    if (hostMatches(host, domain) && (!path || rest.startsWith(path.toLowerCase()))) return entry;
  }
  return null;
}

export function siteFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return normalizeEntry(parsed.hostname);
  } catch {
    return null;
  }
}

export function safeLink(raw: unknown): string {
  let text = String(raw ?? '').trim();
  if (!text) return '';
  if (!SCHEME.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (!isValidHost(url.hostname.replace(/\.$/, ''))) return '';
    return url.href;
  } catch {
    return '';
  }
}

export function newId(): string {
  return crypto.randomUUID();
}

export interface VideoInfo {
  provider: 'youtube' | 'tiktok';
  id: string;
  embedUrl: string;
  watchUrl: string;
  vertical: boolean;
}

function youTubeStart(value: string | null): number {
  if (!value) return 0;
  if (/^\d+$/.test(value)) return Number(value);
  const match = value.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/);
  if (!match) return 0;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

export function isShortTikTok(raw: string): boolean {
  try {
    const url = new URL(SCHEME.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`);
    return /^(vm|vt)\.tiktok\.com$/.test(url.hostname) || (/(^|\.)tiktok\.com$/.test(url.hostname) && url.pathname.startsWith('/t/'));
  } catch {
    return false;
  }
}

export function parseVideo(raw: string): VideoInfo | null {
  const text = raw.trim();
  if (!text) return null;
  let url: URL;
  try {
    url = new URL(SCHEME.test(text) ? text : `https://${text}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '');
  const parts = url.pathname.split('/').filter(Boolean);

  if (host === 'youtu.be' || host === 'youtube.com' || host === 'youtube-nocookie.com') {
    let id = '';
    let vertical = false;
    if (host === 'youtu.be') id = parts[0] ?? '';
    else if (parts[0] === 'watch') id = url.searchParams.get('v') ?? '';
    else if (parts[0] && ['embed', 'shorts', 'live', 'v'].includes(parts[0])) {
      id = parts[1] ?? '';
      vertical = parts[0] === 'shorts';
    }
    if (!/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
    const start = youTubeStart(url.searchParams.get('t') ?? url.searchParams.get('start'));
    const params = new URLSearchParams({ rel: '0', playsinline: '1' });
    if (start) params.set('start', String(start));
    return {
      provider: 'youtube',
      id,
      vertical,
      embedUrl: `https://www.youtube-nocookie.com/embed/${id}?${params}`,
      watchUrl: `https://www.youtube.com/watch?v=${id}`
    };
  }

  if (host === 'tiktok.com' || host.endsWith('.tiktok.com')) {
    const match = url.pathname.match(/\/(?:video|photo|v1|v2|embed)\/(\d{6,25})/);
    const id = match?.[1];
    if (!id) return null;
    return {
      provider: 'tiktok',
      id,
      vertical: true,
      embedUrl: `https://www.tiktok.com/player/v1/${id}?rel=0&description=1`,
      watchUrl: `https://www.tiktok.com/video/${id}`
    };
  }

  return null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pick<T extends string>(value: unknown, allowed: readonly { key: T }[], fallback: T): T {
  return allowed.some((option) => option.key === value) ? (value as T) : fallback;
}

function clip(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

export function isImageId(value: unknown): value is string {
  return typeof value === 'string' && ID.test(value);
}

export function isImageData(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_IMAGE_BYTES * 1.4 && DATA_IMAGE.test(value);
}

export function sanitizeNotebook(input: unknown): Notebook {
  const source = isRecord(input) ? input : {};
  const paper = isRecord(source.paper) ? source.paper : {};
  const rawBlocks = Array.isArray(source.blocks) ? source.blocks.slice(0, 200) : [];
  const seen = new Set<string>();
  const blocks: Block[] = [];

  for (const raw of rawBlocks) {
    if (!isRecord(raw)) continue;
    const id = typeof raw.id === 'string' && ID.test(raw.id) && !seen.has(raw.id) ? raw.id : newId();
    seen.add(id);
    const span: Span = raw.span === 1 ? 1 : 2;
    if (raw.type === 'text') {
      blocks.push({
        id,
        type: 'text',
        span,
        text: clip(raw.text, 5000),
        font: pick(raw.font, FONTS, 'clean'),
        size: pick(raw.size, SIZES, 'm'),
        color: typeof raw.color === 'string' && COLOR.test(raw.color) ? raw.color.toLowerCase() : '#1e1a1d',
        align: pick(raw.align, ALIGNS, 'left'),
        bold: raw.bold === true,
        italic: raw.italic === true,
        note: pick(raw.note, NOTES, 'none')
      });
    } else if (raw.type === 'video') {
      blocks.push({ id, type: 'video', span, url: clip(raw.url, 2000) });
    } else if (raw.type === 'image' && isImageId(raw.imageId)) {
      blocks.push({ id, type: 'image', span, imageId: raw.imageId, caption: clip(raw.caption, 300) });
    } else if (raw.type === 'link') {
      blocks.push({ id, type: 'link', span, label: clip(raw.label, 120), url: safeLink(raw.url) });
    }
  }

  return {
    version: 1,
    paper: { pattern: pick(paper.pattern, PATTERNS, 'lined'), color: pick(paper.color, PAPERS, 'white') },
    blocks
  };
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  if (!hours) return `${minutes}:${seconds}`;
  return `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`;
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  if (!rest) return `${hours} hr`;
  return `${hours} hr ${rest} min`;
}

export function shortDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

type Empty = Record<string, never>;

export interface Api {
  getState: { req: Empty; res: PublicState };
  addSites: { req: { entries: string[] | string }; res: { added: string[]; invalid: string[]; full: boolean } };
  removeSite: { req: { entry: string }; res: Empty };
  saveSettings: { req: { settings: SettingsPatch }; res: Empty };
  setPassword: { req: { current?: string; next: string }; res: Empty };
  removePassword: { req: { current: string }; res: Empty };
  startSession: { req: { minutes: number }; res: { session: Session } };
  extendSession: { req: { minutes: number }; res: { session: Session } };
  endSession: { req: { password?: string }; res: Empty };
  unlock: { req: { password: string }; res: { unlockedUntil: number } };
  lockNow: { req: Empty; res: Empty };
  saveNotebook: { req: { notebook: Notebook; cleanup?: boolean }; res: Empty };
  saveImage: { req: { id: string; dataUrl: string }; res: Empty };
  importBackup: { req: { backup: unknown }; res: { sites: number; blocks: number } };
}

export type ApiName = keyof Api;
export type Reply<T> = ({ ok: true } & T) | { ok: false; error: string };

export async function send<K extends ApiName>(type: K, data: Api[K]['req']): Promise<Api[K]['res']> {
  const reply = (await chrome.runtime.sendMessage({ ...data, type })) as Reply<Api[K]['res']> | undefined;
  if (!reply) throw new Error('Gasha did not answer. Try again.');
  if (!reply.ok) throw new Error(reply.error || 'Something went wrong.');
  return reply;
}

export async function loadNotebook(): Promise<Notebook> {
  const stored = await chrome.storage.local.get(NOTEBOOK_KEY);
  return stored[NOTEBOOK_KEY] ? sanitizeNotebook(stored[NOTEBOOK_KEY]) : structuredClone(STARTER_NOTEBOOK);
}

export async function loadImages(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const stored = await chrome.storage.local.get(ids.map((id) => `${IMAGE_PREFIX}${id}`));
  const images: Record<string, string> = {};
  for (const id of ids) {
    const value = stored[`${IMAGE_PREFIX}${id}`];
    if (isImageData(value)) images[id] = value;
  }
  return images;
}
