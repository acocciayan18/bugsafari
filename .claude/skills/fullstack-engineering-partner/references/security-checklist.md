# Security Checklist
 
Use this whenever a change touches user input, authentication, authorization, data access, file handling, or third-party integrations — and proactively even when not explicitly asked for a "security review," since most vulnerabilities are introduced quietly during feature work rather than found later.
 
## Input handling
 
- Never trust data from the client, including hidden form fields, query params, headers, and cookies — validate type, range, and format server-side regardless of what client-side validation exists.
- Watch for injection at every boundary that builds a query, command, or document from user input: SQL (use parameterized queries/ORMs, never string-concatenated SQL), NoSQL query injection, OS command injection (avoid shelling out with user-controlled arguments), and template injection.
- Sanitize or escape output based on where it's rendered (HTML context needs different escaping than a JS string context or a URL) — this is where most XSS gets introduced.
- Validate file uploads by content, not just extension or claimed MIME type; store uploads outside the web root or in object storage rather than a served directory when possible; enforce size limits server-side.
## Authentication & sessions
 
- Passwords: hash with a slow, salted algorithm (bcrypt/argon2/scrypt) — never store plaintext or use fast general-purpose hashes (MD5/SHA-family alone).
- Session tokens/JWTs: set appropriate expiry, use `httpOnly` + `secure` + `SameSite` cookies where applicable, and don't put sensitive data in a JWT payload since it's typically only signed, not encrypted.
- Rate-limit authentication endpoints (login, password reset, OTP verification) to blunt brute-force and enumeration attacks.
- Password reset and email-verification flows should use single-use, expiring, unguessable tokens — and should not reveal whether an email address exists in the system through response timing or wording differences.
## Authorization
 
- Check authorization on every request that touches a specific resource, not just at the route/page level — a common gap is checking "is this user logged in" but not "does this user actually own/have access to *this specific* record" (IDOR — insecure direct object reference).
- Don't rely on hiding a button or route in the frontend as the actual access control; the backend must enforce it independently, since frontend checks are trivially bypassed.
- Re-check authorization after any state change that could affect it (e.g., role downgrade, resource transfer) rather than caching a permission check for the life of a session.
## Secrets & configuration
 
- Secrets (API keys, DB credentials, signing keys) belong in environment variables or a secrets manager — never committed to source, never hardcoded, and never logged.
- Different environments (dev/staging/prod) should use different secrets; a leaked dev key shouldn't compromise production.
- Review `.gitignore`/`.dockerignore` coverage when adding new config or credential files so they don't accidentally get committed or baked into an image.
## Dependencies & supply chain
 
- Flag newly introduced dependencies that are unmaintained, have known CVEs, or pull in a surprisingly large transitive tree for what they're used for.
- Pin dependency versions where the ecosystem makes that sensible, and note when a change relies on picking up a specific patched version for a known vulnerability.
## Data exposure
 
- API responses should return only the fields the client actually needs — don't serialize an entire internal model (including internal flags, other users' data, or sensitive fields) just because it was convenient.
- Error messages returned to clients should not leak stack traces, internal paths, query text, or implementation details in production — log the detail server-side, return a generic message externally.
- Logs should never contain secrets, full payment details, or unredacted PII — review what gets logged when adding new logging around sensitive flows.
## Quick gut-check before shipping
 
If a change touches any of these, pause and think it through even if not asked: "does this let a user access something that isn't theirs," "does this trust something from the client that it shouldn't," "does this introduce a new place a secret could leak," "is there a rate-limit-shaped hole here."