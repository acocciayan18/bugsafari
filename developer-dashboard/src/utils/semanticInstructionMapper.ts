import type { ActionBreadcrumb, ActionRecord, ForensicCrashReport } from '../types';


export type PlaybookStep = {
  stepNumber: number;
  instruction: string;
  selector?: string;
  payload?: string;
};

function safeSlice(input: string, max = 60): string {
  if (!input) return input;
  return input.length > max ? `${input.slice(0, max)}…` : input;
}

function decodePayload(payload?: string): string | undefined {
  if (!payload) return undefined;
  // Keep it human-readable and bounded.
  return safeSlice(payload, 120);
}

function guessSemanticHint(action: string, selector: string | undefined, payload: string | undefined): string | undefined {
  const a = (action ?? '').toUpperCase();
  const s = (selector ?? '').toLowerCase();

  // Examples from your spec:
  // - CLICK + button#login -> Click the 'Login' button.
  // - INPUT + [name="user"] + chaos -> Enter chaos payload ...
  // - Maps + /settings -> Go to the Settings page.
  // - STRIP_CONSTRAINT + maxLength -> Attempt to bypass character limits.

  if (a === 'NAVIGATION') {
    if (s.includes('settings') || s.includes('/settings')) return 'Go to the Settings page.';
    return undefined;
  }

  if (a === 'CLICK') {
    if (s.includes('login')) return "Click the 'Login' button.";
    if (s.includes('signup') || s.includes('sign-up')) return "Click the 'Sign up' button.";
    if (s.includes('search')) return "Click the 'Search' button.";
    return undefined;
  }

  if (a === 'INPUT') {
    if (s.includes('user') || s.includes('email')) return 'Enter payload into the user/email field.';
    if (s.includes('pass') || s.includes('password')) return 'Enter payload into the password field.';
    return undefined;
  }

  if (a === 'STRIP_CONSTRAINT' || a === 'strip-constraints-and-fuzz') {
    return "Attempt to bypass character limits on the input field.";
  }

  if (a.includes('MAXLENGTH') || s.includes('maxlength') || (payload ?? '').includes('maxLength')) {
    return "Attempt to bypass character limits on the input field.";
  }

  return undefined;
}

function breadcrumbToStep(bc: ActionBreadcrumb, index: number): PlaybookStep {
  const action = bc.action ?? '';
  const selector = bc.selector ?? '';
  const payload = decodePayload(bc.payload);

  const semanticHint = guessSemanticHint(action, selector, payload);

  let instruction = semanticHint ?? '';

  // Fallbacks using concrete action.
  if (!instruction) {
    if (action === 'CLICK') {
      instruction = selector ? `Click '${selector}'.` : 'Click the target element.';
    } else if (action === 'INPUT') {
      if (payload) {
        instruction = `Enter chaos payload '${safeSlice(payload, 60)}' into the field.`;
      } else {
        instruction = selector ? `Enter a payload into '${selector}'.` : 'Enter a payload into the field.';
      }
    } else if (action === 'NAVIGATION') {
      instruction = selector ? `Navigate using '${selector}'.` : 'Navigate.';
    } else if (action.toUpperCase().includes('MAXLENGTH') || selector.toLowerCase().includes('maxlength')) {
      instruction = 'Attempt to bypass character limits on the input field.';
    } else {
      instruction = `${action || 'ACTION'} on ${selector || 'unknown selector'}.`;
    }
  }

  return {
    stepNumber: index + 1,
    instruction,
    selector,
    payload,
  };
}

export function mapForensicBreadcrumbsToPlaybook(breadcrumbs: readonly ActionBreadcrumb[]): PlaybookStep[] {
  return breadcrumbs.map((bc, idx) => breadcrumbToStep(bc, idx));
}

export function mapIncidentStepsToPlaybook(steps: readonly ActionRecord[] | undefined): PlaybookStep[] {
  if (!steps || steps.length === 0) return [];

  // Normalize ActionRecord -> ActionBreadcrumb-like view.
  return steps.map((s, idx) => {
    const bcLike: ActionBreadcrumb = {
      timestamp: s.timestamp,
      selector: s.selector,
      action: s.type,
      payload: s.payload,
      score: undefined,
    };

    return breadcrumbToStep(bcLike, idx);
  });
}

export function mapForensicReportToPlaybook(report: ForensicCrashReport): PlaybookStep[] {
  return mapForensicBreadcrumbsToPlaybook(report.breadcrumbs);
}

