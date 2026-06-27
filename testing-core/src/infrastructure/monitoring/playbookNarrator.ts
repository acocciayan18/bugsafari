import type { ActionRecord, ActionType } from '../../../../shared/types.ts';

/**
 * Centralized human-readable narrative formatting for reproduction playbooks.
 *
 * Turns raw action records into clean, manual replication instructions and,
 * crucially, never leaks technical nth-child selector strings into the steps.
 */

const MAX_LABEL_LENGTH = 60;
const MAX_PAYLOAD_LENGTH = 80;

interface ElementLabelSource {
  innerText?: string;
  ariaLabel?: string;
  placeholder?: string;
  name?: string;
  id?: string;
  tagName?: string;
  type?: string;
}

const collapse = (value?: string): string => (value ?? '').replace(/\s+/g, ' ').trim();

const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max)}…` : value;

/**
 * Generic, human-friendly fallback name for an element when no descriptive
 * label exists — a structural tag type, never a selector.
 */
export function genericElementLabel(tagName?: string, type?: string): string {
  const tag = (tagName ?? '').toLowerCase();
  const elementType = (type ?? '').toLowerCase();

  if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'input field';
  if (tag === 'a') return 'link';
  if (tag === 'button' || elementType === 'button' || elementType === 'submit') return 'button';
  return tag || 'element';
}

/**
 * Resolve the most human-actionable label for an element, scanning properties in
 * the required order: explicit inner text → visible semantic (aria) label →
 * input placeholder → name attribute → id → generic structural tag type.
 * Deliberately never returns the raw CSS selector.
 */
export function resolveElementLabel(element: ElementLabelSource): string {
  const innerText = collapse(element.innerText);
  if (innerText) return truncate(innerText, MAX_LABEL_LENGTH);

  const ariaLabel = collapse(element.ariaLabel);
  if (ariaLabel) return truncate(ariaLabel, MAX_LABEL_LENGTH);

  const placeholder = collapse(element.placeholder);
  if (placeholder) return truncate(placeholder, MAX_LABEL_LENGTH);

  const name = collapse(element.name);
  if (name) return truncate(name, MAX_LABEL_LENGTH);

  const id = collapse(element.id);
  if (id) return truncate(id, MAX_LABEL_LENGTH);

  return genericElementLabel(element.tagName, element.type);
}

const defaultLabelForType = (type: ActionType): string =>
  type === 'TYPE' || type === 'INPUT' || type === 'SUBMIT' ? 'input field' : 'element';

/**
 * Render a single action record into a human-actionable description WITHOUT a
 * leading "Step N." prefix (numbering is applied by the caller).
 */
export function describeActionRecord(record: ActionRecord): string {
  const rawLabel = collapse(record.fallbackLabel);
  const label = rawLabel || defaultLabelForType(record.type);

  switch (record.type) {
    case 'NAVIGATE':
    case 'NAVIGATION':
      return `Navigate to target interface view: ${record.url}`;

    case 'TYPE':
    case 'INPUT': {
      const payload = record.payload ? truncate(record.payload, MAX_PAYLOAD_LENGTH) : '';
      return `Input data value "${payload}" provided to input field: "${label}"`;
    }

    case 'SUBMIT':
      return `Bypassed interface safeguards on input field: "${label}" by removing client constraint hooks`;

    case 'HOVER':
      return rawLabel
        ? `Hover interaction triggered on element: "${rawLabel}"`
        : 'Hover interaction triggered on an unlabeled element';

    case 'CLICK':
    default:
      return rawLabel
        ? `Click interaction triggered on element: "${rawLabel}"`
        : 'Click interaction triggered on an unlabeled element';
  }
}

/** Render an ordered, sequentially-numbered playbook from raw action records. */
export function narrateActionRecords(records: ActionRecord[]): string[] {
  return records.map((record, index) => `Step ${index + 1}. ${describeActionRecord(record)}`);
}
