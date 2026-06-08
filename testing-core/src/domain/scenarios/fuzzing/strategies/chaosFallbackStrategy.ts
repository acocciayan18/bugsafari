/**
 * Chaos Fallback Strategy
 * 
 * Generates hyper-destructive, multi-category fallback payloads for input fuzzing.
 * Contains weird symbols, corrupt encodings, and invalid characters designed to test
 * single-page application input resilience.
 * 
 * Character Classes:
 * - A. Invisible & Zero-Width Formatting Corruptors
 * - B. Diacritics & Combining Unicode Chaos (Zalga Text Strings)
 * - C. Complex International Multi-byte Strings
 * - D. Binary Encodings & Control Characters
 */

export interface ChaosPayload {
  type: 'ZERO_WIDTH' | 'ZALGA' | 'MULTIBYTE' | 'CONTROL' | 'RANDOM' | 'BOUNDARY' | 'QUERY' | 'SCRIPT' | 'TYPE_MISMATCH';
  value: string;
  description: string;
  category: 'A' | 'B' | 'C' | 'D' | 'LEGACY';
}

// ============================================================================
// A. Invisible & Zero-Width Formatting Corruptors
// Purpose: Exposes validation bugs where a field appears empty but contains raw bytes
// ============================================================================

const ZERO_WIDTH_CORRUPTORS = [
  '\u200B',  // Zero-width space
  '\u200C',  // Zero-width non-joiner
  '\u200D',  // Zero-width joiner
  '\u200E',  // Left-to-right mark
  '\u200F',  // Right-to-left mark
  '\uFEFF',  // Byte order mark (BOM)
  '\uFFFC',  // Object replacement character
  '\u061C',  // Arabic letter mark
  '\u2060',  // Word joiner
  '\u180E',  // Mongolian vowel separator
  '\u200B\u200B\u200B',  // Multiple zero-width spaces
  '\u200E\u200F\u200E\u200F',  // Alternating direction marks
  '\b',  // Backspace character
];

// ============================================================================
// B. Diacritics & Combining Unicode Chaos (Zalga Text Strings)
// Purpose: Forces component layout breakage, element overlapping in React virtual DOM
// ============================================================================

const ZALGA_TEXT_STRINGS = [
  // Stacked combining characters using String.fromCharCode for safety
  String.fromCharCode(77, 805, 787, 856, 866, 868, 847, 856, 866, 868, 841, 866, 776, 805, 816, 824, 855, 823, 855, 776, 824),  // Maleware variant
  String.fromCharCode(97, 768, 769, 770, 771, 772, 773, 774, 775, 776, 777, 778, 779, 780),  // a with multiple combining marks
  String.fromCharCode(111, 824, 855, 823, 821, 824, 855, 823),  // o with overlay
  String.fromCharCode(101, 776, 805, 816, 824, 855, 823, 776),  // e with multiple marks
  String.fromCharCode(88, 805, 787, 856, 866, 868, 847, 856),  // X with combining
  // Heavily stacked characters - using known safe Unicode combinations
  String.fromCharCode(78, 78, 78, 824, 855, 823, 821, 824),  // N stacked
  String.fromCharCode(3242, 3242, 3322, 3322, 3344, 3344, 3294, 3294),  // Kannara stacked
  String.fromCharCode(1072, 1072, 1072, 824, 855, 823),  // Cyrillic a stacked
  String.fromCharCode(1392, 1392, 1392, 824, 855, 823),  // Armenian stacked
];

// ============================================================================
// C. Complex International Multi-byte Strings
// Purpose: Catches length check bypasses - surrogate pairs counted as 2 chars
// ============================================================================

