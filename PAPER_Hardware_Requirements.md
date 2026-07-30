# Hardware Requirements

## What this covers

The hardware needed to develop BugSafari and the hardware needed to run it as a service.
The two are different, so they are listed separately.

One thing drives almost all of these numbers: every test run opens a real Chromium
browser. That browser, not the application code, is what uses the memory.

## Development machine

| Item | Minimum | Recommended |
| --- | --- | --- |
| Processor | 4 cores, 2.0 GHz | 6 or more cores |
| Memory | 8 GB | 16 GB |
| Storage | 5 GB free | 10 GB free, on an SSD |
| Display | 1366 by 768 | 1920 by 1080 |
| Network | Any stable broadband connection | Same |

Notes on these numbers:

- The 8 GB minimum assumes the editor, the dashboard development server, the backend and
  one Chromium test browser are open at once. With 8 GB it works but the machine is busy.
- The 5 GB of storage is mostly the installed packages and the browser binaries
  Playwright downloads, which are around 1 GB on their own.
- A network connection is not optional. The database is hosted on MongoDB Atlas and the
  site being tested is usually remote, so BugSafari cannot be developed fully offline.

## Server deployment

| Item | Minimum | Recommended |
| --- | --- | --- |
| Processor | 2 virtual cores | 4 virtual cores |
| Memory | 4 GB | 8 GB |
| Storage | 25 GB SSD | 50 GB SSD |
| Network | 1 TB monthly transfer | Same |

The 4 GB minimum covers the API process, two test workers and Redis on the same machine.
Each container is limited to 1 GB in the production configuration, and one Chromium run
uses roughly 700 MB to 1.5 GB depending on how heavy the tested page is.

The database is not counted here. MongoDB Atlas runs on its own infrastructure, so the
server only needs to hold the application and the browsers.

## Scaling rule

One worker process runs one test at a time. That limit is deliberate: run state is held in
memory during a run and is not isolated between runs inside a single process.

So the rule is simple:

| Tests running at the same time | Workers needed | Extra memory needed |
| --- | --- | --- |
| 1 | 1 | about 1.5 GB |
| 2 | 2 | about 3 GB |
| 4 | 4 | about 6 GB |

Add the API process and Redis, roughly 1 GB together, on top of that. To support more
testers, add memory and worker replicas rather than tuning the engine.

## Why the browser dominates

The engine itself is light. It parses the page, scores a list of elements, and updates a
small set of weights, all of which run in milliseconds and use very little memory. The
cost sits entirely in Chromium, which has to load the tested site, run its scripts, render
it, and hold the page in memory while the run continues.

This means the hardware requirement scales with the number of tests running at once, not
with how long each test runs or how many bugs it finds.
