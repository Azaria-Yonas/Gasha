import {
  IMAGE_PREFIX,
  NOTEBOOK_KEY,
  STARTER_NOTEBOOK,
  SUGGESTIONS,
  formatClock,
  formatDuration,
  formatTime,
  isImageData,
  plural,
  sanitizeNotebook,
  send,
  splitEntry,
  type Backup,
  type BlockMode,
  type PublicState,
  type SettingsPatch
} from './shared.js';
import {
  createShield,
  errorText,
  everySecond,
  h,
  icon,
  onStorageChange,
  openExtensionPage,
  sessionFraction,
  setMessage
} from './ui.js';

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const els = {
  main: byId('main'),
  welcome: byId('welcome'),
  lockBanner: byId('lock-banner'),
  railShield: byId('rail-shield'),
  railClock: byId('rail-clock'),
  railStatus: byId('rail-status'),
  railLock: byId('rail-lock'),
  stats: byId('stats'),
  railNotebook: byId<HTMLButtonElement>('rail-notebook'),
  siteCount: byId('site-count'),
  addForm: byId<HTMLFormElement>('add-form'),
  addInput: byId<HTMLInputElement>('add-input'),
  addMsg: byId('add-msg'),
  suggestions: byId('suggestions'),
  siteList: byId('site-list'),
  editNotebook: byId<HTMLButtonElement>('edit-notebook'),
  viewNotebook: byId<HTMLButtonElement>('view-notebook'),
  scheduleMsg: byId('schedule-msg'),
  passwordBody: byId('password-body'),
  protectAlways: byId<HTMLInputElement>('protect-always'),
  passwordMsg: byId('password-msg'),
  lockExtensions: byId<HTMLInputElement>('lock-extensions'),
  incognitoRow: byId('incognito-row'),
  protectionMsg: byId('protection-msg'),
  downloadBackup: byId<HTMLButtonElement>('download-backup'),
  restoreBackup: byId<HTMLButtonElement>('restore-backup'),
  restoreInput: byId<HTMLInputElement>('restore-input'),
  restoreConfirm: byId('restore-confirm'),
  backupMsg: byId('backup-msg')
};

const WATCHED = new Set([
  'sites',
  'blockMode',
  'session',
  'password',
  'protectAlways',
  'lockExtensionsPage',
  'stats',
  'unlockedUntil'
]);
const shield = createShield(36, 'Focus session timer');
els.railShield.append(shield.root);

let state: PublicState | null = null;
let incognitoAllowed = true;
let passwordKey = '';
let lockKey = '';
let railClockText: HTMLElement | null = null;
let unlockedText: HTMLElement | null = null;

async function refresh(): Promise<void> {
  state = await send('getState', {});
  render();
}

function passwordInput(label: string, autocomplete: string): HTMLInputElement {
  return h('input', { class: 'input', type: 'password', autocomplete, 'aria-label': label });
}

function field(label: string, input: HTMLInputElement): HTMLElement {
  return h('label', {}, h('span', { class: 'label' }, label), input);
}

function railPasswordForm(label: string, action: (password: string) => Promise<void>): HTMLElement {
  const input = passwordInput('Password', 'current-password');
  input.placeholder = 'Password';
  const button = h('button', { type: 'submit', class: 'btn btn-gilt' }, label);
  const msg = h('p', { class: 'msg', role: 'status' });
  return h(
    'form',
    {
      class: 'rail-form',
      onsubmit: async (event: SubmitEvent) => {
        event.preventDefault();
        button.disabled = true;
        try {
          await action(input.value);
          lockKey = '';
          await refresh();
        } catch (error) {
          setMessage(msg, errorText(error), 'error');
          input.select();
          button.disabled = false;
        }
      }
    },
    h('div', { class: 'inline-form' }, input, button),
    msg
  );
}

function lockArea(current: PublicState): Node[] {
  unlockedText = null;
  if (current.lockReason === 'session') {
    if (!current.hasPassword) return [h('p', {}, 'No password was set, so this session runs until the timer ends.')];
    return [
      h('p', {}, 'Need to stop early? Type the password.'),
      railPasswordForm('End session', async (password) => {
        await send('endSession', { password });
      })
    ];
  }
  if (current.lockReason === 'password') {
    return [
      h('p', {}, 'Settings are locked with your password.'),
      railPasswordForm('Unlock', async (password) => {
        await send('unlock', { password });
      })
    ];
  }
  if (current.unlockedUntil) {
    unlockedText = h('p', {});
    return [
      unlockedText,
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-outline btn-sm',
          onclick: async () => {
            await send('lockNow', {});
            lockKey = '';
            await refresh();
          }
        },
        icon('lock'),
        'Lock now'
      )
    ];
  }
  return [];
}

