# BugSafari Thesis Terminology Pool

A comprehensive study and reference sheet for the oral defense. Terms are grouped by category. Each entry gives a plain definition, how it relates to BugSafari (where applicable), and a simple example (where helpful).

---

## Table of Contents

1. [Programming Languages & Core Concepts](#1-programming-languages--core-concepts)
2. [Web Development & SPA Concepts](#2-web-development--spa-concepts)
3. [React](#3-react)
4. [TypeScript](#4-typescript)
5. [Node.js & Backend](#5-nodejs--backend)
6. [Playwright & Browser Automation](#6-playwright--browser-automation)
7. [MongoDB & Databases](#7-mongodb--databases)
8. [Software Testing & QA](#8-software-testing--qa)
9. [Security & Vulnerabilities](#9-security--vulnerabilities)
10. [AI / Machine Learning](#10-ai--machine-learning)
11. [Algorithms & Data Structures](#11-algorithms--data-structures)
12. [Networking, HTTP & APIs](#12-networking-http--apis)
13. [Browser, DOM, Events & JavaScript](#13-browser-dom-events--javascript)
14. [BugSafari Architecture & Components](#14-bugsafari-architecture--components)
15. [Thesis / Research Terms](#15-thesis--research-terms)

---

## 1. Programming Languages & Core Concepts

**Programming Language**
A formal notation used to give instructions to a computer.
- *BugSafari:* Built primarily in TypeScript/JavaScript across frontend and backend.

**Compiler**
A tool that translates source code from one language into another (often to a lower-level form) before running.
- *BugSafari:* TypeScript is compiled down to JavaScript before Node.js executes it.

**Transpiler**
A compiler that converts source code between languages at a similar level of abstraction (e.g. TypeScript → JavaScript).
- *Example:* `const x: number = 5` becomes `const x = 5`.

**Interpreter**
Runs code line-by-line at runtime instead of compiling it all first.
- *Example:* The browser's JavaScript engine interprets/JIT-compiles JS as the page runs.

**Runtime**
The environment where code executes, providing built-in functions and memory management.
- *BugSafari:* Node.js is the backend runtime; the browser is the frontend runtime.

**Synchronous**
Operations run one after another; each blocks the next until it finishes.

**Asynchronous**
Operations can start and finish later without blocking other work.
- *BugSafari:* Playwright actions, network calls, and Socket.IO events are asynchronous.

**Concurrency**
Managing many tasks that make progress over overlapping time periods (not necessarily at the same instant).
- *BugSafari:* Handling multiple telemetry streams and exploration steps without freezing.

**Parallelism**
Actually running multiple tasks at the same time on different cores.

**Callback**
A function passed into another function to run later when something completes.

**Promise**
An object representing a value that will be available in the future (pending → fulfilled/rejected).
- *Example:* `fetch(url).then(res => ...)`.

**async / await**
Syntax that lets you write asynchronous code that reads like synchronous code.
- *Example:* `const page = await browser.newPage()`.

**Event Loop**
The mechanism that lets single-threaded JavaScript handle async tasks by queuing and processing callbacks.
- *BugSafari:* Node.js uses it to juggle exploration, sockets, and DB writes without threads.

**Closure**
A function that "remembers" variables from the scope where it was created, even after that scope exits.

**Immutability**
Data that cannot be changed after creation; updates create new copies instead.
- *BugSafari:* React state and shared data contracts favor immutable updates.

**Pure Function**
A function whose output depends only on its inputs and which causes no side effects.

**Side Effect**
Any change a function makes outside returning a value (writing a file, mutating global state, network call).

**Recursion**
A function that calls itself to solve smaller instances of a problem.

**Serialization / Deserialization**
Converting an in-memory object to a storable/transmittable format (e.g. JSON) and back.
- *BugSafari:* Telemetry and findings are serialized to JSON for Socket.IO and MongoDB.

---

## 2. Web Development & SPA Concepts

**SPA (Single-Page Application)**
A web app that loads one HTML page and updates content dynamically with JavaScript instead of reloading full pages.
- *BugSafari:* The entire engine is purpose-built to explore and stress-test SPAs.
- *Example:* Gmail, where clicking around never triggers a full page reload.

**MPA (Multi-Page Application)**
Traditional web app where each navigation loads a new HTML page from the server.

**Client-Side Rendering (CSR)**
The browser downloads JavaScript and builds the page's content on the user's device.
- *BugSafari:* SPAs it tests are usually client-rendered, which is why DOM traversal matters.

**Server-Side Rendering (SSR)**
The server builds the HTML and sends a ready-to-display page.

**Hydration**
Attaching JavaScript behavior/event listeners to server-rendered HTML so it becomes interactive.

**Routing**
Deciding which view/content to show based on the URL, done client-side in SPAs.
- *Example:* `/dashboard` vs `/login` handled by React Router without server round-trips.

**State**
The current data a UI holds and reacts to (form values, logged-in status, etc.).

**Frontend**
The part of the app users see and interact with (UI).
- *BugSafari:* The developer-dashboard "Watchtower" on port 5173.

**Backend**
The server-side part handling logic, data, and security.
- *BugSafari:* The testing-core engine on port 3000.

**Full-Stack**
Spanning both frontend and backend.

**Monorepo**
A single repository holding multiple related projects/packages.
- *BugSafari:* `developer-dashboard/`, `testing-core/`, and `shared/` live in one repo.

**Build Tool / Bundler**
Software that compiles, bundles, and optimizes source files for the browser.
- *BugSafari:* Vite bundles and serves the frontend.

**Vite**
A fast modern frontend build tool and dev server with instant hot reloading.

**Hot Module Replacement (HMR)**
Updating code in a running app without a full reload, preserving state.

---

## 3. React

**React**
A JavaScript library for building user interfaces from reusable components.
- *BugSafari:* React 19 powers the Watchtower dashboard.

**Component**
A reusable, self-contained piece of UI (a function returning markup).

**JSX**
Syntax that lets you write HTML-like markup inside JavaScript.
- *Example:* `<button onClick={handle}>Run</button>`.

**Props**
Read-only inputs passed from a parent component to a child.

**State (React)**
Data a component owns that, when changed, triggers a re-render.

**Hook**
A special function letting function components use state and lifecycle features.
- *Example:* `useState`, `useEffect`.

**useState**
Hook that adds local state to a component.

**useEffect**
Hook that runs side effects (data fetching, subscriptions) after render.
- *BugSafari:* Used to subscribe to Socket.IO telemetry streams.

**useRef**
Hook that holds a mutable value/DOM reference that persists across renders without causing re-renders.

**Virtual DOM**
An in-memory representation of the UI that React diffs against to update the real DOM efficiently.

**Reconciliation**
React's process of comparing the new virtual DOM to the old one to apply minimal changes.

**Re-render**
When a component runs again to reflect updated state or props.

**Controlled Component**
A form input whose value is driven by React state.

**Context**
A way to share data across many components without passing props at every level.

---

## 4. TypeScript

**TypeScript**
A superset of JavaScript that adds static typing.
- *BugSafari:* Enforces strict data contracts between frontend and backend via `shared/`.

**Static Typing**
Types are checked at compile time before the code runs, catching errors early.

**Type**
A description of the shape/kind of a value (`string`, `number`, custom shapes).

**Interface**
A named contract describing the structure an object must have.
- *Example:* `interface Finding { id: string; severity: number }`.

**Type Inference**
The compiler figuring out a type automatically without an explicit annotation.

**Generic**
A reusable type parameterized by another type.
- *Example:* `Array<Finding>` or `Promise<Page>`.

**Union Type**
A value that can be one of several types.
- *Example:* `string | null`.

**Enum**
A named set of constant values.

**Type Guard**
A runtime check that narrows a value to a more specific type.

**Data Contract**
A shared, strictly typed definition both sides of a system agree on.
- *BugSafari:* The `shared/` package holds contracts bridging dashboard and engine.

---

## 5. Node.js & Backend

**Node.js**
A runtime that executes JavaScript outside the browser, on the server.
- *BugSafari:* Runs the testing-core engine.

**Express**
A minimal Node.js web framework for building APIs and servers.
- *BugSafari:* Serves the backend REST endpoints (`/api/...`).

**Middleware**
Functions that run in sequence on each request to handle auth, logging, parsing, etc.
- *BugSafari:* Auth middleware parses tokens and gates protected routes.

**REST API**
A style of HTTP API using resources and standard verbs (GET, POST, etc.).
- *BugSafari:* `/api/auth/*`, `/api/safari/*`, `/api/users`, `/api/settings`.

**Endpoint / Route**
A specific URL + method the server responds to.

**Socket.IO**
A library for real-time, bidirectional communication between server and client over WebSockets.
- *BugSafari:* Streams live element decisions, ML ratings, and sensory frames to the dashboard.

**WebSocket**
A protocol keeping a persistent open connection for two-way real-time messaging.

**Environment Variable**
A configuration value set outside the code (secrets, ports, feature flags).
- *Example:* `BUGSAFARI_STOP_TIMEOUT_MS`.

**Podman**
A container engine (like Docker) for packaging and running the app in isolated environments.
- *BugSafari:* The engine ships to a Podman container.

**Container**
A lightweight, isolated bundle of an app plus its dependencies that runs consistently anywhere.

**Multi-Tenant**
One system serving many users while keeping each user's data isolated.
- *BugSafari:* Each operator's tracking history is isolated per user in the database.

**Stateless**
A server that keeps no per-user memory between requests; each request carries what it needs.
- *BugSafari:* Auth is stateless via local token parsing (JWT).

**Repository Pattern**
Abstracting data access behind an interface so business logic doesn't touch the DB directly.
- *BugSafari:* Used in `testing-core/src/infrastructure/database`.

---

## 6. Playwright & Browser Automation

**Playwright**
A framework that programmatically controls real browsers (Chromium, Firefox, WebKit).
- *BugSafari:* The "arms and eyes" — traverses the DOM, clicks, types, and captures frames.

**Browser Automation**
Driving a browser with code instead of a human clicking.

**Headless Browser**
A browser running without a visible window, controlled entirely by code.

**Page**
Playwright's object representing a single browser tab you can interact with.

**Selector**
A string identifying an element on the page (CSS or XPath).
- *Example:* `page.click('#submit')`.

**Locator**
A Playwright object that finds elements lazily and re-queries them when needed.

**Auto-Waiting**
Playwright automatically waits for elements to be actionable before interacting.

**page.evaluate**
Runs JavaScript inside the browser page's context and returns the result.
- *BugSafari:* Used to read DOM structure and inject scripts; `console.*` inside it stays as `console` (browser context).

**Screenshot / Sensory Frame**
A captured image of the current page state.
- *BugSafari:* Streamed as live "sensory frames" to the Watchtower.

**Navigation**
Loading a URL or moving between views in the controlled browser.

---

## 7. MongoDB & Databases

**MongoDB**
A NoSQL, document-oriented database storing data as flexible JSON-like documents.
- *BugSafari:* Stores sessions, telemetry, findings, and brain config snapshots on MongoDB Atlas.

**MongoDB Atlas**
MongoDB's managed cloud database service.

**Document**
A single record in MongoDB, stored as a BSON/JSON-like object.

**Collection**
A group of related documents (like a table in SQL).

**NoSQL**
Databases that don't use rigid relational tables; flexible schemas, various models (document, key-value, graph).

**SQL**
Structured Query Language; used by relational databases with fixed table schemas.

**Schema**
The defined structure/shape of stored data.
- *BugSafari:* Mongoose schemas define sessions, errors, action traces, findings.

**Mongoose**
An ODM (Object Data Modeling) library that adds schemas and validation on top of MongoDB in Node.js.

**Index**
A data structure that speeds up queries on certain fields at the cost of extra storage.

**Query**
A request to read/filter data from the database.

**CRUD**
Create, Read, Update, Delete — the four basic data operations.

**Soft Delete**
Marking a record as deleted (archived/trashed) instead of physically removing it.
- *BugSafari:* History delete is soft (Archive/Trash); a reaper purges trash after a retention period.

**Persistence**
Storing data durably so it survives restarts.

---

## 8. Software Testing & QA

**QA (Quality Assurance)**
The discipline of ensuring software meets quality standards.

**Exploratory Testing**
Testing without predefined scripts, where the tester learns and adapts while probing the app.
- *BugSafari:* Automates this — an agent explores instead of a human.

**Autonomous Testing**
Testing that runs and makes decisions on its own without human scripting.
- *BugSafari:* Core value proposition — scriptless, adaptive, self-directed.

**Scriptless Testing**
Testing that requires no pre-written step-by-step scripts.

**Regression**
A bug where something that used to work is now broken.
- *BugSafari:* A key target — surfacing regressions automatically.

**Test Case**
A defined set of inputs and expected outputs to verify behavior.

**Assertion**
A check that a condition is true; fails the test if not.

**Unit Test**
Tests a single small piece of code in isolation.

**Integration Test**
Tests how multiple components work together.

**End-to-End (E2E) Test**
Tests the whole app flow from the user's perspective.

**Code Coverage**
A measure of how much code is exercised by tests.
- *BugSafari:* Exploration coverage of the app's state space is the analog concept.

**Test Oracle**
The mechanism that decides whether observed behavior is correct or a bug.
- *BugSafari:* Uses crashes, unhandled errors, and constraint violations as oracles.

**Flaky Test**
A test that passes/fails inconsistently without code changes.
- *BugSafari:* One known telemetry test is environment/CPU-bound and flaky on slow hosts.

**Chaos Testing**
Deliberately injecting failures/randomness to see how a system copes.
- *BugSafari:* Applies chaotic, unexpected interactions to stress the SPA.

**Stress Testing**
Pushing a system beyond normal load/limits to find breaking points.

**Boundary Testing**
Testing at the edges of allowed input ranges where bugs cluster.
- *BugSafari:* Attack scenarios target boundary-state vulnerabilities.

**Test Reproducibility**
The ability to reliably re-trigger a discovered bug.
- *BugSafari:* A 20-step Circular Action Buffer records the path to reproduce a crash.

---

## 9. Security & Vulnerabilities

**Vulnerability**
A weakness that can be exploited to compromise a system.

**Injection Attack**
Feeding malicious input that the system wrongly executes as code/commands.

**SQL Injection (SQLi)**
Injecting SQL through inputs to read, modify, or bypass a relational database.
- *BugSafari:* A detected bug class; a finder probes inputs and gates findings on behavioral proof.
- *Example:* Entering `' OR '1'='1` into a login field to bypass authentication.

**NoSQL Injection (NoSQLi)**
Injecting operators/objects to manipulate a NoSQL query (e.g. MongoDB).
- *Example:* Sending `{"$gt": ""}` as a password to match any record.

**XSS (Cross-Site Scripting)**
Injecting malicious scripts into a page that run in other users' browsers.
- *Example:* Storing `<script>steal()</script>` in a comment field.

**Constraint Bypass**
Circumventing a validation rule or business constraint the app is supposed to enforce.
- *BugSafari:* An attack scenario class targeting weak backend enforcement.

**Fuzzing**
Feeding large amounts of malformed/random/edge-case input to trigger faults.
- *BugSafari:* Applies heuristic data fuzzing to form fields to expose crashes.

**Heuristic Fuzzing**
Fuzzing guided by rules/experience rather than pure randomness, for smarter inputs.
- *BugSafari:* Chooses payloads based on field type and attack surface.

**Attack Surface**
All the points where an attacker could try to enter or extract data.

**Payload**
The actual malicious/crafted data sent in an attack attempt.
- *BugSafari:* Fuzz helpers only compute a payload; a finder must also inject and submit it to observe an effect.

**SSRF (Server-Side Request Forgery)**
Tricking a server into making requests to unintended internal destinations.
- *BugSafari:* An SSRF guard restricts what the engine can reach, forcing a tunnel for the target app.

**Authentication**
Verifying who a user is (login).

**Authorization**
Verifying what an authenticated user is allowed to do (permissions).

**JWT (JSON Web Token)**
A signed, self-contained token carrying user identity/claims, parsed locally without server session state.
- *BugSafari:* Powers stateless auth; access token in localStorage.

**httpOnly Cookie**
A cookie JavaScript cannot read, protecting it from theft via XSS.
- *BugSafari:* The refresh token lives in a `bugsafari_rt` httpOnly cookie.

**CSRF (Cross-Site Request Forgery)**
Tricking a logged-in user's browser into sending an unwanted authenticated request.
- *BugSafari:* Mitigated via a custom `x-bugsafari-access` header.

**Least Privilege**
Granting only the minimum access needed; don't expose data needlessly.

**Guest / Unauthenticated Mode**
A limited mode for users without accounts.
- *BugSafari:* Guests can run tests but cannot save permanent database records.

**Behavioral Evidence Gate**
A rule that a claimed vulnerability must show real behavioral proof before being reported.
- *BugSafari:* Security findings are gated on structured markers (signals/status code/endpoint/bypass) at promotion chokepoints.

**False Positive**
A reported bug that isn't actually a real bug.
- *BugSafari:* Evidence gating exists to suppress these.

---

## 10. AI / Machine Learning

**Artificial Intelligence (AI)**
Systems that perform tasks that normally require human intelligence.

**Machine Learning (ML)**
Systems that improve at a task by learning from data rather than explicit programming.
- *BugSafari:* Learns which UI elements are worth interacting with.

**Model**
The learned function that maps inputs to outputs/predictions.
- *BugSafari:* A cognitive model that scores/rates the application layout.

**Perceptron**
The simplest neural unit: weights inputs, sums them, applies a threshold to produce an output.
- *BugSafari:* Uses a Single-Layer Perceptron to score DOM elements.

**Single-Layer Perceptron (SLP)**
A perceptron with one layer of weights; a linear classifier.
- *BugSafari:* Rates interaction targets; simple, fast, and explainable.

**Weight**
A learned number expressing how much an input feature matters.

**Feature**
A measurable input property fed to the model.
- *BugSafari:* Element attributes (tag, visibility, size, type) become features.

**Delta Rule**
A learning rule that updates weights in proportion to the error between predicted and desired output.
- *BugSafari:* Trains the perceptron's element scoring online during exploration.
- *Formula idea:* `new_weight = old_weight + learningRate × error × input`.

**Learning Rate**
How big each weight-update step is during training.

**Supervised Learning**
Learning from labeled examples (input → correct output).

**Reinforcement-Style Feedback**
Learning driven by reward/penalty signals from outcomes.
- *BugSafari:* Reward-like signals (novelty, crashes) steer future element choices.

**Inference / Prediction**
Using a trained model to produce an output for new input.
- *BugSafari:* Scoring a freshly discovered element's interaction value.

**Online Learning**
Updating the model continuously as new data arrives, not in one big batch.
- *BugSafari:* The perceptron adapts live as it explores.

**Heuristic**
A practical rule-of-thumb that gives good-enough decisions without guaranteed optimality.
- *BugSafari:* Used for fuzzing data, scoring novelty, and detecting stagnation.

---

## 11. Algorithms & Data Structures

**Algorithm**
A step-by-step procedure to solve a problem.

**Data Structure**
A way of organizing data for efficient access and modification.

**Hashing**
Converting data into a fixed-size fingerprint (hash) for fast comparison/lookup.

**Structural DOM Hashing**
Fingerprinting the DOM's structure so identical/similar page states can be recognized.
- *BugSafari:* Prevents loops by detecting already-visited states.

**Circular Buffer (Ring Buffer)**
A fixed-size buffer that overwrites the oldest entry when full.
- *BugSafari:* The 20-step Circular Action Buffer keeps the last 20 actions to reproduce crashes.

**State Space**
The set of all possible states an application can be in.
- *BugSafari:* Exploration is a search through the SPA's state space.

**State Graph**
A graph where nodes are app states and edges are actions/transitions.
- *BugSafari:* The StateGraphNavigator models exploration as walking this graph.

**Graph Traversal**
Visiting nodes of a graph systematically (BFS, DFS).

**BFS (Breadth-First Search)**
Explores all neighbors at the current depth before going deeper.

**DFS (Depth-First Search)**
Explores as far down one path as possible before backtracking.

**Pathfinding**
Finding a route between two nodes in a graph.
- *BugSafari:* A directed path finder navigates back to specific states.

**Loop Prevention / Cycle Detection**
Avoiding revisiting the same states endlessly.
- *BugSafari:* Uses DOM hashing, a state-cluster registry, and edge-repeat tracking.

**Clustering**
Grouping similar items together.
- *BugSafari:* A state-cluster registry groups near-identical page states.

**Novelty Scoring**
Rewarding states/actions that are new or rarely seen.
- *BugSafari:* Pushes the agent toward unexplored parts of the app.

**Stagnation Detection**
Recognizing when exploration stops making progress.
- *BugSafari:* Triggers a change in strategy when stuck.

**Search-Based Software Engineering (SBSE)**
Applying search/optimization algorithms to software engineering problems like test generation.
- *BugSafari:* Exploration is framed as a guided search for bug-revealing states.

**Greedy Algorithm**
Makes the locally best choice at each step.
- *BugSafari:* Element selection leans on highest-scored target (with novelty tempering).

---

## 12. Networking, HTTP & APIs

**HTTP**
The protocol browsers use to request and receive web resources.

**HTTPS**
HTTP encrypted with TLS for secure transport.

**Request / Response**
A client asks (request); a server answers (response).

**HTTP Method / Verb**
The action type of a request: GET (read), POST (create), PUT/PATCH (update), DELETE.

**Status Code**
A number signaling the result of a request.
- *Examples:* 200 OK, 401 Unauthorized, 404 Not Found, 500 Server Error.
- *BugSafari:* Anomalous status codes are behavioral evidence for security findings.

**Header**
Metadata attached to a request/response (auth tokens, content type).
- *BugSafari:* `x-bugsafari-access` header carries the CSRF-protecting access token.

**Payload / Body**
The data carried in a request or response.

**API (Application Programming Interface)**
A defined way for software components to talk to each other.

**Endpoint**
A specific callable URL of an API.

**Latency**
The delay between a request and its response.

**Tunnel**
A secure relay exposing a local/internal service to the engine or the internet.
- *BugSafari:* `npm run tunnel` lets the SSRF-guarded engine reach the target app.

**Port**
A numbered channel on a host for a specific service.
- *BugSafari:* Dashboard on 5173, engine on 3000.

**CORS (Cross-Origin Resource Sharing)**
Browser rules controlling which origins may call an API.

---

## 13. Browser, DOM, Events & JavaScript

**DOM (Document Object Model)**
The browser's live tree representation of a page's HTML that scripts can read and change.
- *BugSafari:* Playwright traverses the DOM to find and score interactable elements.

**Node / Element**
A single item in the DOM tree (a tag, text, etc.).

**Attribute**
A property on an element (`id`, `class`, `type`, `href`).
- *BugSafari:* Element attributes feed the perceptron's feature vector.

**Event**
A signal that something happened in the browser (click, input, load).

**Event Listener / Handler**
Code registered to run when a specific event fires.

**Event Bubbling**
An event propagating up from the target element through its ancestors.

**Selector (CSS)**
A pattern to match elements.
- *Example:* `.btn-primary`, `#login`.

**Rendering**
The browser painting the DOM/CSS into visible pixels.

**JavaScript Engine**
The component that executes JS in the browser (e.g. V8 in Chromium).

**Console**
The browser's logging/debugging output stream.
- *BugSafari:* Telemetry monitors capture console errors as fault signals; logs inside `page.evaluate` must stay `console.*`.

**Unhandled Error / Exception**
An error that propagates without being caught, often crashing behavior.
- *BugSafari:* Multi-channel telemetry catches unhandled script faults and API loop errors.

**Form Submission**
Sending form field values to the server/handler.
- *BugSafari:* Fuzzing requires setting field values and triggering submission to observe effects.

**localStorage**
Browser key-value storage that persists across sessions.
- *BugSafari:* Holds the access token.

**Viewport**
The visible area of a web page in the browser window.

---

## 14. BugSafari Architecture & Components

**BugSafari**
An autonomous, scriptless, adaptive exploratory testing engine for SPAs that explores, interacts, and stress-tests to find regressions, logic loops, and backend security loopholes without human scripting.

**Watchtower (developer-dashboard)**
The frontend operator console (port 5173) streaming live decisions, ML ratings, sensory frames, and crash details.

**Intelligence & Arsenal Layer (testing-core)**
The backend engine (port 3000) coordinating scanning, the ML models, attack scenarios, and telemetry monitors.

**Security & Storage Model**
The full-stack data platform handling stateless auth, per-user isolated history, and guest routing.

**shared/**
The strict TypeScript data-contract package bridging frontend and backend.

**Exploration Engine / Loop**
The core cycle: observe the DOM, score elements, act, record telemetry, repeat.

**StateGraphNavigator**
Component modeling exploration as traversal of a state graph of app states and action edges.

**RiskScorer**
Scoring component estimating how bug-revealing or risky an element/action is.

**Single-Layer Perceptron (Delta Rule)**
The ML element-scorer that learns online which targets to interact with.

**Structural DOM Hashing**
The loop-prevention fingerprinting of page structure to detect revisited states.

**StateClusterRegistry**
Registry grouping near-identical states into clusters to avoid redundant exploration.

**EdgeRepeatTracker**
Tracks how often a given action-edge has been repeated to discourage loops.

**Novelty / Stagnation Scoring**
Heuristics steering the agent toward new states and away from being stuck.

**Circular Action Buffer (20-step)**
The ring buffer storing the last 20 actions so a crash can be reproduced forensically.

**Heuristic Data Fuzzing**
Rule-guided generation of edge-case inputs for form fields.

**Attack Scenarios / Finders**
The battery of automated probes (SQLi, NoSQLi, XSS, constraint bypass) that test for vulnerabilities.

**Security Evidence Gate (securityEvidenceGate.ts)**
Chokepoint enforcing that vuln findings carry structured behavioral proof before promotion.

**Telemetry / Sensory Frames**
The streamed live screenshots and event/error data feeding the Watchtower.

**Findings**
The recorded bug/vulnerability results, with severity and reproduction context.

**Session / Run**
One exploration execution against a target, with its own history and findings.

**Admission Slot / SessionManager**
Concurrency control governing how many exploration runs may execute; handles stop requests.

**Force-Release Watchdog**
`BUGSAFARI_STOP_TIMEOUT_MS` timeout that force-releases a hung stop and frees its slot.

**Target App / Benchmark**
`bugsafari-target-app`, a purpose-built SPA reproducing every detected bug class for testing the engine.

**Observability Logger**
Zero-dependency logger with request IDs and a `/metrics` endpoint under `infrastructure/observability`.

---

## 15. Thesis / Research Terms

**Thesis / Dissertation**
A formal research document presenting original work and its findings.

**Research Problem**
The specific gap or question the work addresses.
- *BugSafari:* The predictability gap of traditional script-based testing tools for SPAs.

**Hypothesis**
A testable proposed explanation or expected outcome.

**Objective**
A concrete goal the research aims to achieve.

**Scope**
The boundaries of what the research covers.

**Limitation**
An acknowledged constraint or weakness of the work.

**Significance of the Study**
Why the work matters and who benefits.

**Related Work / Literature Review**
Survey of prior research and how this work differs.

**Methodology**
The systematic approach used to build and evaluate the work.

**Prototype / Artifact**
The concrete system built to demonstrate the research.
- *BugSafari:* The engine itself is the research artifact.

**Evaluation / Validation**
Measuring whether the system meets its goals.
- *BugSafari:* Validated against the target-app benchmark that seeds known bug classes.

**Benchmark**
A standard reference case used to measure performance/effectiveness.

**Baseline**
A reference point to compare improvements against.

**Metric**
A quantitative measure of performance (bugs found, coverage, false-positive rate).

**Reproducibility**
The ability of others to repeat results under the same conditions.

**Empirical**
Based on observation and measured evidence rather than theory alone.

**Novelty / Contribution**
The new, original value the work adds to the field.
- *BugSafari:* Combining a learned element scorer, structural loop prevention, and evidence-gated security finding in one autonomous SPA engine.

**Autonomous Agent**
Software that perceives its environment and acts toward goals without step-by-step human control.
- *BugSafari:* The exploration engine is such an agent.

**Adaptive System**
A system that changes behavior based on feedback/experience.
- *BugSafari:* Learns and shifts strategy as it explores.

**Forensic Telemetry**
Detailed after-the-fact evidence collected to explain and reproduce a failure.
- *BugSafari:* The action buffer plus telemetry streams enable crash forensics.

---

*End of terminology pool. Grouped for study; skim by category before the defense and drill the BugSafari-specific section (14) hardest, since examiners probe your own system first.*
