import {
  DEFAULTS,
  IMAGE_PREFIX,
  MAX_SESSION_MINUTES,
  MAX_SITES,
  NOTEBOOK_KEY,
  STARTER_NOTEBOOK,
  UNLOCK_WINDOW_MINUTES,
  findMatch,
  isImageData,
  isImageId,
  isRecord,
  normalizeEntry,
  sanitizeNotebook,
  splitEntry,
  type Api,
  type ApiName,
  type LockReason,
  type Notebook,
  type PublicState,
  type Session,
  type Settings,
  type SettingsPatch
} from './shared.js';

type Rule = chrome.declarativeNetRequest.Rule;
type Handlers = { [K in ApiName]: (request: Api[K]['req']) => Promise<Api[K]['res']> };

interface Lock {
  locked: boolean;
  reason: LockReason;
  unlockedUntil: number;
}

const NOTEBOOK_PAGE = chrome.runtime.getURL('notebook.html');
const BROWSER_PAGES = /^(chrome|edge|brave|opera|vivaldi):\/\/(extensions|settings\/reset)/i;
const EMBED_RULE_ID = 9000;
const ITERATIONS = 250000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60000;
const MINUTE = 60000;

const encoder = new TextEncoder();
let queue: Promise<unknown> = Promise.resolve();

function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.catch(() => undefined);
  return run;
}

async function loadState(): Promise<Settings> {
  return (await chrome.storage.local.get(DEFAULTS)) as Settings;
}

function sessionActive(state: Settings, now = Date.now()): boolean {
  return Boolean(state.session && state.session.endsAt > now);
}

function blockingActive(state: Settings, now = Date.now()): boolean {
  return state.sites.length > 0 && (state.blockMode === 'always' || sessionActive(state, now));
}

async function lockInfo(state: Settings, now = Date.now()): Promise<Lock> {
  if (sessionActive(state, now)) return { locked: true, reason: 'session', unlockedUntil: 0 };
  if (!state.protectAlways || !state.password) return { locked: false, reason: null, unlockedUntil: 0 };
  const { unlockedUntil = 0 } = (await chrome.storage.session.get('unlockedUntil')) as { unlockedUntil?: number };
  if (unlockedUntil > now) return { locked: false, reason: null, unlockedUntil };
  return { locked: true, reason: 'password', unlockedUntil: 0 };
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function embedRule(): Rule {
  return {
    id: EMBED_RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      requestHeaders: [{ header: 'referer', operation: 'set', value: `https://gasha.${chrome.runtime.id}` }]
    },
    condition: {
      initiatorDomains: [chrome.runtime.id],
      requestDomains: ['youtube.com', 'youtube-nocookie.com', 'tiktok.com'],
      resourceTypes: ['sub_frame']
    }
  };
}

function blockRules(state: Settings): Rule[] {
  const action: chrome.declarativeNetRequest.RuleAction = {
    type: 'redirect',
    redirect: { regexSubstitution: `${NOTEBOOK_PAGE}#\\0` }
  };
  const domains: string[] = [];
  const rules: Rule[] = [];
  for (const entry of state.sites) {
    const { host, path } = splitEntry(entry);
    if (!path) {
      domains.push(host);
      continue;
    }
    rules.push({
      id: rules.length + 2,
      priority: 1,
      action,
      condition: {
        regexFilter: `^https?://[^/?#]+${escapeRegex(path)}.*$`,
        isUrlFilterCaseSensitive: false,
        requestDomains: [host],
        resourceTypes: ['main_frame']
      }
    });
  }
  if (domains.length) {
    rules.push({
      id: 1,
      priority: 1,
      action,
      condition: { regexFilter: '^https?://.*$', requestDomains: domains, resourceTypes: ['main_frame'] }
    });
  }
  return rules;
}

async function applyRules(state: Settings): Promise<void> {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((rule) => rule.id),
    addRules: [embedRule(), ...(blockingActive(state) ? blockRules(state) : [])]
  });
}

function targetForTab(state: Settings, lock: Lock, url: string | undefined, now: number): string | null {
  if (!url || url.startsWith(NOTEBOOK_PAGE)) return null;
  if (BROWSER_PAGES.test(url)) return lock.locked && state.lockExtensionsPage ? `${NOTEBOOK_PAGE}?page=browser` : null;
  if (blockingActive(state, now) && findMatch(url, state.sites)) return `${NOTEBOOK_PAGE}#${url}`;
  return null;
}

async function sweepTabs(): Promise<void> {
  const state = await loadState();
  const now = Date.now();
  const lock = await lockInfo(state, now);
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map(async (tab) => {
      const target = targetForTab(state, lock, tab.url || tab.pendingUrl, now);
      if (target && tab.id !== undefined) await chrome.tabs.update(tab.id, { url: target }).catch(() => undefined);
    })
  );
}