function updateUnlockedText(current: PublicState): void {
  if (!unlockedText || !current.unlockedUntil) return;
  const minutes = Math.max(1, Math.ceil((current.unlockedUntil - Date.now()) / 60000));
  unlockedText.textContent = `Unlocked for ${plural(minutes, 'more minute')}.`;
}

function renderRail(current: PublicState): void {
  shield.set(sessionFraction(current.session));
  if (current.session) {
    railClockText = h('span', { class: 'big clock' }, formatClock(current.session.endsAt - Date.now()));
    els.railClock.replaceChildren(railClockText, h('span', { class: 'small' }, 'left'));
    els.railStatus.textContent = `Shield up until ${formatTime(current.session.endsAt)}`;
  } else {
    railClockText = null;
    const count = current.sites.length;
    els.railClock.replaceChildren(
      h('span', { class: 'big clock' }, String(count)),
      h('span', { class: 'small' }, count === 1 ? 'site on your list' : 'sites on your list')
    );
    els.railStatus.textContent = !count
      ? 'Add sites to get started'
      : current.blockMode === 'always'
        ? 'Blocked all the time'
        : 'Blocked during focus sessions';
  }
  const key = current.lockReason === 'session' ? `session-${current.hasPassword}` : current.lockReason ?? (current.unlockedUntil ? 'unlocked' : 'open');
  if (key !== lockKey) {
    lockKey = key;
    els.railLock.replaceChildren(...lockArea(current));
  }
  updateUnlockedText(current);
  els.stats.replaceChildren(
    h('div', {}, h('dt', {}, 'Sessions finished'), h('dd', {}, String(current.stats.sessions))),
    h('div', {}, h('dt', {}, 'Time focused'), h('dd', {}, formatDuration(current.stats.minutes)))
  );
}

function renderBanner(current: PublicState): void {
  els.lockBanner.hidden = !current.locked;
  if (!current.locked) return;
  const text =
    current.lockReason === 'session' && current.session
      ? `Locked until ${formatTime(current.session.endsAt)}. You can still add sites. Everything else opens up when the session ends.`
      : 'Settings are locked with your password. You can still add sites. Type the password in the Gasha panel to change anything else.';
  els.lockBanner.replaceChildren(icon('lock'), h('span', {}, text));
}

async function addSites(entries: string[] | string): Promise<void> {
  try {
    const result = await send('addSites', { entries });
    const parts: string[] = [];
    if (result.added.length === 1) parts.push(`Added ${result.added[0]}.`);
    if (result.added.length > 1) parts.push(`Added ${result.added.length} sites.`);
    if (result.invalid.length) parts.push(`Could not read ${result.invalid.join(', ')}. Use a web address like youtube.com.`);
    if (result.full) parts.push('You reached the limit of 500 sites.');
    if (!parts.length) parts.push('That is already on your list.');
    setMessage(els.addMsg, parts.join(' '), result.invalid.length && !result.added.length ? 'error' : 'ok');
    if (result.added.length && !result.invalid.length) els.addInput.value = '';
    await refresh();
  } catch (error) {
    setMessage(els.addMsg, errorText(error), 'error');
  }
}

async function removeSite(site: string): Promise<void> {
  try {
    await send('removeSite', { entry: site });
    setMessage(els.addMsg, `Removed ${site}.`, 'ok');
    await refresh();
  } catch (error) {
    setMessage(els.addMsg, errorText(error), 'error');
  }
}

function renderSites(current: PublicState): void {
  els.siteCount.textContent = current.sites.length ? plural(current.sites.length, 'site') : '';
  const items = current.sites.map((site) => {
    const { host, path } = splitEntry(site);
    return h(
      'li',
      { class: 'site' },
      h('span', { class: 'site-name', title: site }, h('span', { class: 'site-host' }, host), path ? h('span', { class: 'site-path' }, path) : null),
      h(
        'button',
        {
          type: 'button',
          class: 'btn btn-quiet btn-sm',
          disabled: current.locked,
          'aria-label': `Remove ${site}`,
          onclick: () => removeSite(site)
        },
        'Remove'
      )
    );
  });
  els.siteList.replaceChildren(
    ...(items.length ? items : [h('li', { class: 'empty' }, 'No sites yet. Add the ones that pull you away when you should be working.')])
  );
  const missing = SUGGESTIONS.filter((site) => !current.sites.includes(site));
  els.suggestions.replaceChildren(
    ...(missing.length
      ? [
          h('span', { class: 'label' }, 'Common picks'),
          ...missing.map((site) =>
            h('button', { type: 'button', class: 'chip', 'aria-label': `Block ${site}`, onclick: () => addSites([site]) }, icon('plus'), site)
          )
        ]
      : [])
  );
}

function renderSchedule(current: PublicState): void {
  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="blockMode"]')) {
    radio.checked = radio.value === current.blockMode;
    radio.disabled = current.locked;
  }
}

