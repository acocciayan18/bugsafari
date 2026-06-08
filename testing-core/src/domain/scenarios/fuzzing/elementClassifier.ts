/**
 * Heuristic-Driven Context-Aware Fuzzing - Element Classifier
 * 
 * This module provides high-performance classification of DOM input elements
 * to enable intelligent fuzzing strategies based on field semantics.
 */

/**
 * Flexible input element interface for classification.
 * Supports both InteractiveElement and generic DOM element properties.
 */
export interface ClassifiableElement {
  type?: string;
  id?: string;
  name?: string;
  className?: string;
  innerText?: string;
  tagName?: string;
  placeholder?: string;
  [key: string]: unknown;
}

/**
 * Type-safe union for field categories.
 * Used to classify input elements for targeted fuzzing strategies.
 */
export type FieldCategory = 'NUMERIC' | 'TEXT_SEARCH' | 'DATABASE_AUTH' | 'CHAOS_FALLBACK';

/**
 * Token sets for NUMERIC classification.
 * Matches fields where type="number" or type="tel", or metadata strings containing numeric-related tokens.
 */
const NUMERIC_TOKENS = new Set([
  'quantity',
  'amount',
  'age',
  'total',
  'phone',
  'count',
  'price',
  'cost',
  'qty',
  'number',
  'num',
  'zip',
  'postal',
  'credit',
  'card',
  'cvv',
  'expiry',
  'year',
  'month',
  'day',
  'hour',
  'minute',
  'second',
  'score',
  'weight',
  'height',
  'length',
  'width',
  'depth',
  'size',
  'dimension',
]);

/**
 * Token sets for TEXT_SEARCH classification.
 * Matches fields with text input or search/query-related identifiers.
 */
const TEXT_SEARCH_TOKENS = new Set([
  'search',
  'query',
  'comments',
  'description',
  'notes',
  'message',
  'bio',
  'about',
  'content',
  'subject',
  'title',
  'name',
  'firstname',
  'lastname',
  'fullname',
  'address',
  'comment',
  'feedback',
  'review',
  'text',
  'input',
  'keyword',
]);

/**
 * Token sets for DATABASE_AUTH classification.
 * Matches sensitive transaction vectors like login, signup, authentication fields.
 */
const DATABASE_AUTH_TOKENS = new Set([
  'login',
  'signup',
  'register',
  'username',
  'email',
  'password',
  'pass',
  'token',
  'id',
  'auth',
  'credential',
  'secret',
  'key',
  'api',
  'access',
  'confirm',
  'verification',
  'verify',
  'otp',
  'pin',
  'security',
  'question',
  'answer',
  'recovery',
  'reset',
]);

/**
 * Checks if a string contains any token from a given set (case-insensitive).
 * @param text The text to search in
 * @param tokens The set of tokens to match against
 * @returns true if any token is found in the text
 */
function containsToken(text: string, tokens: Set<string>): boolean {
  if (!text) return false;
  const lowerText = text.toLowerCase();
  for (const token of tokens) {
    if (lowerText.includes(token)) {
      return true;
    }
  }
  return false;
}

/**
 * Concatenates relevant element properties for token matching.
 * Combines type, name, id, placeholder, and other identifiers.
 * @param element The input element to analyze
 * @returns Combined string of element identifiers
 */
function getElementIdentifiers(element: Partial<ClassifiableElement>): string {
  const parts: string[] = [];
  
  if (element.type) parts.push(element.type);
  if (element.id) parts.push(element.id);
  if (element.name) parts.push(element.name);
  if (element.className) parts.push(element.className);
  if (element.innerText) parts.push(element.innerText);
  if (element.placeholder) parts.push(element.placeholder);
  
  return parts.join(' ');
}

/**
 * High-performance evaluation method to classify input elements.
 * Reads properties like element.type, element.name, element.id, and element.placeholder
 * to map them into an uppercase type-safe union string.
 * 
 * Classification priority:
 * 1. DATABASE_AUTH - if any sensitive/auth-related tokens are found
 * 2. NUMERIC - if type is "number" or "tel", or numeric-related tokens found
 * 3. TEXT_SEARCH - if type is "text" or search/query-related tokens found
 * 4. CHAOS_FALLBACK - default fallback for generic, unclassified inputs
 * 
 * @param element The input element to classify (any object with relevant properties)
 * @returns FieldCategory - The classified category type
 */
export function classifyInputElement(element: unknown): FieldCategory {
  // Cast to ClassifiableElement for safe property access
  const el = element as Partial<ClassifiableElement>;
  const identifiers = getElementIdentifiers(el);
  
  // Priority 1: DATABASE_AUTH - Check for sensitive/authentication fields first
  // These are highest priority for security-focused fuzzing
  if (containsToken(identifiers, DATABASE_AUTH_TOKENS)) {
    return 'DATABASE_AUTH';
  }
  
  // Priority 2: NUMERIC - Check for numeric input types
  // Match type="number" or type="tel" explicitly
  const elementType = el.type?.toLowerCase();
  if (elementType === 'number' || elementType === 'tel') {
    return 'NUMERIC';
  }
  
  // Check for numeric-related tokens in identifiers
  if (containsToken(identifiers, NUMERIC_TOKENS)) {
    return 'NUMERIC';
  }
  
  // Priority 3: TEXT_SEARCH - Check for text/search input types
  // Match type="text" explicitly
  if (elementType === 'text') {
    return 'TEXT_SEARCH';
  }
  
  // Check for text/search-related tokens
  if (containsToken(identifiers, TEXT_SEARCH_TOKENS)) {
    return 'TEXT_SEARCH';
  }
  
  // Priority 4: CHAOS_FALLBACK - Default for unclassified inputs
  return 'CHAOS_FALLBACK';
}

/**
 * Type guard to verify if a category is a specific type.
 * @param category The category to check
 * @param expected The expected category type
 * @returns true if category matches expected
 */
export function isCategory(
  category: FieldCategory,
  expected: FieldCategory
): boolean {
  return category === expected;
}
