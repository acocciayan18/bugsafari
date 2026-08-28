import type { Page } from 'playwright';

// Custom (non-<select>) dropdown actuation. A React/Vue/Radix/MUI/Headless UI
// select renders its options in a listbox popup (often portalled to <body>), so a
// single trigger click only OPENS it — the value never changes and the option is
// never recorded. These helpers enumerate the just-opened popup, tag one option
// for a trusted Node-side click, and read the trigger's committed value so the
// selection can be verified. In-page bodies are strings (matching domParser) so the
// tsx build never injects __name helpers that crash the headless context.

// Temp selector the actuator clicks after an option is tagged in-page.
export const TAGGED_OPTION_SELECTOR = '[data-bugsafari-opt="1"]';

// How long to wait for lazily/asynchronously rendered options after the open click.
const OPTION_WAIT_MS = 1200;

export interface TaggedOption {
  label: string;
  total: number;
}

// Committed-value snapshot of a combobox trigger: visible label + active option id
// AND its resolved text + any inner input value + the selected option's text in the
// owned listbox + the expanded flag. The extra fields close false-negatives where a
// widget commits into a hidden input, an aria-selected option, or an activedescendant
// the bare label never reflected. Compared before/after a pick to confirm a change.
// An empty string means the trigger detached (navigation) — never a commit.
export async function readComboState(page: Page, triggerSelector: string): Promise<string> {
  return page
    .evaluate(
      `(() => {
        const t = document.querySelector(${JSON.stringify(triggerSelector)});
        if (!t) return '';
        const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
        const active = t.getAttribute('aria-activedescendant') || '';
        const activeText = active ? norm((document.getElementById(active) || {}).textContent) : '';
        const inner = t.querySelector('input');
        const val = inner ? (inner.value || '') : '';
        const text = norm(t.textContent);
        const ownedId = (t.getAttribute('aria-controls') || t.getAttribute('aria-owns') || '').split(' ')[0];
        const owned = ownedId ? document.getElementById(ownedId) : null;
        const sel = (owned || document).querySelector('[aria-selected="true"]');
        const selText = sel ? norm(sel.textContent) : '';
        const expanded = t.getAttribute('aria-expanded') || '';
        return [text, active, activeText, val, selText, expanded].join('|');
      })()`,
    )
    .then((v) => (typeof v === 'string' ? v : ''))
    .catch(() => '');
}

// Selection oracle: a committed pick is a NON-EMPTY committed-value signature that
// differs from the pre-open one. An empty `after` means the trigger detached
// (navigation), not a value change — the joined-pipe signature is otherwise always
// non-empty, so the emptiness check must stay independent of the difference check.
export function comboSelectionChanged(before: string, after: string): boolean {
  return after.length > 0 && after !== before;
}

// Poll the opened popup for enabled options, pick one deterministically by `index`
// (cursor-advanced by the caller so revisits exercise different values), and tag it
// with data-bugsafari-opt so the caller can trust-click it. Prefers the aria-controls/
// aria-owns listbox, then falls back to document-wide role=option/menuitem (portals),
// then to plain list items inside the owned container. Null when nothing selectable.
export async function pickAndTagOption(
  page: Page,
  triggerSelector: string,
  index: number,
): Promise<TaggedOption | null> {
  return page
    .evaluate(
      `(async () => {
        const trigger = document.querySelector(${JSON.stringify(triggerSelector)});
        if (!trigger) return null;

        const owned = () => {
          const controls = trigger.getAttribute('aria-controls');
          const owns = trigger.getAttribute('aria-owns');
          const id = (controls || owns || '').split(' ')[0];
          return id ? document.getElementById(id) : null;
        };
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const enabled = (el) => el.getAttribute('aria-disabled') !== 'true' && !el.hasAttribute('disabled');
        const collect = () => {
          const root = owned() || document;
          const tryList = (sel) => Array.from(root.querySelectorAll(sel)).filter((e) => visible(e) && enabled(e));
          let list = tryList('[role="option"]');
          if (!list.length) list = tryList('[role="menuitemradio"]');
          if (!list.length) list = tryList('[role="menuitem"]');
          if (!list.length && root !== document) list = tryList('li,[data-value],[role="treeitem"]');
          return list;
        };

        const deadline = Date.now() + ${OPTION_WAIT_MS};
        let options = collect();
        while (options.length === 0 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 60));
          options = collect();
        }
        if (options.length === 0) return null;

        const i = (((${index} % options.length) + options.length) % options.length);
        const chosen = options[i];
        chosen.setAttribute('data-bugsafari-opt', '1');
        const label = (chosen.getAttribute('aria-label') || chosen.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
        return { label, total: options.length };
      })()`,
    )
    .then((v) => (v && typeof v === 'object' ? (v as TaggedOption) : null))
    .catch(() => null);
}

// Remove the temp tag so a re-encounter of the same popup re-tags cleanly.
export async function clearOptionTag(page: Page): Promise<void> {
  await page
    .evaluate(
      `(() => document.querySelectorAll(${JSON.stringify(TAGGED_OPTION_SELECTOR)}).forEach((n) => n.removeAttribute('data-bugsafari-opt')))()`,
    )
    .catch(() => undefined);
}
