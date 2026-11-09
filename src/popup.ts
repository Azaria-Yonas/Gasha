import {
  MAX_SESSION_MINUTES,
  PRESETS,
  findMatch,
  formatClock,
  formatTime,
  plural,
  send,
  shortDuration,
  siteFromUrl,
  type PublicState
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
  setMessage,
  type Shield
} from './ui.js';

const MINUTES_KEY = 'gasha:lastMinutes';
const WATCHED = new Set(['sites', 'blockMode', 'session', 'password', 'protectAlways', 'lockExtensionsPage']);
const root = document.getElementById('root') as HTMLElement;

let state: PublicState | null = null;
let currentSite: string | null = null;
let incognitoAllowed = true;
let minutes = readMinutes();
let custom = !(PRESETS as readonly number[]).includes(minutes);
let raiseNext = false;
let focusKey: string | null = null;
let shield: Shield | null = null;
let clockEl: HTMLElement | null = null;
let endsEl: HTMLElement | null = null;

function readMinutes(): number {
  try {
    const value = Number(localStorage.getItem(MINUTES_KEY));
    return value >= 1 && value <= MAX_SESSION_MINUTES ? value : 25;
  } catch {
    return 25;
  }
}

function saveMinutes(value: number): void {
  try {
    localStorage.setItem(MINUTES_KEY, String(value));
  } catch {
    return;
  }
}

async function openSettings(section = ''): Promise<void> {
  await openExtensionPage(`options.html${section ? `#${section}` : ''}`);
  window.close();
}

function blockableSite(current: PublicState): string | null {
  if (!currentSite || findMatch(`https://${currentSite}/`, current.sites)) return null;
  return currentSite;
}

async function refresh(): Promise<void> {
  state = await send('getState', {});
  render();
}

async function blockCurrent(msg: HTMLElement): Promise<void> {
  if (!currentSite) return;
  try {
    await send('addSites', { entries: [currentSite] });
    await refresh();
  } catch (error) {
    setMessage(msg, errorText(error), 'error');
  }
}

async function startSession(button: HTMLButtonElement, msg: HTMLElement): Promise<void> {
  const value = Math.round(minutes);
  if (!(value >= 1 && value <= MAX_SESSION_MINUTES)) {
    setMessage(msg, 'Pick a time between 1 minute and 24 hours.', 'error');
    return;
  }
  button.disabled = true;
  try {
    await send('startSession', { minutes: value });
    saveMinutes(value);
    raiseNext = true;
    await refresh();
  } catch (error) {
    setMessage(msg, errorText(error), 'error');
    button.disabled = false;
  }
}

async function extend(msg: HTMLElement): Promise<void> {
  try {
    await send('extendSession', { minutes: 15 });
    await refresh();
  } catch (error) {
    setMessage(msg, errorText(error), 'error');
  }
}

function statusText(current: PublicState): { title: string; detail: string } {
  const count = current.sites.length;
  if (!count) return { title: 'No sites blocked yet', detail: 'Add the sites you open out of habit.' };
  if (current.blockMode === 'always') {
    return { title: `Blocking ${plural(count, 'site')}`, detail: 'Start a session to lock them in.' };
  }
  return { title: `${plural(count, 'site')} ready`, detail: 'They get blocked when you start a session.' };
}

function chip(label: string, key: string, checked: boolean, onSelect: () => void): HTMLButtonElement {
  return h(
    'button',
    {
      type: 'button',
      class: 'chip',
      role: 'radio',
      'aria-checked': checked ? 'true' : 'false',
      'data-key': key,
      onclick: () => {
        focusKey = key;
        onSelect();
      }
    },
    label
  );
}

function updateEnds(): void {
  if (endsEl) endsEl.textContent = `Ends at ${formatTime(Date.now() + minutes * 60000)}`;
}

function idleView(current: PublicState): HTMLElement {
  const mini = createShield(24, 'Shield down');
  mini.set(0);
  const msg = h('p', { class: 'msg', role: 'status' });
  const status = statusText(current);
  const site = blockableSite(current);

  const chips = PRESETS.map((value) =>
    chip(shortDuration(value), String(value), !custom && minutes === value, () => {
      custom = false;
      minutes = value;
      saveMinutes(value);
      render();
    })
  );
  chips.push(
    chip('Custom', 'custom', custom, () => {
      custom = true;
      render();
    })
  );

  const customInput = h('input', {
    class: 'input',
    type: 'number',
    min: 1,
    max: MAX_SESSION_MINUTES,
    step: 1,
    value: minutes,
    'aria-label': 'Session length in minutes',
    oninput: (event: Event) => {
      const value = Number((event.target as HTMLInputElement).value);
      if (value >= 1 && value <= MAX_SESSION_MINUTES) {
        minutes = Math.round(value);
        updateEnds();
      }
    }
  });

  const start = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-gilt btn-block',
      disabled: !current.sites.length,
      onclick: () => startSession(start, msg)
    },
    'Start focus session'
  );
  endsEl = h('p', { class: 'hint' });
  updateEnds();

  return h(
    'div',
    { class: 'idle' },
    h(
      'section',
      { class: 'status' },
      h('div', { class: 'status-shield' }, mini.root),
      h(
        'div',
        {},
        h('h1', { class: 'status-title' }, status.title),
        h('p', { class: 'status-detail' }, status.detail),
        current.sites.length
          ? null
          : h('button', { type: 'button', class: 'btn btn-gilt btn-sm', onclick: () => openSettings('sites') }, 'Add sites')
      )
    ),
    site
      ? h(
          'section',
          { class: 'quick' },
          h('p', {}, h('strong', {}, site), ' is open in this tab'),
          h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => blockCurrent(msg) }, 'Block it')
        )
      : null,
    h(
      'section',
      { class: 'start', 'aria-labelledby': 'start-title' },
      h('h2', { id: 'start-title', class: 'section-title' }, 'Start a focus session'),
      h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Session length' }, ...chips),
      custom ? h('label', { class: 'custom' }, customInput, h('span', {}, 'minutes')) : null,
      start,
      endsEl,
      current.hasPassword
        ? null
        : h(
            'p',
            { class: 'warn' },
            'No password is set, so a session cannot be ended early. ',
            h(
              'a',
              {
                href: '#',
                onclick: (event: Event) => {
                  event.preventDefault();
                  void openSettings('password');
                }
              },
              'Set a password'
            )
          )
    ),
    msg
  );
}

