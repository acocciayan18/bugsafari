# Algorithm and Discussion

This section describes the major algorithms that BugSafari actually uses to drive its
autonomous exploratory testing process. Each entry was confirmed against the current
source code rather than assumed from common testing practice. The algorithms are grouped
into two kinds. The first kind consists of established algorithms with a known author or
origin that BugSafari applies in a standard way. The second kind consists of strategies
that were designed within BugSafari itself; these often build on established ideas but are
specific to the system.

## Overview

BugSafari treats the web application under test as a graph of user-interface states. It
decides which control to interact with next by combining a set of fixed rules with a small
machine learning model, it avoids repeating itself by fingerprinting each screen, and it
records enough information to reproduce any fault it triggers. The algorithms below support
these four needs: deciding where to go, deciding what to click, avoiding loops, and testing
inputs for defects.

## Summary table — established algorithms

| Algorithm | Author / Origin | Year | Strengths | Weaknesses |
| --- | --- | --- | --- | --- |
| Single-Layer Perceptron | Frank Rosenblatt | 1958 | Fast, small, easy to update online | Learns only simple, linearly separable patterns |
| Delta Rule (Least-Mean-Square) | Bernard Widrow, Marcian Hoff | 1960 | Simple, stable weight updates from error | Can be slow; sensitive to learning rate |
| Momentum for gradient updates | Rumelhart, Hinton, Williams | 1986 | Speeds up learning, smooths noisy updates | Adds a parameter to tune |
| Logistic (sigmoid) function | Pierre-François Verhulst | 1838 | Maps any score to a clean 0–1 range | Can saturate and slow learning at extremes |
| Breadth-First Search | Edward F. Moore | 1959 | Always finds the shortest known route | Uses more memory on wide graphs |
| Depth-First Search with backtracking | Charles Trémaux; Hopcroft, Tarjan | 1970s | Reaches deep states with little memory | May go deep before covering nearby states |
| Best-First (greedy) search | Judea Pearl | 1984 | Focuses effort on the most promising control | Can be short-sighted without extra guidance |
| Softmax exploration with temperature annealing | Sutton and Barto; Kirkpatrick et al. | 1983–1998 | Balances trying new controls and exploiting good ones | Needs a cooling schedule to behave well |
| SHA-256 hashing | United States NIST (FIPS 180-2) | 2001 | Stable, fixed-size, collision-resistant keys | Hash alone cannot describe how states differ |
| SHA-1 hashing | United States NIST (FIPS 180-1) | 1995 | Compact identifier for deduplication | Not used here for security, only identity |
| FNV-1a hashing | Fowler, Noll, Vo | 1991 | Fast, deterministic, platform-independent | Not suitable for cryptographic use |
| mulberry32 pseudo-random generator | Tommy Ettinger | 2017 | Tiny, fast, fully reproducible from a seed | Not cryptographically secure |
| Least-Recently-Used eviction | Classic caching strategy | 1960s | Keeps active data, drops stale data | Extra bookkeeping per access |
| Circular (ring) buffer | Classic data structure | — | Constant memory, keeps only recent items | Older items are overwritten and lost |

## Summary table — strategies developed within BugSafari

| Strategy | Basis | Strengths | Weaknesses |
| --- | --- | --- | --- |
| Compound structural fingerprint | SHA-256 hashing | Ignores volatile content, so reloads are not seen as new states | Rules for what to ignore must be maintained |
| Hybrid risk scoring (60% rules, 40% model) | Perceptron + heuristics | Stable from the start, still able to learn | The fixed blend ratio is a design choice |
| Novelty and stagnation scoring | Coverage tracking | Rewards real progress, detects being stuck | Thresholds need tuning per workload |
| Diversity-penalized selection | Best-first search | Avoids repeating one kind of control | May delay a genuinely best repeated action |
| Look-ahead edge suppression | Graph memory | Skips controls leading to exhausted screens | Applies only to navigation links |
| State-cluster saturation model | Structural hashing | Measures coverage by kind of screen, not just exact state | Same-template pages may be under-tested |
| Structural-transition repeat budget | Structural hashing | Stops navigation loops across similar screens | A wrong budget can cut useful controls |
| Adaptive payload escalator | Fuzzing practice | Increases attack strength only when needed | Deep levels can produce very large inputs |
| Context-aware field classification | Rule-based matching | Sends the right test data to the right field | Depends on readable field names |
| Deterministic bug identity | SHA-1 hashing | Same fault always gets the same identifier | Requires stable fault content |
| Reproduction-step minimization | Delta-debugging idea | Turns a long trail into a short repro guide | Heuristic, not a guaranteed minimum |
| Forensic Exception Catcher and Diagnostic Advisor | Rule-based analysis + saturating risk curve | Explains faults in plain language and scores overall risk | Rules cover common fault patterns only |