async function submitPassword(event: SubmitEvent, action: () => Promise<string>): Promise<void> {
  event.preventDefault();
  const form = event.currentTarget as HTMLFormElement;
  const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  if (button) button.disabled = true;
  try {
    const text = await action();
    setMessage(els.passwordMsg, text, 'ok');
    passwordKey = '';
    lockKey = '';
    await refresh();
  } catch (error) {
    setMessage(els.passwordMsg, errorText(error), 'error');
    if (button) button.disabled = false;
  }
}

function passwordForms(current: PublicState): HTMLElement {
  const wrap = h('fieldset', { class: 'password-forms', disabled: current.locked });
  if (!current.hasPassword) {
    const next = passwordInput('New password', 'new-password');
    const again = passwordInput('Type it again', 'new-password');
    wrap.append(
      h(
        'form',
        {
          class: 'set-form',
          onsubmit: (event: SubmitEvent) =>
            submitPassword(event, async () => {
              if (next.value !== again.value) throw new Error('The two passwords do not match.');
              await send('setPassword', { next: next.value });
              return 'Password set. It is now needed to end a session early.';
            })
        },
        h('div', { class: 'row' }, field('New password', next), field('Type it again', again)),
        h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'btn btn-velvet' }, 'Set password'))
      )
    );
    return wrap;
  }

  const current1 = passwordInput('Current password', 'current-password');
  const next = passwordInput('New password', 'new-password');
  const again = passwordInput('Type it again', 'new-password');
  const current2 = passwordInput('Current password', 'current-password');
  wrap.append(
    h('p', { class: 'status-line' }, icon('lock'), 'A password is set.'),
    h(
      'details',
      {},
      h('summary', {}, 'Change password'),
      h(
        'form',
        {
          onsubmit: (event: SubmitEvent) =>
            submitPassword(event, async () => {
              if (next.value !== again.value) throw new Error('The two new passwords do not match.');
              await send('setPassword', { current: current1.value, next: next.value });
              return 'Password changed.';
            })
        },
        field('Current password', current1),
        h('div', { class: 'row' }, field('New password', next), field('Type it again', again)),
        h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'btn btn-velvet' }, 'Change password'))
      )
    ),
    h(
      'details',
      {},
      h('summary', {}, 'Remove password'),
      h(
        'form',
        {
          onsubmit: (event: SubmitEvent) =>
            submitPassword(event, async () => {
              await send('removePassword', { current: current2.value });
              return 'Password removed. Sessions can no longer be ended early.';
            })
        },
        field('Current password', current2),
        h('p', { class: 'msg' }, 'Without a password, a focus session always runs until its timer ends.'),
        h('div', { class: 'form-actions' }, h('button', { type: 'submit', class: 'btn btn-danger' }, 'Remove password'))
      )
    )
  );
  return wrap;
}

function renderPassword(current: PublicState): void {
  const key = `${current.hasPassword}-${current.locked}`;
  if (key !== passwordKey) {
    passwordKey = key;
    els.passwordBody.replaceChildren(passwordForms(current));
  }
  els.protectAlways.checked = current.protectAlways;
  els.protectAlways.disabled = current.locked || !current.hasPassword;
}

