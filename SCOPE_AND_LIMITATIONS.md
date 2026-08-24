# Scope and Limitations

## Scope

BugSafari is an autonomous, scriptless exploratory testing engine designed for modern
Single-Page Applications (SPAs). Its purpose is to discover defects that arise from
real user interaction flows without requiring hand-written test scripts. The system
and this research are bounded as follows.

**Target applications.** The engine targets browser-based SPAs whose interface is
rendered and mutated client-side (e.g. React, Vue, Angular). The application under
test must be deployed and reachable over HTTP from the testing core. Native mobile
applications, desktop binaries, and purely server-rendered multi-page sites are
outside the intended scope.

**Target users.** The primary users are developers and QA engineers who need
continuous, low-configuration regression and stress testing during active
development. Authenticated operators receive isolated, per-tenant run histories;
unauthenticated guests may run live explorations but cannot persist results.

**Testing coverage.** The engine autonomously traverses the live DOM using
Playwright, scores candidate interaction targets with an adaptive single-layer
perceptron, and prevents redundant exploration through structural DOM hashing. On
top of navigation, it applies heuristic input fuzzing and a battery of automated
attack scenarios that probe boundary states and common backend weaknesses,
including injection-class inputs, unsafe request handling, and authentication or
authorization boundary conditions. Detected defect classes include unhandled
client-side crashes, interface logic loops, and behaviorally confirmed backend
security loopholes. Faults are captured with multi-channel telemetry and a fixed
circular action buffer to support reproduction.

**Detection philosophy.** Security findings are promoted only when supported by
observable behavioral evidence (for example, an anomalous status code, response
signal, or demonstrated boundary bypass), rather than on the presence of a payload
alone. This favors precision and reduces false positives.

## Limitations

**Application reach.** The engine can only exercise states reachable through the
rendered UI. Views gated behind unusual authentication flows, external redirects,
or interactions the DOM heuristics do not recognize may remain unexplored. Testing
of applications on protected or internal networks requires an explicit tunneling
step, as the built-in SSRF safeguard blocks arbitrary internal targets by default.

**Model depth.** Target scoring uses a single-layer perceptron trained with the
delta rule. This keeps decisions fast and interpretable but limits the engine's
ability to learn deep, non-linear interaction strategies. Exploration guidance is
therefore heuristic rather than optimal.

**State abstraction.** Structural DOM hashing is an approximation. Distinct
application states that share a structural signature may be collapsed and skipped,
while cosmetically dynamic content can inflate the perceived state space. Some
reachable defects may be missed as a consequence.

**Fuzzing breadth.** Input fuzzing is heuristic and payload-driven, not exhaustive
or formally guided. Absence of a reported defect is not a proof of correctness;
false negatives are expected, particularly for logic errors with no observable
surface signal.

**Reproduction window.** Forensic reproduction relies on a fixed 20-step circular
action buffer. Faults whose root cause precedes that window may not be fully
replayable from the recorded trace alone.

**Coverage of novel checks.** Because security promotion is gated on structured
behavioral evidence, newly added detectors that do not emit the expected evidence
markers will not surface findings until instrumented accordingly.

**Environmental sensitivity.** Real-time sensory features such as live frame
streaming are sensitive to host CPU and load. Frame rates and timing-dependent
measurements may degrade on constrained machines and should be interpreted
relative to the execution environment rather than as absolute figures.