function endEarlyForm(msg: HTMLElement): HTMLElement {
  const input = h('input', {
    class: 'input',
    type: 'password',
    placeholder: 'Password',
    autocomplete: 'current-password',
    'aria-label': 'Password'
  });
  const button = h('button', { type: 'submit', class: 'btn btn-outline' }, 'End session');
  const form = h(
    'form',
    {
      class: 'inline-form',
      onsubmit: async (event: SubmitEvent) => {
        event.preventDefault();
        button.disabled = true;
        try {
          await send('endSession', { password: input.value });
          await refresh();
        } catch (error) {
          setMessage(msg, errorText(error), 'error');
          input.select();
          button.disabled = false;
        }
      }
    },
    input,
    button
  );
  return h(
    'details',
    {
      class: 'end-early',
      ontoggle: (event: Event) => {
        if ((event.target as HTMLDetailsElement).open) input.focus();
      }
    },
    h('summary', {}, 'End session early'),
    form
  );
}

function sessionView(current: PublicState): HTMLElement {
  const session = current.session;
  if (!session) return h('div');
  const msg = h('p', { class: 'msg', role: 'status' });
  shield = createShield(36, 'Time left in this focus session');
  const fraction = sessionFraction(session);
  if (raiseNext) {
    shield.raise(fraction);
    raiseNext = false;
  } else {
    shield.set(fraction);
  }
  clockEl = h('span', { class: 'clock-time' }, formatClock(session.endsAt - Date.now()));
  const site = blockableSite(current);

  return h(
    'section',
    { class: 'session' },
    h('div', { class: 'dial' }, shield.root, h('div', { class: 'dial-center clock' }, clockEl, h('span', { class: 'clock-label' }, 'left'))),
    h('h1', { class: 'session-title' }, `Shield up until ${formatTime(session.endsAt)}`),
    h('p', { class: 'session-detail' }, `${plural(current.sites.length, 'site')} blocked. Stay with it.`),
    h(
      'div',
      { class: 'row' },
      h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => extend(msg) }, icon('plus'), 'Add 15 min'),
      site ? h('button', { type: 'button', class: 'btn btn-outline btn-sm', onclick: () => blockCurrent(msg) }, `Block ${site}`) : null
    ),
    current.hasPassword ? endEarlyForm(msg) : h('p', { class: 'note' }, 'No password was set, so this session runs until the timer ends.'),
    msg
  );
}

function incognitoNote(): HTMLElement {
  return h(
    'p',
    { class: 'incognito' },
    h('span', {}, 'Incognito windows are not covered yet.'),
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn-outline btn-sm',
        onclick: async () => {
          await chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
          window.close();
        }
      },
      'Turn on'
    )
  );
}

function render(): void {
  if (!state) return;
  shield = null;
  clockEl = null;
  endsEl = null;
  root.replaceChildren(state.session ? sessionView(state) : idleView(state));
  if (!state.locked && !incognitoAllowed) root.append(incognitoNote());
  if (focusKey) {
    root.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)?.focus();
    if (focusKey === 'custom') root.querySelector<HTMLInputElement>('.custom .input')?.focus();
    focusKey = null;
  }
}

function tick(): void {
  if (!state?.session) return;
  const remaining = state.session.endsAt - Date.now();
  if (remaining <= 0) {
    void refresh();
    return;
  }
  if (clockEl) clockEl.textContent = formatClock(remaining);
  shield?.set(sessionFraction(state.session));
}

async function init(): Promise<void> {
  document.getElementById('open-notebook')?.append(icon('notebook'));
  document.getElementById('open-settings')?.append(icon('settings'));
  document.getElementById('open-notebook')?.addEventListener('click', async () => {
    await openExtensionPage('notebook.html');
    window.close();
  });
  document.getElementById('open-settings')?.addEventListener('click', () => void openSettings());

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentSite = siteFromUrl(tab?.url);
  incognitoAllowed = await chrome.extension.isAllowedIncognitoAccess();
  await refresh();
  onStorageChange((keys) => {
    if ([...keys].some((key) => WATCHED.has(key))) void refresh();
  });
  everySecond(tick);
}

void init();
