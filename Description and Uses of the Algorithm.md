# Description and Uses of the Algorithm in the Study

This section presents the core algorithms that drive BugSafari, the autonomous exploratory
testing engine developed in this study. For each algorithm, the discussion explains what the
algorithm is and how it works inside the system, and then explains why the study uses it, what
problem it solves, and how it helps BugSafari reach its goal of finding defects in single-page
web applications without a human writing test scripts. Where useful, the discussion also
describes how each algorithm connects to the other parts of the engine. Every description was
checked against the actual source code of the system rather than assumed from general testing
practice.

---

## 1. Single-Layer Perceptron and the Delta Rule

### Description

The Single-Layer Perceptron is a small machine learning model that decides how promising each
clickable element on a page is. Before the engine acts, it turns every candidate element into a
list of numeric features. These features describe simple, observable facts about the element,
such as whether it is a button, a link, or an input field, whether it has an identifier or a
label, how large it is, how near the top of the page it sits, and whether its text contains
meaningful keywords such as "login", "pay", "checkout", "delete", or "search". The perceptron
holds one weight for each feature. It multiplies every feature by its weight, adds the results
together with a bias term, and passes the total through a logistic (sigmoid) function so that
the output becomes a single rating between zero and one. A higher rating means the element is
more likely to lead somewhere useful.

The model does not stay fixed while the engine runs. After the engine interacts with an
element and observes what happened, it corrects the weights using the Delta Rule, which is the
classic error-driven learning rule for this kind of model. The rule measures the difference
between what the model predicted and what the outcome deserved, and then nudges each weight in
the direction that would have reduced that error. BugSafari extends the basic rule with a few
stabilising additions taken from standard practice: momentum, so that rewards pointing in the
same direction build up speed and a single stray result cannot flip a well-learned weight; a
slowly shrinking learning rate, so that early updates make large corrections and later updates
only fine-tune; a small weight decay that keeps weights from growing without limit; and a hard
clamp on the size of any single weight. Rather than learning from one plain right-or-wrong
label, the engine forms its learning target from several signals at once. A detected fault is
the strongest positive signal, real network activity and a genuine new page state are moderate
positives, and unhelpful outcomes such as returning to an already-seen state, landing on a
fully exhausted page, or triggering no change at all act as negative signals that push the
element's feature pattern down.

### Origin

The perceptron was introduced by the American psychologist Frank Rosenblatt in 1958, building on
the earlier artificial-neuron model of Warren McCulloch and Walter Pitts (1943). The Delta Rule
that trains it, also known as the Widrow-Hoff or Least-Mean-Squares rule, was developed by
Bernard Widrow and his student Marcian (Ted) Hoff at Stanford University in 1960. The logistic
(sigmoid) function used to bound the output is far older, first described by the Belgian
mathematician Pierre-Francois Verhulst in the 1840s. The refinements BugSafari layers on top,
such as momentum and weight decay, come from the later neural-network literature of the 1980s
and 1990s rather than from a single named author.

### Uses in the Study

BugSafari must choose, out of the many controls on a modern web page, which one to interact
with next. The study uses the perceptron because it provides a fast, lightweight way to rank
those controls and, more importantly, because it can learn during the run itself. The system
never needs a separate offline training phase or a labelled dataset. It begins with sensible
starting weights that already favour high-value controls such as login and payment buttons,
and then it improves those weights from its own experience as it explores. This lets the engine
gradually shift its attention toward the kinds of elements that, on the specific application
under test, actually reveal defects or open new areas.

The perceptron does not act alone. Its rating is combined with a set of fixed keyword rules in
the engine's scoring stage, where the final risk score for an element is sixty percent
heuristic rule and forty percent perceptron rating. The rules give the engine reliable
judgement from the first click, while the perceptron adds the ability to adapt. The learned
weights can also be saved as a "brain" snapshot so that knowledge gained in one session can
seed a later one. In this way the perceptron is the adaptive core that keeps the engine's
attention focused on the most rewarding parts of the application.

