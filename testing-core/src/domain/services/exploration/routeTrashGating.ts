/**
 * Pure gate deciding whether a clicked control warrants the RouteTrasher attack.
 *
 * RouteTrasher stress-tests the *current route* (query/path/hash mutations + rapid
 * history churn) — ~20 full navigations per run. Firing it after every revisited
 * click, regardless of control type, meant a menu toggle that owns no route (e.g.
 * `#navbarLanguageButton`, which just opens an overlay) triggered the whole storm:
 * repeated SPA re-bootstraps, a scrambled history stack that broke the engine's own
 * backtracking, and a main-thread lock-up (observed on OWASP Juice Shop — 3 minutes
 * spent re-trashing one language button instead of exploring).
 *
 * Restrict it to controls that genuinely own a route so the attack lands where
 * route-handling bugs actually live. Deliberately NOT keyed on generic
 * 'nav'/'navbar' — a navbar holds non-navigating controls too. Extracted so the
 * policy is unit-testable without a live Page.
 */

export interface RouteTrashGateInputs {
  /** The control's tag name (any case). */
  tagName: string;
  /** The control's ARIA role, if any (any case). */
  role: string;
  /** Lowercased `id + className + selector + innerText` of the control. */
  source: string;
}

// Explicit SPA router bindings. An Angular `routerLink` on a non-anchor still owns
// a route yet exposes no href, so match the directive token directly.
const ROUTER_LINK_TOKENS = ['routerlink', 'router-link'];

/** True when the control actually navigates the app (anchor, ARIA link, or an
 *  explicit router binding) and so is a meaningful RouteTrasher target. */
export function shouldRouteTrash(i: RouteTrashGateInputs): boolean {
  if (i.tagName.toLowerCase() === 'a') return true;
  if (i.role.toLowerCase() === 'link') return true;
  return ROUTER_LINK_TOKENS.some((token) => i.source.includes(token));
}