## Detailed discussion

### Single-Layer Perceptron with the Delta Rule

**Short description.** A perceptron is the simplest form of trainable model. It multiplies
each input feature by a weight, adds the results together with a bias term, and passes the
total through a logistic function to produce a value between zero and one.

**Features.** The model in BugSafari scores an element from about two dozen features, such
as whether the element is a button or an input, whether its text contains words like
"login", "pay", or "delete", and where it sits on the page. Learning uses the delta rule,
which nudges each weight in proportion to the error between the predicted and the desired
score. The implementation adds momentum so that consistent signals build up speed, a small
weight-decay term and a hard limit so no single weight can dominate, and a learning rate
that shrinks over time so late updates refine rather than swing the model.

**Function.** During a run the model rewards controls that lead to new states, network
activity, or detected faults, and penalizes controls that lead back to seen or exhausted
states. Learned weights can be saved and reloaded, so testing the same site again starts
from prior experience.

**Uses in BugSafari.** The perceptron provides the machine-learning part of the score that
ranks which control to interact with next, and it improves that ranking as the run proceeds.

**Strengths.** It is small, fast, and can be updated after every action without a separate
training phase. **Weaknesses.** As a single-layer model it can only learn simple patterns,
so BugSafari deliberately pairs it with fixed rules rather than relying on it alone.

### Logistic (sigmoid) activation

**Short description.** The logistic function turns any real number into a value between
zero and one. **Function and use.** BugSafari applies it to the perceptron's raw score so
that the model output is a bounded confidence value that combines cleanly with the rule
score. **Strengths.** It gives a smooth, bounded output. **Weaknesses.** Very large scores
push the output close to zero or one, where learning slows; the weight limits above are
present to reduce this effect.

### Directed Graph Pathfinding (Depth-First, Breadth-First, and Best-First search)

**Short description.** BugSafari's traversal layer, named Directed Graph Pathfinding in the
source, models the application as a directed graph in which each screen is a node and each
interactive control is an edge to another screen. Three classical search methods work
together over this graph.

**Function.** Forward exploration follows a depth-first pattern: the engine keeps a
breadcrumb stack of visited states and pushes deeper until a screen has no useful controls
left, then backtracks. When it must return to an earlier screen that still has untested
controls, it uses breadth-first search to compute the shortest known sequence of clicks to
reach that screen over already-confirmed edges. At each individual step, the choice of which
control to try is a best-first (greedy) decision that picks the highest-scoring control.

**Uses in BugSafari.** Depth-first traversal drives the overall exploration, breadth-first
planning provides efficient backtracking routes, and best-first selection orders the work
within a screen.

**Strengths.** Depth-first reaches deep multi-step flows with little memory, breadth-first
guarantees the shortest known return path, and best-first concentrates effort where it is
most likely to matter. **Weaknesses.** Depth-first alone can wander far before covering
nearby screens, and best-first alone can be short-sighted, which is why BugSafari adds the
coverage and diversity rules described below.

### Softmax exploration with temperature annealing

**Short description.** Instead of always taking the top-scored control, BugSafari sometimes
samples a control at random with a probability that grows with its score. A temperature
value controls how random this choice is.

**Function.** The temperature starts high, so early in a run the engine is willing to try
lower-scored controls, and it cools toward zero as the run proceeds, so later choices become
almost purely greedy. This is the classic explore-then-exploit trade-off, using a softmax
selection rule and a cooling schedule borrowed from simulated annealing.

**Uses in BugSafari.** It prevents the engine from fixating on one obvious control and helps
it discover behavior that a purely greedy search would miss.

**Strengths.** It balances discovery and focus automatically over time. **Weaknesses.** The
behavior depends on the cooling schedule, which must be set sensibly. The sampling draws
from a seeded generator so that runs remain reproducible.

### DOM Hashing — compound structural fingerprint (developed within BugSafari)

**Short description.** DOM Hashing is how BugSafari recognizes whether it has seen a screen
before. It builds a fingerprint of the page and reduces it to a fixed-size key using SHA-256.