---

## 2. Depth-First Search (DFS) Pathfinding

### Description

BugSafari treats the application under test as a graph. Each distinct screen or user-interface
state is a node in that graph, identified by a fingerprint of its structure, and each clickable
control that leads from one state to another is an edge. To move through this graph the engine
uses Depth-First Search with backtracking. It keeps a breadcrumb stack that records the path it
has taken from the starting page to the state it is currently in. At each step it follows the
most promising unexplored control deeper into the application, pushing each new state onto the
stack. When it reaches a dead end, a page where every control has already been tried, or when
it detects that it is looping, it backtracks by stepping back up the stack to an earlier state
that still has unexplored controls, and it continues from there.

The order in which controls are tried is decided by the engine's scoring pipeline, not by the
search itself. The pathfinding layer only manages the shape of the traversal: which state is
current, how the engine got there, and when to backtrack. The breadcrumb stack also helps the
engine notice loops, because a state that already appears deeper in the stack signals that the
engine has circled back rather than moved forward. When a whole branch is used up, the engine
can also jump to another unexplored region of the graph instead of restarting from the top.

### Origin

Depth-First Search as a systematic way of walking a maze traces back to the French engineer
Charles Pierre Tremaux in the nineteenth century. Its modern form as an efficient graph
algorithm, together with the analysis that made it a standard tool, was established by Robert
Tarjan and John Hopcroft around 1971-1972. The general idea of backtracking that DFS relies on
was named and studied by D. H. Lehmer in the 1950s.

### Uses in the Study

The goal of BugSafari is to explore an application deeply and reach states that only appear
after several steps, such as a form that is available only after logging in and opening a
particular page. Depth-First Search is well suited to this because it naturally drives toward
these deep, multi-step states while keeping memory use low, since it only needs to remember the
single path it is currently on rather than every screen at once. This matches the study's need
to follow long user flows without losing its place.

The backtracking behaviour solves a second problem: getting stuck. Without it, an autonomous
agent can waste the whole run trapped on one screen or wandering in circles. By backtracking
when it hits dead ends or loops, and by jumping to fresh regions when a branch is exhausted,
the engine keeps making progress and steadily widens its coverage of the application. The
pathfinder works hand in hand with the scoring model, which decides what to click, and with the
structural fingerprinting described next, which tells the search when two screens are really the
same state and therefore when a loop has occurred.

---

## 3. DOM Structural Hashing and the Repetition Penalty

### Description

Structural hashing is how BugSafari recognises whether it has seen a screen before. Modern web
pages change constantly in small ways, such as timestamps, counters, advertisements, animation
classes, and randomly generated identifiers, even when the page is, for the tester's purposes,
the same screen. To see past this noise, the engine reads the live page and builds a normalised
description of it. It keeps the meaningful skeleton of the layout and the set of interactive
controls together with their stable states, such as whether a control is disabled or checked,
but it strips away the parts that change on their own: dynamic class names, free-floating text
and numbers, advertisement and media blocks, and repeated identical rows. It then runs this
cleaned description through the SHA-256 hashing function to produce a short, fixed-size
fingerprint. Two screens that are genuinely the same produce the same fingerprint, while
genuinely different screens produce different ones. The engine can optionally fold the page's
route into the fingerprint so that two pages that look identical but live at different addresses
are still treated as separate states.

The repetition penalty builds on these fingerprints to stop the engine from repeating itself.
A single-page application often reuses the same navigation control across many similar screens,
so clicking that control can appear to be a new action each time even though it keeps returning
the engine to a place it has already been. The engine tracks each control by the combination of
the screen's structure and the control itself, and it counts only the unproductive uses, meaning
the ones that land back on an already-seen structure. Once a control has produced enough of
these unproductive repeats it is declared exhausted and is blocked for the rest of the session,
which pushes the engine toward routes it has not yet explored. If a control ever does something
useful again, such as reaching a genuinely new screen, its count is cleared, so a control that
is only sometimes helpful, like a pagination button, is never lost for good.