const MULTIBYTE_STRINGS = [
  // CJK Extension B characters (using direct strings for safety)
  '𠜎',  // U+2071E - CJK Extension B
  '𠜏',  // U+2071F
  '𝐚𝐛𝐜',  // Mathematical bold
  // Arabic bidirectional text - using safe escapes
  'uchehr\u200E test',  // RTL mark test
  'مرحبا بالعالم',  // Arabic hello
  // Emoji modifiers and variation sequences
  '🔥𝔘𝔫𝔦𝔠𝔬𝔡𝔢🔥',  // Fire + Unico de + Fire
  '👨‍👩‍👧‍👦',  // Family emoji sequence
  // Math symbols 
  '𝐀𝐁𝐂𝐃𝐄𝐅𝐆𝐇',  // Mathematical bold capitals
  '𝟎𝟏𝟐𝟑𝟒𝟓𝟔𝟕𝟖',  // Mathematical bold digits
  // Japanese/Chinese - using direct strings
  'アアア\u3099\u3099\u3099\u82E5\u82E5\u82E5',  // Japanese katakana
  '中文中文中文',  // Chinese characters
  // Hebrew (RTL testing)
  'שלום עולם',  // Hebrew peace world
  // Thai
  'สวัสดีโลก',  // Thai hello world
];

// ============================================================================
// D. Binary Encodings & Control Characters
// Purpose: Evaluates input sanitization - raw bytes slip past API gateway
// ============================================================================

const CONTROL_CHARACTERS = [
  '\x00',  // Null byte
  '\x1B',  // Escape
  '\x01',  // SOH (Start of Heading)
  '\x02',  // STX (Start of Text)
  '\x03',  // ETX (End of Text)
  '\x04',  // EOT (End of Transmission)
  '\x05',  // ENQ (Enquiry)
  '\x06',  // ACK (Acknowledge)
  '\x07',  // Bell
  '\x08',  // Backspace
  '\x0B',  // Vertical tab
  '\x0C',  // Form feed
  '\x0E',  // Shift Out
  '\x0F',  // Shift In
  '\x10',  // Data Link Escape
  '\x11',  // Device Control 1 (XON)
  '\x12',  // Device Control 2
  '\x13',  // Device Control 3 (XOFF)
  '\x14',  // Device Control 4
  '\x15',  // Negative Acknowledge
  '\x16',  // Synchronous Idle
  '\x17',  // End of Trans. Block
  '\x1C',  // File Separator
  '\x1D',  // Group Separator
  '\x1E',  // Record Separator
  '\x1F',  // Unit Separator
  '\n',  // Newline
  '\r',  // Carriage return
  '\r\n',  // CRLF
  '\n\r',  // LFCR
  '\x00\x1B\x00',  // Null + Escape combo
  '\x1B[31;40m',  // ANSI escape sequence (red text)
  '\x1B[0m',  // ANSI reset
];

// ============================================================================
// Legacy Categories (maintained for backwards compatibility)
// ============================================================================

const BOUNDARY_TOKENS = ['"', "'", '`', '\\', '/', '<', '>', '{', '}', '[', ']', '(', ')', ';', '--'];

const QUERY_TOKENS = [' OR 1=1 ', ' UNION SELECT NULL ', '$gt', '$ne', '../', '%00', '{{constructor}}'];

const SCRIPT_TOKENS = ['<script>', '</script>', 'onerror=', 'console.error(', 'javascript:'];

const TYPE_MISMATCH_TOKENS = ['null', 'undefined', 'NaN', '-0', 'Infinity', 'true', 'false'];

const RANDOM_STRINGS = [
  'BugSafari',
  'XSS_Test',
  'INJECTION_TEST',
  'fuzz',
  'FUZZ',
  '%00',
  '\x00',
  '\\x00',
  '<<SCRIPT>',
  'RAW_RELAY',
];

/**
 * Generates a chaos fallback payload with hyper-destructive character classes.
 * Uses randomized selection from multi-category matrices.
 * @returns A ChaosPayload with randomized value
 */
