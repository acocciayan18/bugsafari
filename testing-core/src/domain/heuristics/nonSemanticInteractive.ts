// Detects hand-rolled interactive controls: a generic element (div/span/…) wired
// to behave like a button via an inline onclick or a focusable tabindex, with no
// native-interactive tag and no interactive ARIA role. These are invisible to the
// semantic selector allowlist but are real controls (and frequent bug carriers),
// so they must be discovered, ranked and stress-tested like buttons.

// Natively interactive tags — already covered by the semantic allowlist.
export const SEMANTIC_INTERACTIVE_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea']);

// ARIA roles that already mark an element as an interactive control.
export const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'checkbox',
  'switch',
  'radio',
  'option',
  'combobox',
  'listbox',
  'menu',
  'slider',
  'spinbutton',
  'textbox',
  'searchbox',
]);

// Minimal shape needed to classify an element as a non-semantic interactive control.
export interface NonSemanticInput {
  tagName: string;
  role?: string;
  hasOnClick?: boolean;
  tabIndex?: number | null;
}

// True when the element is a generic (non-semantic, role-less) node that still
// behaves interactively via onclick or a focusable tabindex. Semantic tags and
// elements carrying an interactive ARIA role are excluded (already handled).
export function isNonSemanticInteractive(el: NonSemanticInput): boolean {
  const tag = (el.tagName ?? '').toLowerCase();
  if (SEMANTIC_INTERACTIVE_TAGS.has(tag)) return false;

  const role = (el.role ?? '').toLowerCase();
  if (INTERACTIVE_ROLES.has(role)) return false;

  const focusable = el.tabIndex != null && Number.isFinite(el.tabIndex) && el.tabIndex >= 0;
  return el.hasOnClick === true || focusable;
}
