// ═══════════════════════════════════════════════════════════════
// __accuracy__/rankingCorpus.ts — LABELED ELEMENT-PRIORITIZATION GROUND TRUTH
// ═══════════════════════════════════════════════════════════════
// Deterministic corpus for scoring RiskScorer ranking quality. Each element is
// tagged bug-bearing (a high-value, state-mutating / auth / destructive control
// where real defects concentrate) or benign (cosmetic/navigational). The scorer
// ranks the whole set and measures precision@k + nDCG — i.e. does the perceptron
// blend surface the risky controls first?

import type { InteractiveElement } from '../domain/entities/InteractiveElement.js';

export interface RankingCase {
  element: InteractiveElement;
  isBugBearing: boolean;
}

// Minimal InteractiveElement factory — only the fields RiskScorer reads matter.
function el(
  partial: Pick<InteractiveElement, 'selector' | 'tagName' | 'type' | 'innerText'> &
    Partial<InteractiveElement>,
): InteractiveElement {
  return {
    id: '',
    className: '',
    isVisible: true,
    isPointer: false,
    featureVector: {},
    riskScore: 0,
    boundingBox: { x: 20, y: 200, width: 160, height: 40 },
    ...partial,
  };
}

export const RANKING_CORPUS: readonly RankingCase[] = [
  // ── Bug-bearing: destructive / auth / transactional controls ────────────────
  { element: el({ selector: '#delete', tagName: 'button', type: 'button', innerText: 'Delete account' }), isBugBearing: true },
  { element: el({ selector: '#pay', tagName: 'button', type: 'submit', innerText: 'Pay now' }), isBugBearing: true },
  { element: el({ selector: '#checkout', tagName: 'button', type: 'button', innerText: 'Proceed to checkout' }), isBugBearing: true },
  { element: el({ selector: '#login', tagName: 'button', type: 'submit', innerText: 'Log in' }), isBugBearing: true },
  { element: el({ selector: '#password', tagName: 'input', type: 'password', innerText: '', placeholder: 'Password' }), isBugBearing: true },
  { element: el({ selector: '#register', tagName: 'button', type: 'submit', innerText: 'Create account' }), isBugBearing: true },
  { element: el({ selector: '#email', tagName: 'input', type: 'email', innerText: '', placeholder: 'Email address' }), isBugBearing: true },

  // ── Benign: navigational / cosmetic / low-risk ──────────────────────────────
  { element: el({ selector: '#home', tagName: 'a', type: '', innerText: 'Home' }), isBugBearing: false },
  { element: el({ selector: '#about', tagName: 'a', type: '', innerText: 'About us' }), isBugBearing: false },
  { element: el({ selector: '#logo', tagName: 'a', type: '', innerText: '' }), isBugBearing: false },
  { element: el({ selector: '#toggle-theme', tagName: 'button', type: 'button', innerText: 'Toggle theme' }), isBugBearing: false },
  { element: el({ selector: '#tos-link', tagName: 'a', type: '', innerText: 'Terms of service' }), isBugBearing: false },
  { element: el({ selector: '#next-slide', tagName: 'button', type: 'button', innerText: 'Next' }), isBugBearing: false },
  { element: el({ selector: '#help', tagName: 'a', type: '', innerText: 'Help' }), isBugBearing: false },
];
