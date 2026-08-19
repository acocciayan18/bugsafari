import type { BoundingBox } from '@bugsafari/shared';

export interface InteractiveElement {
  selector: string;
  id: string;
  className: string;
  innerText: string;
  type: string;
  tagName: string;
  isVisible: boolean;
  isPointer: boolean;
  featureVector: Record<string, number>;
  riskScore: number;
  // Human-descriptive metadata used to render readable reproduction playbooks
  // (resolved in label order: innerText → ariaLabel → placeholder → name).
  name?: string;
  role?: string;
  placeholder?: string;
  ariaLabel?: string;
  // Concise accessible name (aria-label -> aria-labelledby -> heading -> title), used as
  // the preferred reproduction label so a card link reads its title, not title+description.
  accessibleName?: string;
  // Explicit spatial coordinates captured after layout stabilization
  boundingBox?: BoundingBox;
  // Opens a transient UI layer (modal, dropdown, sidebar, accordion, popup)
  opensLayer?: boolean;
  // Lives inside a currently-open overlay/dialog/menu
  inActiveLayer?: boolean;
  // Close/dismiss control (postponed until the layer is otherwise explored)
  isDismiss?: boolean;
  // Control is disabled/aria-disabled. The parser has always computed this; it used
  // to be dropped here, so the scorer hard-coded `disabled: false`, the perceptron's
  // isDisabled weight could never fire, and dead controls were ranked, clicked and
  // then marked covered like live ones (audit P3-09).
  isDisabled?: boolean;
  // Resolved anchor href ('' for non-anchors) — lets ranking demote real route
  // transitions below untriggered in-page controls without a live probe.
  href?: string;
  // Value-independent signature of the field's owning <form> ('' if form-less),
  // keying the per-form fuzz cap so payload mutation can't mint a fresh form.
  formKey?: string;
  // Human name + kind of the nearest surrounding UI container (modal/dialog/tab/
  // panel/section/form), used to frame and disambiguate reproduction steps.
  contextLabel?: string;
  contextKind?: string;
  // Constraint metadata (parser-populated) driving boundary-aware value-control
  // actuation and field-aware fuzz boundaries. Raw attribute strings; parsed at use.
  min?: string;
  max?: string;
  step?: string;
  // Enabled <option> values for a <select> (capped), for boundary-sampled selection.
  options?: string[];
  // aria-haspopup value ('' when absent) — with role, marks a custom (non-<select>)
  // dropdown trigger so it is opened and an option is selected, not just clicked.
  ariaHasPopup?: string;
  // Hand-rolled clickable (div/span with onclick or focusable tabindex, no semantic
  // tag/role) — ranked and stress-tested like a button downstream.
  nonSemanticInteractive?: boolean;
}
