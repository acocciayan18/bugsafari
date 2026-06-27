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
}