**Features.** The fingerprint is built from a normalized skeleton of the page that removes
volatile content such as random identifiers, generated class names, numbers, advertisements,
and repeated rows, while keeping the layout and the interactive controls with their stable
state. Three keys are produced: a structure key for the layout shell, an interactive key for
the controls, and a combined key that serves as the exact identity of the state.

**Function and uses.** The combined key identifies graph nodes and edges, while the coarser
structure key is used to tell whether a screen is a genuinely new kind of screen. This
separation is what lets BugSafari treat a reloaded advertising-heavy page as the same state
rather than an endless stream of new ones.

**Strengths.** It is resilient to noisy, dynamic pages. **Weaknesses.** The rules for what
to strip must be maintained as web patterns change. Here SHA-256 is used only to produce a
stable key, not for security.

### Hybrid risk scoring (developed within BugSafari)

**Short description.** The single number that ranks each control is a weighted blend of a
rule score and the model score, taking sixty percent from the rules and forty percent from
the perceptron.

**Function.** The rule score adds fixed weights for element type, input type, and
sensitive keywords such as "login", "pay", and "delete", bounded so that stacked keywords
cannot dominate. The model score contributes learned judgment. Transient penalties, which
decay over a few steps, let the engine temporarily push down controls that recently led
nowhere.

**Uses in BugSafari.** This blended score is the main signal for the best-first selection
and the backtracking planner.

**Strengths.** The rules give sensible behavior from the very first action, while the model
allows the ranking to adapt. **Weaknesses.** The fixed blend ratio is a design decision
rather than a learned one.

### Novelty and stagnation scoring (developed within BugSafari)

**Short description.** Two related measures tell the engine whether it is making progress.
Novelty is granted only when a verified action reaches a structurally new screen.
Stagnation grows when the same state recurs, when a familiar layout keeps reappearing, or
when overall coverage stops increasing.

**Function and uses.** Novelty feeds the learning reward, while rising stagnation opens an
"escape window" that penalizes repeated controls and, if needed, forces a backtrack.

**Strengths.** They reward real advancement and detect being stuck without relying on a
single rigid rule. **Weaknesses.** Their thresholds must be tuned to avoid giving up too
early or too late.

### State-cluster saturation and structural-transition repeat budget (developed within BugSafari)

**Short description.** These two mechanisms prevent loops on modern single-page applications,
where the same link viewed from slightly different data looks like many different states.

**Function.** The state-cluster registry groups all screens that share one layout shell and
tracks how many of their controls have been triggered. A shell is marked fully explored once
its controls are covered or once repeated visits stop adding anything, though a few unseen
data instances of the same template are still allowed through so record-specific defects are
not missed. The repeat-budget tracker counts non-productive repeats of the same
control-to-screen transition and blocks a control once it exceeds its budget, while a
productive traversal clears the count.

**Uses in BugSafari.** Together they let the engine measure coverage by kind of screen and
stop chasing the same navigation loop.

**Strengths.** They give a realistic sense of coverage and stop endless loops. **Weaknesses.**
Grouping by layout can under-test pages that share a template, which is why a small number of
data instances are deliberately admitted. Both structures use least-recently-used eviction so
that memory stays bounded on very large sites.

### Diversity-penalized selection and look-ahead suppression (developed within BugSafari)

**Short description.** Two refinements steer the best-first choice away from wasted work. A
recency penalty lowers the score of controls of the same kind as those clicked recently, and
look-ahead suppression removes navigation links whose destination is already fully explored.

**Function and uses.** The recency penalty is computed from a small ring buffer of recent
actions, and a fallback tie-breaker orders controls by freshness, screen position, and
selector simplicity when their scores are almost equal.

**Strengths.** They spread testing across different kinds of controls and avoid revisiting
dead regions. **Weaknesses.** The recency penalty can briefly delay a control that really is
the best repeated choice.

### Adaptive payload escalator and context-aware field classification (developed within BugSafari)

**Short description.** When BugSafari tests input fields, it first decides what kind of field
each one is and then chooses how aggressive its test data should be.

**Features.** A rule-based classifier reads a field's type, name, identifier, and placeholder
and assigns it a category such as numeric, text or search, authentication, email, date, or
JSON, following a fixed priority order. The payload escalator then produces test values in
five increasing levels, from a plain category value, through structure-breaking characters,
context-breaking or encoded variants, greatly enlarged values that probe size limits, and
finally a mixed payload aimed at several interpreters at once. Every value is generated
deterministically from the field and a seed using FNV-1a hashing, so the same field produces
the same sequence on every run.

