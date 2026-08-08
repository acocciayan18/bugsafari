## Database Structure Description

The BugSafari system uses a document-oriented NoSQL database built on MongoDB to store its
software testing data. Rather than placing information in rigid relational tables, the
database organises data into flexible groups called collections. This design lets the
system store the varied and changing records produced during automated exploration, such
as evolving web page structures, system logs, and machine learning scoring outputs,
without forcing them into a fixed shape. Every record the database saves receives a unique
identifier that the database system creates automatically.

The structure is built around two central collections: the users collection and the
sessions collection. The users collection holds the records of registered account owners.
Its main identifier is the user identifier, and each record stores basic profile details,
account credentials, and personal display settings. The sessions collection represents a
single automated testing run. It carries two identifiers, the internal session identifier
and a short, unique run code shown to the operator, and each record stores the overall
details of a run, including the target website address, the run status, the tested feature
profile, and the summary results. The findings discovered during a run and the ordered
trail of actions the engine performed are kept inside the session record itself, so that a
complete report can be read from a single document.

Around these two central records, the system uses several supporting collections to store
the specific evidence captured during a run. The forensic errors collection records the
software defects that were found, including their messages, severity levels, affected web
elements, and locations. The console logs collection captures the messages, warnings, and
notices printed by the target application during testing, while the network logs
collection stores every network request made during exploration, both successful and
failed, together with response status codes and load times. The telemetry events
collection keeps the ordered stream of live events emitted during a run, so that a viewer
who reconnects can replay the run in its original order. The forensic telemetry collection
records the performance and environment measurements of a run, such as the total runtime,
the browser used, and the screen dimensions, and the forensic analyses collection holds
the higher-level risk summaries and correction advice worked out from the recorded errors.
Two further collections support the platform itself: the brain configurations collection
stores the machine learning weights the engine learned, and the refresh tokens collection
manages secure sign-in states for registered operators.

The collections are connected to one another by sharing identifiers. When one record
belongs to another, it stores a copy of the parent record's identifier, and the system
follows these shared values to move between related records. Most of these connections
follow a one-to-many pattern. A single user can own many sessions, hold many refresh
tokens, and produce many learned configurations, and each of those records stores the user
identifier that links it back to a single account. In the
same way, a single session can produce many forensic errors, console messages, network
requests, and telemetry events, and each of these supporting records stores the identifier
of the session it belongs to.

Two connections follow different patterns. The relationship between a session and its
forensic telemetry is one-to-one, because each run keeps a single, continually updated
telemetry summary that records the one set of performance and environment measurements for
that run. The brain configurations collection, by contrast, stores both a user identifier
and a session identifier. This double reference creates an indirect many-to-many
relationship, in which one user can build learned memory across many runs, and each run can
capture or reuse the learned intelligence produced by the same user.

This connected structure allows the system to organise, filter, and retrieve historical
testing reports efficiently. When an operator opens the dashboard to view past activity,
the system uses the user identifier to fetch only the sessions owned by that account, which
prevents any operator from reading or changing test data created by another user. When an
operator then selects a particular report, the system uses the session identifier to locate
all of that run's supporting records across the other collections and combines them into a
single, complete diagnostic report for the developer.
