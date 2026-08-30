import type { Page } from 'playwright';

// Visual redaction of credential inputs, so the live-frame stream can run through
// the whole login instead of going dark for it.
//
// `-webkit-text-security` renders glyphs as bullets without touching the value the
// page reads, so the target still receives the real credential. A password input
// already masks itself; the username does not, and it is credential material under
// the shared/types/auth.ts invariant — hence the explicit tag.

export const MASK_ATTRIBUTE = 'data-bugsafari-mask';
const STYLE_ID = 'bugsafari-credential-mask';

// Value tokens whose field must render as bullets in captured frames even when it is
// not a password input — financial + government identifiers the engine may type into
// during exploration/fuzzing. Mirrors SENSITIVE_VALUE_TOKENS in elementClassifier.ts.
const SENSITIVE_TOKENS = [
  'password', 'passwd', 'pwd', 'secret', 'otp', 'cvv', 'cvc', 'card', 'cardnumber',
  'creditcard', 'ccnumber', 'iban', 'routing', 'accountnumber', 'ssn', 'social',
  'passport', 'taxid', 'securitycode', 'apikey', 'privatekey', 'pin',
] as const;

// Case-insensitive attribute-substring selectors over the identifiers a field
// carries (name/id/autocomplete). A pure-CSS net needs no runtime tagging and
// survives every redirect the login flow makes.
const SENSITIVE_SELECTORS = SENSITIVE_TOKENS.flatMap((t) => [
  `input[name*="${t}" i]`, `input[id*="${t}" i]`, `input[autocomplete*="${t}" i]`,
]).join(',');

export const MASK_CSS = `input[type="password"],[${MASK_ATTRIBUTE}],${SENSITIVE_SELECTORS}{-webkit-text-security:disc !important;}`;

/**
 * Install the mask for every document this page loads. Must be called before the
 * first navigation — an init script only applies to documents created after it is
 * registered, and the login flow may redirect several times.
 */
export async function installCredentialMask(page: Page): Promise<void> {
  await page
    .addInitScript(
      ([css, styleId]: [string, string]) => {
        const apply = (): void => {
          if (document.getElementById(styleId)) return;
          const style = document.createElement('style');
          style.id = styleId;
          style.textContent = css;
          (document.head ?? document.documentElement)?.appendChild(style);
        };
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', apply, { once: true });
        } else {
          apply();
        }
      },
      [MASK_CSS, STYLE_ID] as [string, string],
    )
    .catch(() => undefined); // A page that refuses init scripts still logs in fine, just unmasked.
}

/** Tag a resolved credential field so the installed stylesheet masks it too. */
export async function maskField(page: Page, selector: string): Promise<void> {
  if (!selector) return;
  await page
    .evaluate(
      ([target, attribute]: [string, string]) => {
        document.querySelector(target)?.setAttribute(attribute, '');
      },
      [selector, MASK_ATTRIBUTE] as [string, string],
    )
    .catch(() => undefined);
}
