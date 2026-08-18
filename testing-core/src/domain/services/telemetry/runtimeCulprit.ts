// telemetry/runtimeCulprit.ts — pick a runtime fault's culprit, or decline under burst ambiguity

export interface RuntimeCulpritInput {
  // Two-or-more distinct controls acted at the fault instant — the thrower can't be isolated.
  burstAmbiguous: boolean;
  // Label of the acted control, only when it is a genuine descriptive name (else undefined).
  descriptiveLabel?: string;
  // Selector of the acted control at fault time.
  selector?: string;
  // Failing handler from the top application stack frame — fallback when no descriptive control.
  stackCulprit?: string;
}

export interface RuntimeCulprit {
  culpritLabel?: string;
  culpritSelector?: string;
}

// During a concurrent burst naming one sibling is a guess, so decline both label and selector
// and let the burst macro narrate the repro. Otherwise prefer the descriptive control; failing
// that, attribute to the stack handler with no selector (a frame is not a DOM selector).
export function resolveRuntimeCulprit(input: RuntimeCulpritInput): RuntimeCulprit {
  if (input.burstAmbiguous) return {};
  if (input.descriptiveLabel) return { culpritLabel: input.descriptiveLabel, culpritSelector: input.selector };
  return { culpritLabel: input.stackCulprit, culpritSelector: undefined };
}
