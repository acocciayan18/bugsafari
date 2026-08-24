While the system is designed to provide detailed technical insights, it has specific limitations to keep the study focused and manageable: 

1.	Platform Restrictions: Limited exclusively to browser-based web platforms; it does not support native mobile or standalone desktop applications.
2.	Diagnostic, Not Remedial: The system identifies and logs crash data for analysis but cannot automatically repair source code or rewrite application logic.
3.	Domain Locking: The engine is programmatically restricted to the specified target domain and actively ignores external links to prevent runaway automation.
4.	No Security Bypassing: Designed for educational SPAs, it cannot bypass enterprise security features like CAPTCHAs, multi-factor authentication (MFA), or anti-bot protections.
5.	Hardware Dependency: System performance relies on the host machine, requiring significant memory (RAM) to manage headless browsers and real-time data streams.
6.	Exception Focus: The tool exclusively targets technical exceptions (e.g., JavaScript errors, renderer crashes, 500-level crashes) and injects standard payloads to surface validation flaws and does not evaluate UI/visual bugs.
7.	Partial Coverage: Because exploration is autonomous rather than exhaustive, the engine cannot guarantee that every reachable screen, control, or code path is exercised within a run. The absence of a reported defect is therefore not proof of correctness.
8.	State and Authentication Reachability: The engine only tests states reachable through the rendered interface. Screens hidden behind complex login flows, multi-step wizards, or specific data preconditions may remain unexplored unless the required entry state is already accessible.
9.	Non-Deterministic Exploration: Autonomous traversal and heuristic input selection mean two runs against the same application may follow different paths and surface different defects, which can affect the repeatability of individual findings.
10.	False Positives and False Negatives: Heuristic risk scoring and payload injection may occasionally flag benign behavior or, conversely, miss faults that produce no observable runtime signal. Reported findings are indicative rather than exhaustive.
11.	Time and Resource Budget: Each session runs within a bounded action and time budget, so deep defects that require long or highly specific interaction sequences may not be reached before a run concludes.
12.	Undetectable Defect Classes: The system cannot reliably detect bugs that lack an observable technical exception, including silent business-logic errors, incorrect-but-valid computations, accessibility issues, and cross-browser rendering inconsistencies.