### Origin

This technique is a composite rather than a single named algorithm. Its foundation, the general
idea of reducing data to a short fixed-size fingerprint, comes from the work on hashing usually
credited to Hans Peter Luhn at IBM in the 1950s. The specific hash function BugSafari uses,
SHA-256, was designed by the United States National Security Agency and published as a federal
standard by NIST in 2001. The practice of hashing a normalised structure so that equivalent
inputs collapse to the same fingerprint echoes the hash-tree idea introduced by Ralph Merkle in
1979. The repetition penalty itself is a heuristic designed for this study rather than a
published algorithm with a named author.

### Uses in the Study

Loop prevention is essential for autonomous exploration, and this pair of techniques is how the
study achieves it. The structural fingerprint gives the engine a reliable sense of identity for
each screen, which the pathfinder uses to recognise loops, to give each graph node a stable
name, and to decide when an action has actually changed the application's state. Without it, the
constant background churn of a real web page would make every reload look like a brand new
screen and the engine would explore forever without progress.

The repetition penalty then solves the specific and common problem of navigation loops, where a
shared menu or link keeps drawing the engine back to familiar ground. By counting only
unproductive repeats and blocking controls that have clearly stopped helping, the engine spends
its limited time reaching new parts of the application instead of circling known ones. Together,
structural hashing and the repetition penalty are what allow the exploration to terminate in a
meaningful way and to claim real coverage, and they feed directly into both the pathfinding
layer and the learning signals that reward or penalise the perceptron.

---

## 4. Semantic Classification and Payload Fuzzing

### Description

Once the engine reaches an input field, it must decide what to type into it. It begins with
semantic classification, which reads the field's own clues, such as its input type and the
words in its name, identifier, placeholder, and label, and sorts the field into a category. The
categories include numeric fields, free-text and search fields, authentication fields such as
login and password, email fields, date fields, and structured data fields, with a general
fallback for anything that does not clearly fit. The classification follows a fixed priority
order so that sensitive authentication fields are recognised first. For ordinary progress
through a form, the engine can fill each category with a realistic and harmless sample value so
that it can move forward without tripping validation.

For defect hunting, the engine switches to payload fuzzing, which supplies deliberately hostile
input tailored to the field's category. The payloads are produced by an escalation process that
adds complexity in stages. The first level uses a base attack value chosen for the category,
such as a boundary number for numeric fields, a script vector for text fields, or a database
query fragment for authentication fields. Higher levels then layer on further mutations:
characters that break parsers, encodings and context-escaping tricks that slip past naive
filters, greatly lengthened values that probe size and denial-of-service limits, and finally a
single combined payload designed to be active in several different interpreters at once. When a
standard payload fails to move the application's state, the engine escalates to the next level
rather than giving up. Crucially, the whole process is deterministic: each payload is derived
from the field's category, the escalation level, and a stable seed, with no reliance on random
numbers or the clock, and the engine advances through the catalogue of attack values as it
revisits a field so that repeated visits sweep many different vectors.

### Origin

Fuzzing, the practice of feeding a program deliberately malformed or unexpected input to expose
faults, was introduced by Professor Barton Miller and his students at the University of
Wisconsin-Madison in 1988, with their findings published in 1990. The semantic classification
step that decides which family of payloads a field should receive is a rule-based scheme built
for this study rather than a published algorithm; it draws on the long-standing security
practice of tailoring attack strings to input type, such as the injection and cross-site
scripting vectors catalogued by the OWASP community in the 2000s.

### Uses in the Study

Blindly typing the same text into every field would find very few bugs, so the study uses
semantic classification to make the engine's input intelligent. By understanding what a field is
for, the engine can send the right family of hostile values to each one, which greatly raises
the chance of exposing input-handling defects such as injection flaws, boundary errors, and
missing validation. The benign sample values serve the complementary purpose of letting the
engine pass through forms to reach the deeper states that only appear once a form is completed.