async function checkTab(tabId: number, url: string | undefined, status: string | undefined): Promise<void> {
  if (!url) return;
  const state = await loadState();
  const now = Date.now();
  const target = targetForTab(state, await lockInfo(state, now), url, now);
  if (!target) return;
  if (status !== 'complete' && !BROWSER_PAGES.test(url)) return;
  await chrome.tabs.update(tabId, { url: target });
}

async function updateBadge(state: Settings): Promise<void> {
  const remaining = state.session ? state.session.endsAt - Date.now() : 0;
  if (remaining <= 0) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  const minutes = Math.ceil(remaining / MINUTE);
  const text = minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}` : `${minutes}m`;
  await chrome.action.setBadgeBackgroundColor({ color: '#F0C35A' });
  await chrome.action.setBadgeTextColor({ color: '#4E1023' });
  await chrome.action.setBadgeText({ text });
}

async function scheduleSession(session: Session): Promise<void> {
  await chrome.alarms.create('session-end', { when: session.endsAt });
  await chrome.alarms.create('session-tick', { delayInMinutes: 1, periodInMinutes: 1 });
}

async function finishSession(completed: boolean): Promise<Settings> {
  const state = await loadState();
  if (!state.session) return state;
  const focused = Math.max(0, Math.round((Math.min(Date.now(), state.session.endsAt) - state.session.startedAt) / MINUTE));
  const stats = { sessions: state.stats.sessions + (completed ? 1 : 0), minutes: state.stats.minutes + focused };
  await chrome.storage.local.set({ session: null, stats });
  await chrome.alarms.clear('session-end');
  await chrome.alarms.clear('session-tick');
  const next: Settings = { ...state, session: null, stats };
  await applyRules(next);
  await updateBadge(next);
  return next;
}

async function refreshSession(): Promise<Settings> {
  const state = await loadState();
  if (state.session && state.session.endsAt <= Date.now()) return finishSession(true);
  return state;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return toBase64(new Uint8Array(bits));
}

async function createPassword(password: string): Promise<NonNullable<Settings['password']>> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { salt: toBase64(salt), hash: await derive(password, salt, ITERATIONS), iterations: ITERATIONS };
}

async function verifyPassword(state: Settings, password: unknown): Promise<void> {
  if (!state.password) throw new Error('No password has been set.');
  const now = Date.now();
  const { attempts = 0, retryAt = 0 } = (await chrome.storage.session.get(['attempts', 'retryAt'])) as {
    attempts?: number;
    retryAt?: number;
  };
  if (retryAt > now) throw new Error(`Too many tries. Wait ${Math.ceil((retryAt - now) / 1000)} seconds.`);
  const hash = await derive(String(password ?? ''), fromBase64(state.password.salt), state.password.iterations);
  if (hash === state.password.hash) {
    await chrome.storage.session.remove(['attempts', 'retryAt']);
    return;
  }
  if (attempts + 1 >= MAX_ATTEMPTS) {
    await chrome.storage.session.set({ attempts: 0, retryAt: now + LOCKOUT_MS });
    throw new Error('Too many tries. Wait 60 seconds.');
  }
  await chrome.storage.session.set({ attempts: attempts + 1 });
  throw new Error('That password is not right.');
}

async function grantUnlock(): Promise<number> {
  const until = Date.now() + UNLOCK_WINDOW_MINUTES * MINUTE;
  await chrome.storage.session.set({ unlockedUntil: until });
  await chrome.alarms.create('relock', { when: until });
  return until;
}

async function requireUnlocked(state: Settings): Promise<void> {
  const lock = await lockInfo(state);
  if (lock.reason === 'session') throw new Error('Gasha is locked until your focus session ends.');
  if (lock.reason === 'password') throw new Error('Unlock Gasha with your password first.');
}

async function storedImageIds(): Promise<string[]> {
  const keys = await chrome.storage.local.getKeys();
  return keys.filter((key) => key.startsWith(IMAGE_PREFIX)).map((key) => key.slice(IMAGE_PREFIX.length));
}

async function cleanupImages(notebook: Notebook): Promise<void> {
  const used = new Set(notebook.blocks.flatMap((block) => (block.type === 'image' ? [block.imageId] : [])));
  const stale = (await storedImageIds()).filter((id) => !used.has(id));
  if (stale.length) await chrome.storage.local.remove(stale.map((id) => `${IMAGE_PREFIX}${id}`));
}

const handlers: Handlers = {
  async getState(): Promise<PublicState> {
    const state = await refreshSession();
    const now = Date.now();
    const lock = await lockInfo(state, now);
    const { retryAt = 0 } = (await chrome.storage.session.get('retryAt')) as { retryAt?: number };
    return {
      now,
      sites: state.sites,
      blockMode: state.blockMode,
      protectAlways: state.protectAlways,
      lockExtensionsPage: state.lockExtensionsPage,
      hasPassword: Boolean(state.password),
      session: sessionActive(state, now) ? state.session : null,
      stats: state.stats,
      blocking: blockingActive(state, now),
      locked: lock.locked,
      lockReason: lock.reason,
      unlockedUntil: lock.unlockedUntil,
      retryAt: retryAt > now ? retryAt : 0
    };
  },

  async addSites({ entries }) {
    const state = await refreshSession();
    const list = Array.isArray(entries) ? entries : String(entries ?? '').split(/[\s,]+/);
    const sites = [...state.sites];
    const added: string[] = [];
    const invalid: string[] = [];
    let full = false;
    for (const raw of list) {
      const text = String(raw ?? '').trim();
      if (!text) continue;
      const entry = normalizeEntry(text);
      if (!entry) {
        invalid.push(text);
        continue;
      }
      if (sites.includes(entry)) continue;
      if (sites.length >= MAX_SITES) {
        full = true;
        break;
      }
      sites.push(entry);
      added.push(entry);
    }
    if (added.length) {
      await chrome.storage.local.set({ sites });
      await applyRules({ ...state, sites });
      await sweepTabs();
    }
    return { added, invalid, full };
  },

  async removeSite({ entry }) {
    const state = await refreshSession();
    await requireUnlocked(state);
    const sites = state.sites.filter((site) => site !== entry);
    await chrome.storage.local.set({ sites });
    await applyRules({ ...state, sites });
    return {};
  },

  async saveSettings({ settings }) {
    const state = await refreshSession();
    await requireUnlocked(state);
    const update: SettingsPatch = {};
    if (settings.blockMode !== undefined) {
      if (settings.blockMode !== 'always' && settings.blockMode !== 'session') throw new Error('Pick when sites should be blocked.');
      update.blockMode = settings.blockMode;
    }
    if (settings.protectAlways !== undefined) {
      if (settings.protectAlways && !state.password) throw new Error('Set a password first.');
      update.protectAlways = Boolean(settings.protectAlways);
    }
    if (settings.lockExtensionsPage !== undefined) update.lockExtensionsPage = Boolean(settings.lockExtensionsPage);
    await chrome.storage.local.set(update);
    if (update.protectAlways) {
      await chrome.storage.session.remove('unlockedUntil');
      await chrome.alarms.clear('relock');
    }
    await applyRules({ ...state, ...update });
    await sweepTabs();
    return {};
  },

  async setPassword({ current, next }) {
    const state = await refreshSession();
    await requireUnlocked(state);
    if (state.password) await verifyPassword(state, current);
    const value = String(next ?? '');
    if (value.length < 4) throw new Error('Use at least 4 characters.');
    await chrome.storage.local.set({ password: await createPassword(value) });
    return {};
  },

  async removePassword({ current }) {
    const state = await refreshSession();
    await requireUnlocked(state);
    await verifyPassword(state, current);
    await chrome.storage.local.set({ password: null, protectAlways: false });
    await chrome.storage.session.remove('unlockedUntil');
    await chrome.alarms.clear('relock');
    return {};
  },

  async startSession({ minutes }) {
    const value = Math.round(Number(minutes));
    if (!Number.isFinite(value) || value < 1 || value > MAX_SESSION_MINUTES) {
      throw new Error('Pick a time between 1 minute and 24 hours.');
    }
    const state = await refreshSession();
    if (sessionActive(state)) throw new Error('A focus session is already running.');
    if (!state.sites.length) throw new Error('Add at least one site to block first.');
    const now = Date.now();
    const session: Session = { startedAt: now, endsAt: now + value * MINUTE, minutes: value };
    await chrome.storage.local.set({ session });
    await scheduleSession(session);
    const next: Settings = { ...state, session };
    await applyRules(next);
    await updateBadge(next);
    await sweepTabs();
    return { session };
  },

  async extendSession({ minutes }) {
    const value = Math.round(Number(minutes));
    const state = await refreshSession();
    if (!state.session || !sessionActive(state)) throw new Error('No focus session is running.');
    if (!Number.isFinite(value) || value < 1) throw new Error('Pick how many minutes to add.');
    const endsAt = Math.min(state.session.endsAt + value * MINUTE, Date.now() + MAX_SESSION_MINUTES * MINUTE);
    const session: Session = {
      ...state.session,
      endsAt,
      minutes: Math.round((endsAt - state.session.startedAt) / MINUTE)
    };
    await chrome.storage.local.set({ session });
    await scheduleSession(session);
    await updateBadge({ ...state, session });
    return { session };
  },

  async endSession({ password }) {
    const state = await refreshSession();
    if (!sessionActive(state)) return {};
    if (!state.password) throw new Error('No password was set, so this session runs until the timer ends.');
    await verifyPassword(state, password);
    await finishSession(false);
    if (state.protectAlways) await grantUnlock();
    return {};
  },

  async unlock({ password }) {
    const state = await refreshSession();
    if (sessionActive(state)) throw new Error('End the focus session first.');
    await verifyPassword(state, password);
    return { unlockedUntil: await grantUnlock() };
  },

  async lockNow() {
    await chrome.storage.session.remove('unlockedUntil');
    await chrome.alarms.clear('relock');
    await sweepTabs();
    return {};
  },

  async saveNotebook({ notebook, cleanup }) {
    const state = await refreshSession();
    await requireUnlocked(state);
    const clean = sanitizeNotebook(notebook);
    await chrome.storage.local.set({ [NOTEBOOK_KEY]: clean });
    if (cleanup) await cleanupImages(clean);
    return {};
  },

  async saveImage({ id, dataUrl }) {
    const state = await refreshSession();
    await requireUnlocked(state);
    if (!isImageId(id) || !isImageData(dataUrl)) throw new Error('That photo could not be saved. Try a smaller JPG or PNG.');
    await chrome.storage.local.set({ [`${IMAGE_PREFIX}${id}`]: dataUrl });
    return {};
  },

  async importBackup({ backup }) {
    const state = await refreshSession();
    await requireUnlocked(state);
    if (!isRecord(backup) || backup.app !== 'gasha') throw new Error('That file is not a Gasha backup.');
    const rawSites = Array.isArray(backup.sites) ? backup.sites : [];
    const sites = [...new Set(rawSites.map((site) => normalizeEntry(site)).filter((site): site is string => Boolean(site)))].slice(
      0,
      MAX_SITES
    );
    const notebook = sanitizeNotebook(backup.notebook);
    const images: Record<string, string> = {};
    if (isRecord(backup.images)) {
      for (const [id, data] of Object.entries(backup.images)) {
        if (isImageId(id) && isImageData(data)) images[`${IMAGE_PREFIX}${id}`] = data;
      }
    }
    const blockMode = backup.blockMode === 'session' ? 'session' : 'always';
    const lockExtensionsPage = backup.lockExtensionsPage !== false;
    const stale = await storedImageIds();
    if (stale.length) await chrome.storage.local.remove(stale.map((id) => `${IMAGE_PREFIX}${id}`));
    await chrome.storage.local.set({ sites, blockMode, lockExtensionsPage, [NOTEBOOK_KEY]: notebook, ...images });
    await applyRules({ ...state, sites, blockMode, lockExtensionsPage });
    await sweepTabs();
    return { sites: sites.length, blocks: notebook.blocks.length };
  }
};

async function boot(): Promise<void> {
  const state = await refreshSession();
  if (state.session) await scheduleSession(state.session);
  await applyRules(state);
  await updateBadge(state);
  const stored = await chrome.storage.local.get(NOTEBOOK_KEY);
  if (stored[NOTEBOOK_KEY]) await cleanupImages(sanitizeNotebook(stored[NOTEBOOK_KEY]));
  else await chrome.storage.local.set({ [NOTEBOOK_KEY]: STARTER_NOTEBOOK });
  await sweepTabs();
}

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !isRecord(message)) return false;
  const type = message.type;
  if (typeof type !== 'string' || !Object.hasOwn(handlers, type)) return false;
  const handler = handlers[type as ApiName] as (request: unknown) => Promise<object>;
  exclusive(() => handler(message))
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : 'Something went wrong.' }));
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== 'complete') return;
  checkTab(tabId, changeInfo.url || tab.url, tab.status).catch(() => undefined);
});

chrome.tabs.onReplaced.addListener((addedTabId) => {
  chrome.tabs
    .get(addedTabId)
    .then((tab) => checkTab(addedTabId, tab.url, tab.status))
    .catch(() => undefined);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'relock') {
    exclusive(sweepTabs).catch(() => undefined);
    return;
  }
  if (alarm.name !== 'session-end' && alarm.name !== 'session-tick') return;
  exclusive(async () => {
    const state = await refreshSession();
    await updateBadge(state);
    if (state.session && alarm.name === 'session-end') {
      await chrome.alarms.create('session-end', { when: state.session.endsAt + 1000 });
    }
  }).catch(() => undefined);
});

chrome.runtime.onInstalled.addListener((details) => {
  exclusive(boot).catch(() => undefined);
  if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('options.html?welcome=1') }).catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => {
  exclusive(boot).catch(() => undefined);
});