function renderProtection(current: PublicState): void {
  els.lockExtensions.checked = current.lockExtensionsPage;
  els.lockExtensions.disabled = current.locked;
  const row: (Node | null)[] = [
    h(
      'p',
      {},
      h('strong', {}, incognitoAllowed ? 'Incognito windows are covered' : 'Incognito windows are not covered yet'),
      h(
        'span',
        {},
        incognitoAllowed
          ? 'Blocked sites stay blocked in private windows too.'
          : 'Turn on Allow in Incognito so a private window cannot get around Gasha.'
      )
    ),
    incognitoAllowed
      ? null
      : h(
          'button',
          {
            type: 'button',
            class: 'btn btn-outline btn-sm',
            disabled: current.locked,
            onclick: () => chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` })
          },
          'Open extension details'
        )
  ];
  els.incognitoRow.replaceChildren(...row.filter((node): node is Node => node !== null));
}

function render(): void {
  if (!state) return;
  els.main.classList.toggle('is-locked', state.locked);
  renderRail(state);
  renderBanner(state);
  renderSites(state);
  renderSchedule(state);
  renderPassword(state);
  renderProtection(state);
  els.restoreBackup.disabled = state.locked;
}

async function saveSetting(settings: SettingsPatch, target: HTMLElement, done: string): Promise<void> {
  try {
    await send('saveSettings', { settings });
    setMessage(target, done, 'ok');
  } catch (error) {
    setMessage(target, errorText(error), 'error');
  }
  await refresh();
}

async function downloadBackup(): Promise<void> {
  if (!state) return;
  const stored = await chrome.storage.local.get(null);
  const notebook = sanitizeNotebook(stored[NOTEBOOK_KEY] ?? STARTER_NOTEBOOK);
  const images: Record<string, string> = {};
  for (const block of notebook.blocks) {
    if (block.type !== 'image') continue;
    const data = stored[`${IMAGE_PREFIX}${block.imageId}`];
    if (isImageData(data)) images[block.imageId] = data;
  }
  const backup: Backup = {
    app: 'gasha',
    version: 1,
    exportedAt: new Date().toISOString(),
    sites: state.sites,
    blockMode: state.blockMode,
    lockExtensionsPage: state.lockExtensionsPage,
    notebook,
    images
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const link = h('a', { href: url, download: `gasha-backup-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  setMessage(els.backupMsg, 'Backup downloaded. Keep the file somewhere safe.', 'ok');
}

async function chooseBackup(file: File): Promise<void> {
  let backup: unknown;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    setMessage(els.backupMsg, 'That file could not be read. Pick a Gasha backup file.', 'error');
    return;
  }
  const replace = h('button', { type: 'button', class: 'btn btn-velvet btn-sm' }, 'Replace with backup');
  const cancel = h('button', { type: 'button', class: 'btn btn-outline btn-sm' }, 'Cancel');
  els.restoreConfirm.replaceChildren(
    h('p', {}, `This replaces your blocked sites and notebook with the ones in ${file.name}.`),
    replace,
    cancel
  );
  els.restoreConfirm.hidden = false;
  cancel.addEventListener('click', () => {
    els.restoreConfirm.hidden = true;
  });
  replace.addEventListener('click', async () => {
    replace.disabled = true;
    try {
      const result = await send('importBackup', { backup });
      setMessage(els.backupMsg, `Restored ${plural(result.sites, 'site')} and ${plural(result.blocks, 'notebook item')}.`, 'ok');
      els.restoreConfirm.hidden = true;
      await refresh();
    } catch (error) {
      setMessage(els.backupMsg, errorText(error), 'error');
      replace.disabled = false;
    }
  });
}

function tick(): void {
  if (!state) return;
  const now = Date.now();
  if ((state.session && state.session.endsAt <= now) || (state.unlockedUntil && state.unlockedUntil <= now)) {
    void refresh();
    return;
  }
  if (state.session) {
    shield.set(sessionFraction(state.session, now));
    if (railClockText) railClockText.textContent = formatClock(state.session.endsAt - now);
  }
  updateUnlockedText(state);
}

async function init(): Promise<void> {
  if (new URLSearchParams(location.search).has('welcome')) els.welcome.hidden = false;

  els.addForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (els.addInput.value.trim()) void addSites(els.addInput.value);
  });

  for (const radio of document.querySelectorAll<HTMLInputElement>('input[name="blockMode"]')) {
    radio.addEventListener('change', () => {
      const mode = radio.value as BlockMode;
      void saveSetting(
        { blockMode: mode },
        els.scheduleMsg,
        mode === 'always' ? 'Saved. Blocked sites stay blocked all the time.' : 'Saved. Sites are blocked only during focus sessions.'
      );
    });
  }

  els.protectAlways.addEventListener('change', () => {
    void saveSetting(
      { protectAlways: els.protectAlways.checked },
      els.passwordMsg,
      els.protectAlways.checked ? 'Settings are now locked. Use your password to unlock them.' : 'Settings no longer need the password outside of sessions.'
    );
  });

  els.lockExtensions.addEventListener('change', () => {
    void saveSetting(
      { lockExtensionsPage: els.lockExtensions.checked },
      els.protectionMsg,
      els.lockExtensions.checked ? 'The extensions page will be locked during sessions.' : 'The extensions page will stay open during sessions.'
    );
  });

  els.editNotebook.addEventListener('click', () => void openExtensionPage('notebook.html?edit=1'));
  els.viewNotebook.addEventListener('click', () => void openExtensionPage('notebook.html'));
  els.railNotebook.addEventListener('click', () => void openExtensionPage('notebook.html'));
  els.downloadBackup.addEventListener('click', () => {
    downloadBackup().catch((error: unknown) => setMessage(els.backupMsg, errorText(error), 'error'));
  });
  els.restoreBackup.addEventListener('click', () => els.restoreInput.click());
  els.restoreInput.addEventListener('change', () => {
    const file = els.restoreInput.files?.[0];
    els.restoreInput.value = '';
    if (file) void chooseBackup(file);
  });

  incognitoAllowed = await chrome.extension.isAllowedIncognitoAccess();
  await refresh();
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  onStorageChange((keys) => {
    if ([...keys].some((key) => WATCHED.has(key))) void refresh();
  });
  everySecond(tick);
}

void init();
