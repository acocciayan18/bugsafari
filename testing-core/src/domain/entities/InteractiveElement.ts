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
  // Explicit spatial coordinates captured after layout stabilization
  boundingBox?: BoundingBox;
  // Opens a transient UI layer (modal, dropdown, sidebar, accordion, popup)
  opensLayer?: boolean;
  // Lives inside a currently-open overlay/dialog/menu
  inActiveLayer?: boolean;
  // Close/dismiss control (postponed until the layer is otherwise explored)
  isDismiss?: boolean;
  // Resolved anchor href ('' for non-anchors) — lets ranking demote real route
  // transitions below untriggered in-page controls without a live probe.
  href?: string;
  // Value-independent signature of the field's owning <form> ('' if form-less),
  // keying the per-form fuzz cap so payload mutation can't mint a fresh form.
  formKey?: string;
}