export function generateChaosPayload(): ChaosPayload {
  const rand = Math.random();
  let payload: ChaosPayload;

  // New chaos categories (A, B, C, D) - 60% probability
  if (rand < 0.15) {
    // Category A: Zero-width corruptors
    const value = ZERO_WIDTH_CORRUPTORS[Math.floor(Math.random() * ZERO_WIDTH_CORRUPTORS.length)];
    payload = { 
      type: 'ZERO_WIDTH', 
      value, 
      description: 'Zero-width formatting corrupto',
      category: 'A'
    };
  } else if (rand < 0.30) {
    // Category B: Zalga text strings
    const value = ZALGA_TEXT_STRINGS[Math.floor(Math.random() * ZALGA_TEXT_STRINGS.length)];
    payload = { 
      type: 'ZALGA', 
      value, 
      description: 'Diacritics & combining Unicode chaos',
      category: 'B'
    };
  } else if (rand < 0.45) {
    // Category C: Multi-byte strings
    const value = MULTIBYTE_STRINGS[Math.floor(Math.random() * MULTIBYTE_STRINGS.length)];
    payload = { 
      type: 'MULTIBYTE', 
      value, 
      description: 'Complex international multi-byte string',
      category: 'C'
    };
  } else if (rand < 0.60) {
    // Category D: Control characters
    const value = CONTROL_CHARACTERS[Math.floor(Math.random() * CONTROL_CHARACTERS.length)];
    payload = { 
      type: 'CONTROL', 
      value, 
      description: 'Binary encoding & control character',
      category: 'D'
    };
  } else if (rand < 0.70) {
    // Legacy: Random generic string
    const value = RANDOM_STRINGS[Math.floor(Math.random() * RANDOM_STRINGS.length)];
    payload = { type: 'RANDOM', value, description: 'Randomized chaos string', category: 'LEGACY' };
  } else if (rand < 0.78) {
    // Legacy: Boundary tokens
    const value = BOUNDARY_TOKENS[Math.floor(Math.random() * BOUNDARY_TOKENS.length)];
    payload = { type: 'BOUNDARY', value, description: 'Boundary token', category: 'LEGACY' };
  } else if (rand < 0.86) {
    // Legacy: Query tokens
    const value = QUERY_TOKENS[Math.floor(Math.random() * QUERY_TOKENS.length)];
    payload = { type: 'QUERY', value, description: 'Query injection token', category: 'LEGACY' };
  } else if (rand < 0.94) {
    // Legacy: Script tokens
    const value = SCRIPT_TOKENS[Math.floor(Math.random() * SCRIPT_TOKENS.length)];
    payload = { type: 'SCRIPT', value, description: 'Script token', category: 'LEGACY' };
  } else {
    // Legacy: Type mismatch tokens
    const value = TYPE_MISMATCH_TOKENS[Math.floor(Math.random() * TYPE_MISMATCH_TOKENS.length)];
    payload = { type: 'TYPE_MISMATCH', value, description: 'Type mismatch token', category: 'LEGACY' };
  }

  // Instrumentation: Log the dispatched payload to CLI
  console.log(`🌀 [CHAOS STRATEGY] Dispatched raw invalid character/symbol payload string -> Length: ${payload.value.length}`);

  return payload;
}

/**
 * Gets all chaos tokens as an array.
 * @returns Array of all chaos edge-case tokens
 */
export function getAllChaosTokens(): string[] {
  return [
    ...ZERO_WIDTH_CORRUPTORS,
    ...ZALGA_TEXT_STRINGS,
    ...MULTIBYTE_STRINGS,
    ...CONTROL_CHARACTERS,
    ...BOUNDARY_TOKENS,
    ...QUERY_TOKENS,
    ...SCRIPT_TOKENS,
    ...TYPE_MISMATCH_TOKENS,
    ...RANDOM_STRINGS,
  ];
}

/**
 * Gets chaos tokens by specific category.
 * @param category The category to filter ('A', 'B', 'C', 'D', 'LEGACY')
 * @returns Array of tokens in that category
 */
export function getChaosTokensByCategory(category: 'A' | 'B' | 'C' | 'D' | 'LEGACY'): string[] {
  switch (category) {
    case 'A':
      return [...ZERO_WIDTH_CORRUPTORS];
    case 'B':
      return [...ZALGA_TEXT_STRINGS];
    case 'C':
      return [...MULTIBYTE_STRINGS];
    case 'D':
      return [...CONTROL_CHARACTERS];
    case 'LEGACY':
      return [
        ...BOUNDARY_TOKENS,
        ...QUERY_TOKENS,
        ...SCRIPT_TOKENS,
        ...TYPE_MISMATCH_TOKENS,
        ...RANDOM_STRINGS,
      ];
    default:
      return [];
  }
}

/**
 * Checks if a string value is a known chaos token.
 * @param value The value to check
 * @returns true if value is a known chaos token
 */
export function isChaosToken(value: string): boolean {
  return getAllChaosTokens().includes(value);
}

export default generateChaosPayload;
