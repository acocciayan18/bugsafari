# Database Diagram

## What this shows

BugSafari stores its data in MongoDB, in ten collections. This diagram shows each
collection, the fields that matter for understanding the system, and how the collections
point at each other.

Only the meaningful fields are listed. The sessions collection in particular has many
more fields for counters, run settings and cached results, and those are left out on
purpose so the diagram stays readable.

## Entity relationship diagram

```mermaid
 |erDiagram
    USERS ||--o{ SESSIONS : "owns"
    USERS ||--o{ REFRESH_TOKENS : "holds"
    USERS ||--o{ BRAIN_CONFIGS : "learns"
    USERS |o--o{ SUPPORT_TICKETS : "submits"

    SESSIONS ||--o{ FORENSIC_ERRORS : "produces"
    SESSIONS ||--o{ CONSOLE_LOGS : "produces"
    SESSIONS ||--o{ NETWORK_LOGS : "produces"
    SESSIONS ||--o{ BRAIN_CONFIGS : "snapshots"
    SESSIONS ||--o{ FORENSIC_ANALYSIS : "is summarised by"
    SESSIONS ||--|| RUN_TELEMETRY : "measured by"

    USERS {
        ObjectId _id PK
        String email UK
        String name
        String password
        Object settings
        Date createdAt
    }

    SESSIONS {
        ObjectId _id PK
        String runId UK
        ObjectId userId FK
        String targetUrl
        String status
        String outcome
        String infiltrationProfile
        Array activeTestingTypes
        Boolean savedManually
        Number findingCount
        Object stats
        Object forensicTrace
        Array actionSteps
        Array visitedRoutes
        Object aiInsights
        Date startedAt
        Date finishedAt
    }

    FORENSIC_ERRORS {
        ObjectId _id PK
        ObjectId forensicRunId FK
        String type
        String severity
        String message
        String stackTrace
        String selector
        String endpoint
        Number statusCode
        Date createdAt
    }

    CONSOLE_LOGS {
        ObjectId _id PK
        ObjectId forensicRunId FK
        String level
        String message
        String url
        Date timestamp
    }

    NETWORK_LOGS {
        ObjectId _id PK
        ObjectId forensicRunId FK
        String method
        String url
        Number statusCode
        Number durationMs
        Boolean ok
        Date timestamp
    }

    RUN_TELEMETRY {
        ObjectId _id PK
        ObjectId forensicRunId FK
        String browser
        String browserVersion
        String operatingSystem
        Number viewportWidth
        Number viewportHeight
        Number executionDuration
        Number interactionCount
        Number failureCount
        Array loadTimes
        Date timestamp
    }

    FORENSIC_ANALYSIS {
        ObjectId _id PK
        ObjectId forensicRunId FK
        String rootCause
        Number riskScore
        String riskLevel
        Array recommendations
        Number errorCount
        Date createdAt
    }

    BRAIN_CONFIGS {
        ObjectId _id PK
        ObjectId sessionId FK
        ObjectId userId FK
        String targetUrl
        String source
        Number bias
        Object weights
        Date capturedAt
    }

    REFRESH_TOKENS {
        ObjectId _id PK
        ObjectId userId FK
        String tokenHash UK
        String familyId
        Date expiresAt
        Date revokedAt
    }

    SUPPORT_TICKETS {
        ObjectId _id PK
        ObjectId userId FK
        String email
        String mode
        String subject
        String description
        String status
        Date createdAt
    }
```

## Collections

| Collection | Purpose | Key field |
| --- | --- | ---
| users | Accounts and personal settings | `email` is unique; the password is stored as a bcrypt hash |
| sessions | One document per test run. Also holds the findings and the step trail inside it | `runId` is the short public code shown to the tester, for example `RUN-1A2B3C` |
| forensic_errors | Each error caught during a run, typed and graded by severity | `forensicRunId` points at the session |
| console_logs | Every console message printed by the tested page | `forensicRunId` |
| network_logs | Requests that failed during the run | `forensicRunId` |
| forensic_telemetry, shown as Run Telemetry | Browser, screen size, duration and counts. One document per run | `forensicRunId` |
| forensic_analysis | The risk score and root cause worked out from the recorded errors | `forensicRunId` |
| brain_configs | A snapshot of the learned scoring weights | Looked up by `userId` plus `targetUrl` |
| refreshtokens | Long-lived sign-in tokens, stored as hashes | `familyId` groups a chain of renewals |
| support_tickets | Contact messages and feature requests | `userId` may be empty for a guest |

## Findings are stored inside the session

Findings do not have their own collection. Each session document has a `forensicTrace`
field, and inside it a `caughtBugs` array. Each entry in that array is one finding, with
its own message, severity, reproduction steps, and its own copy of the action steps that
led to it.

This was a deliberate choice. A finding is never read without its run, so keeping the two
together means the report screen loads from a single document instead of joining several
collections.

The same applies to `actionSteps` on the session, which is the run-wide list of what the
engine did. It is capped at sixty steps, and `visitedRoutes` is capped at five hundred, so
one long run cannot grow a document without limit.

## Retention

Unsaved runs are deleted automatically twenty four hours after they start. This is done
with an expiry index on `startedAt` that only applies to documents where
`savedManually` is false. When a tester saves a run, that flag flips to true and the
document drops out of the expiry rule, so saved history is kept indefinitely.

MongoDB does not delete child documents when a parent expires, so a background job runs
every hour, looks for logs and errors whose session no longer exists, and removes them.
Deleting a run from the history screen removes its children immediately.

## Separation between users

Every session field, learned weight and log is reachable only through the owning user.
The session document requires a `userId`, and every query that reads or writes a session
includes that user's id in the filter. The child collections have no user id of their
own, so a report request first looks up the session by id and owner, and only then reads
the children for that session.

Guest runs are never written at all. Since a session cannot be created without a user id,
a guest run lives only in memory and on screen for as long as the browser tab is open.
