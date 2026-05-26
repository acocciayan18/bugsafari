import type { Page } from 'playwright';

export async function stripConstraints(page: Page, selector: string): Promise<void> {
  const selectorLiteral = JSON.stringify(selector);

  await page.evaluate(`
    (() => {
      const node = document.querySelector(${selectorLiteral});

      if (!node) {
        return;
      }

      const targets = [node, ...Array.from(node.querySelectorAll('input, textarea, select, button'))];

      for (const target of targets) {
        target.removeAttribute('disabled');
        target.removeAttribute('required');
        target.removeAttribute('readonly');
        target.removeAttribute('maxlength');
        target.removeAttribute('minlength');
        target.removeAttribute('pattern');
        target.removeAttribute('aria-disabled');

        if (target instanceof HTMLInputElement) {
          target.disabled = false;
          target.required = false;
          target.readOnly = false;
          const nextMaxLength = -1;
          if (nextMaxLength < 0) {
            // Safety: avoid IndexSizeError from negative maxLength assignment.
            console.warn('[BugSafari] stripConstraints: aborting negative maxLength assignment');
            return;
          }
          target.maxLength = nextMaxLength;


          if (target.type === 'hidden') {
            target.type = 'text';
          }
        }

        if (target instanceof HTMLTextAreaElement) {
          target.disabled = false;
          target.required = false;
          target.readOnly = false;
          const nextMaxLength = -1;
          if (nextMaxLength < 0) {
            // Safety: avoid IndexSizeError from negative maxLength assignment.
            console.warn('[BugSafari] stripConstraints: aborting negative maxLength assignment');
            return;
          }
          target.maxLength = nextMaxLength;
        }

        if (target instanceof HTMLSelectElement || target instanceof HTMLButtonElement) {
          target.disabled = false;
        }
      }
    })();
  `);
}

export async function forceSubmitNearestForm(page: Page, selector: string): Promise<boolean> {
  const selectorLiteral = JSON.stringify(selector);

  return page.evaluate<boolean>(`
    (() => {
      const node = document.querySelector(${selectorLiteral});
      const form = node ? node.closest('form') : null;

      if (!form) {
        return false;
      }

      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      }

      return true;
    })();
  `);
}