The escalation strategy solves the problem of applications that resist a first, simple probe. By
adding one layer of complexity at a time and only escalating when the application does not
react, the engine applies just enough pressure to reveal a weakness without wasting effort. The
insistence on determinism is what makes the results useful as evidence: because every payload
can be regenerated exactly from its category, level, and seed, any fault the fuzzer triggers can
be reproduced byte for byte during verification. This connects fuzzing directly to the engine's
forensic and reproduction machinery, so that a discovered defect is not just detected but can be
demonstrated again on demand.

---

## 5. Multi-Channel Exception Interception and the Circular Action Buffer

### Description

A defect in a web application can reveal itself in more than one place, so BugSafari listens on
several channels at the same time rather than watching only the visible page. During each step
of exploration it attaches listeners that capture three kinds of evidence: the responses of the
application's backend calls, including their status codes, so that failed or error responses are
recorded; console errors and warnings printed by the page; and uncaught script exceptions thrown
in the browser. Each of these is collected into a small, capped record for the current step so
that a misbehaving page cannot flood the system, and the same listener set is shared by the
different testing pipelines so that they all observe faults in a consistent way. This lets the
engine attribute any backend failure or script error to the exact action that caused it.

Running alongside this is the Circular Action Buffer, which remembers what the engine has been
doing. It is a fixed-capacity ring buffer that continuously stores the most recent actions the
engine has performed, each with the details needed to describe and repeat it, such as the type
of action, the target control, the page address, and any value that was typed. Because it has a
fixed size, it uses constant memory and simply overwrites the oldest action when it is full,
always keeping the latest stretch of activity. When a fault is detected, this recent history is
exactly the causal chain that led up to it, and the engine turns the buffered actions into a
clear, numbered set of reproduction steps, which it can further shorten to the smallest sequence
that still triggers the fault.

### Origin

Neither part is attributable to a single inventor. The circular, or ring, buffer is a classic
fixed-size data structure that has been part of standard computing practice since at least the
1960s, with no single named originator; it is described in the foundational literature such as
Donald Knuth's *The Art of Computer Programming* (from 1968 onward). Multi-channel exception
interception is an engineering pattern rather than a formal algorithm, built on the event
listener and observer ideas that became common in graphical and web programming from the 1990s
onward. The specific arrangement used here, tying several browser observation channels to a
single action and pairing them with a bounded action history, was designed for this study.

### Uses in the Study

The study needs to catch defects reliably and then prove them, and this pair of mechanisms
serves both needs. Multi-channel interception solves the problem that a single point of
observation is not enough: a bug that produces no visible change on the page may still show up as
a failed network response or an error in the console, and by watching all these channels at once
the engine detects faults that a narrower check would miss. Tying each observation to the current
step also makes it clear which action was responsible.

The Circular Action Buffer then solves the problem of reproduction. Detecting a fault is only
valuable if a developer can see it happen again, and because the buffer always holds the recent
sequence of actions, the engine can reconstruct precisely how the fault was reached and present
it as a step-by-step recipe. This is what turns BugSafari's findings into actionable bug
reports rather than mere alerts. The buffer draws on the action records produced throughout
exploration and feeds the forensic reporting and replay parts of the system, closing the loop
between finding a defect and demonstrating it.

---

## Summary

Taken together, these five algorithms cover the four things an autonomous exploratory tester
must do. The Single-Layer Perceptron with the Delta Rule decides what to interact with and
learns from experience. Depth-First Search pathfinding decides where to go and how to move
through the application without getting stuck. Structural hashing with the repetition penalty
keeps the engine from looping by recognising screens it has already seen and retiring controls
that no longer help. Semantic classification with payload fuzzing decides what to type in order
to expose input-handling defects in a repeatable way. Multi-channel exception interception with
the Circular Action Buffer catches faults across several channels and preserves the history
needed to reproduce them. Each algorithm was selected for a specific role, and they operate as a
connected pipeline in which the output of one becomes the input or the guidance of the next.