**Function and uses.** Escalation rises only when a lower level fails to affect the
application, so effort is spent where the application seems resistant. This is the part of the
engine that surfaces input-validation, injection, and boundary defects.

**Strengths.** It sends appropriate data to each field and increases pressure only when
warranted, while remaining fully reproducible. **Weaknesses.** Classification depends on
readable field names, and the highest escalation levels can create very large inputs.

### Reproduction support: circular action buffer, deterministic bug identity, and step minimization (developed within BugSafari)

**Short description.** So that a developer can reproduce any fault, BugSafari records what it
did and reduces that record to a short, reliable guide.

**Function.** A circular buffer keeps the most recent sixty actions of a run in constant
memory, which survives even crashes that bypass normal handling. When a fault is confirmed,
its identity is derived from stable fault content using SHA-1 hashing, so the same defect
always receives the same identifier and is never reported twice. The step minimizer, which
follows the spirit of delta debugging, then drops actions taken after the fault, trims the
trail back to the last entry into the faulting screen, collapses repeated clicks into a single
counted step, and ensures the result begins with a navigation the developer can actually
perform.

**Uses in BugSafari.** These mechanisms produce the reproduction steps and stable finding
identifiers stored with each run.

**Strengths.** They convert a long, wandering trail into a concise repro guide and prevent
duplicate findings. **Weaknesses.** The minimizer is heuristic and does not guarantee the
absolute shortest sequence, and the buffer keeps only recent actions by design.

### Forensic Exception Catcher and Diagnostic Advisor (developed within BugSafari)

**Short description.** This is the part of the engine that captures faults while a run is in
progress and then explains them after the run ends. It has two halves: a catcher that
observes the application for errors, and an advisor that turns the collected errors into a
readable diagnosis.

**Features.** The catcher attaches listeners to the browser page that record uncaught script
errors, console errors and warnings, and failed network responses, attributing each to the
step that caused it. A separate oracle recognizes client-rendered error screens, such as a
"Not found" view served without an error status, which a simple status-code check would miss.
Because some fatal crashes bypass normal handling, the recent actions are also preserved in
the circular buffer described earlier, so the context leading to a crash is not lost.

**Function.** After a run, the advisor examines the collected errors and produces three
outputs. It writes a plain-language root cause by checking the errors in priority order,
looking first at server and network failures, then at common JavaScript faults such as
reading a property of an empty value or calling something that is not a function. It computes
a single risk score from zero to one hundred by giving each error a weight based on its
severity and type, adding extra weight for server faults and for the number of distinct
failing endpoints, and passing the total through a saturating curve so the score rises quickly
at first and then approaches, but never reaches, one hundred. It then generates a short list
of actionable recommendations matched to the faults that were seen.

**Uses in BugSafari.** The catcher feeds the error, console, and network records stored for
each run, while the advisor produces the root cause, risk score, risk level, and
recommendations shown in the run report.

**Strengths.** It gives developers an immediate, readable explanation of what went wrong and
a comparable risk figure across runs, and the saturating curve keeps that figure meaningful
whether a run has one fault or many. **Weaknesses.** The root-cause and recommendation logic
is rule-based, so it explains common fault patterns well but offers only general guidance for
faults outside those patterns.

### Reproducibility across the engine

**Short description.** Reproducibility is a cross-cutting property rather than a single
algorithm. **Function and uses.** A seeded mulberry32 generator drives every random choice,
from softmax sampling to payload variation, and each run seeds it once so that the same seed
and target produce the same sequence of decisions and the same findings. Deterministic
hashing for state identity, field seeds, and fault identity reinforces this behavior.
**Strengths.** Reproducible runs make defects easy to confirm and re-test. **Weaknesses.**
The generator is fast and reproducible but not cryptographically secure, which is acceptable
because it is used only for test decisions.

## Discussion summary

The algorithms above combine into a single decision loop. Established search methods decide
where to move through the application, an established perceptron trained by the delta rule
contributes learned judgment about what to click, and established hashing and data-structure
techniques provide fast, stable identity and bounded memory. Around this established core,
BugSafari adds its own strategies for recognizing screens despite noisy content, blending
rules with learning, measuring genuine coverage, preventing loops, escalating input tests,
and turning a long action trail into a concise, reproducible defect report. The clear
separation between fixed rules and a learning model, and the consistent use of seeded
randomness and deterministic hashing, together give the engine behavior that is adaptive
during a run yet fully repeatable between runs.
