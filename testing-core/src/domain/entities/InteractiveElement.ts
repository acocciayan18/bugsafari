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
  // Explicit spatial coordinates captured after layout stabilization
  boundingBox?: BoundingBox;
}
