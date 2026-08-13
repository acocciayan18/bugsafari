// Shared applicability gate for the injection oracles: text-bearing controls whose
// value plausibly reaches a query or auth check. `\bid\b`/`\bq\b` stay word-bounded so
// the substring never matches `hidden`/`video`/`valid`. Broadening only widens which
// fields are PROBED — both oracles still self-gate on an observed differential or a
// leaked signature, so a defended app yields no finding regardless of the field name.
export const QUERYABLE_CLUE_RE =
  /(search|query|filter|email|username|user|account|login|password|token|\bid\b|name|\bq\b|term|keyword|code|otp|pin|phone|slug|product|order|ref|sku|coupon|promo|category)/i;
