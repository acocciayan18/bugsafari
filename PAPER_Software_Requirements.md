# Software Requirements

## What this covers

Everything needed to build, run and deploy BugSafari. The version numbers below are the
ones the project actually declares in its package files, not general recommendations.

The list is split into three parts: what a developer needs on their own machine, what the
server needs, and the outside services the system talks to.

## Development machine

| Item | Requirement | Note |
| --- | --- | --- |
| Operating system | Windows 10 or 11, macOS 12 or later, or a recent Linux | Development is done on Windows in this project |
| Node.js | `^20.19.0` or `>=22.12.0` | Declared in the root package file; older versions will not build |
| npm | Version 10 or later | The project uses npm workspaces, so a single install at the root covers all three packages |
| Git | Any recent version | For cloning and version control |
| Code editor | Visual Studio Code recommended | The project ships TypeScript settings that the editor picks up |
| Web browser | Chrome, Edge or Firefox, current version | To open the dashboard at `localhost:5173` |
| Database access | A free MongoDB Atlas account | There is no local MongoDB container; the connection string points at Atlas |

## Frontend libraries

| Library | Version | Used for |
| --- | --- | --- |
| React | 19.2 | The dashboard interface |
| Vite | 8.0 | Development server and production build |
| TypeScript | 5.7 | Type checking on the dashboard |
| React Router | 7.11 | Page routing inside the dashboard |
| Zustand | 5.0 | Application state, in place of Redux |
| Tailwind CSS | 4.2 | Styling |
| socket.io-client | 4.8 | Receiving the live run stream |
| Framer Motion | 12.43 | Screen transitions and loading states |
| GSAP and OGL | 3.15 and 1.0 | Animated visuals on the landing page |
| DOMPurify | 3.4 | Cleaning any text that comes from the tested page before it is displayed |
| Lucide React | 0.542 | Icons |
| Sonner | 2.0 | Toast notifications |

## Backend libraries

| Library | Version | Used for |
| --- | --- | --- |
| TypeScript | 5.8 | Type checking on the backend |
| Express | 5.2 | The REST API |
| Socket.IO | 4.8 | Pushing live results to the dashboard |
| Playwright | 1.60 | Driving a real Chromium browser against the tested site |
| Mongoose | 8.24 | Talking to MongoDB |
| jsonwebtoken | 9.0 | Signing and checking sign-in tokens |
| bcryptjs | 2.4 | Hashing passwords |
| BullMQ | 5.78 | The job queue that lets several runs happen at once |
| ioredis | 5.10 | The Redis client BullMQ uses |
| Nodemailer | 9.0 | Sending password reset email |
| dotenv | 17.4 | Reading configuration from environment files |

## Server deployment

| Item | Requirement | Note |
| --- | --- | --- |
| Operating system | Ubuntu 22.04 or similar Linux | The deployment target is a DigitalOcean droplet |
| Container runtime | Podman or Docker, with compose support | Two compose files exist, one for local use and one for production |
| Base container image | `mcr.microsoft.com/playwright:v1.60.0-jammy` | Ships Chromium and all its system libraries already installed, which is why it is used instead of a plain Node image |
| Redis | Latest stable, `redis:alpine` image | Holds the run queue and the cross process event bridge |
| Reverse proxy | Caddy, latest stable | Handles HTTPS certificates and forwards traffic to port 3000 |
| Database | MongoDB Atlas | Managed, not run in a container |
| Frontend hosting | Any static host; Vercel is used here | The dashboard builds to plain files, so it does not need a Node server |

## External services

| Service | Required? | What happens without it |
| --- | --- | --- |
| MongoDB Atlas | Yes | Nothing can be saved. Runs still work but no history is kept |
| Google Gemini API | No | The system answers fix requests from a built-in catalog of known bug types instead. Everything else is unaffected |
| SMTP mail server | No | Password reset email cannot be delivered. All other account features still work |
| Redis | Only for concurrent runs | Without it, the API runs the test in its own process, one at a time |

## Ports

| Port | Used by |
| --- | --- |
| 5173 | The dashboard development server |
| 3000 | The REST API and the live stream, both on the same port |
| 6379 | Redis |
| 27017 | MongoDB, when a local instance is used instead of Atlas |
| 80 and 443 | The reverse proxy in production |

## Configuration

Settings are read from environment files rather than hard coded. The ones that must be
set are the MongoDB connection string, the secret used to sign tokens, and the key used
to encrypt any credentials the tester supplies for a site that needs a login. The rest,
including the AI and email settings, the step and timeout limits, and the worker count,
have working defaults.

## Testing and build tools

Tests are written as plain TypeScript files that assert with Node's own `assert` module
and are run by a small script in each package. There is no test framework to install.
Playwright's own test runner is available for browser level tests, and ESLint checks the
dashboard code.
