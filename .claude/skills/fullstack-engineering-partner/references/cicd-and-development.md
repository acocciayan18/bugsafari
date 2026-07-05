# CI/CD & Deployment
 
Use this when preparing code for production, writing Dockerfiles, or setting up/editing CI/CD pipelines. Adapt specifics to whatever platform the project already uses (GitHub Actions, GitLab CI, CircleCI, etc.) or ask which one if none exists yet.
 
## Dockerfiles
 
- Use multi-stage builds to keep the final image small: build/compile in one stage with full toolchain, copy only the built artifact into a slim runtime stage.
- Pin base image versions (avoid bare `latest`) so builds are reproducible and don't silently change behavior on rebuild.
- Run the application as a non-root user in the final image rather than the default root — a container escape or RCE is much worse if it lands with root inside the container.
- Order layers to maximize cache hits: copy dependency manifests (`package.json`/`requirements.txt`/etc.) and install dependencies before copying the rest of the source, so code changes don't invalidate the dependency-install layer.
- Don't bake secrets or `.env` files into the image — inject them at runtime via environment variables or a secrets manager; anything baked into a layer persists in the image history even if a later layer "removes" it.
- Include a `.dockerignore` covering `node_modules`, `.git`, local env files, and build artifacts that shouldn't be copied into the build context.
## CI pipeline structure
 
A reasonable default pipeline, roughly in order (fail fast — put cheap/fast checks first):
 
1. Install dependencies (cached where possible)
2. Lint/format check
3. Type-check (if applicable)
4. Unit tests
5. Build
6. Integration tests (often need a real or containerized dependency like a test DB)
7. Security/dependency scan
8. (On merge to main/release branch) Deploy
Keep the pipeline fast enough that people don't start ignoring it — parallelize independent steps (lint and unit tests don't depend on each other), and cache dependency installation and build artifacts between runs.
 
## Environment & configuration management
 
- Configuration that differs between environments (DB URLs, API keys, feature flags) should come from environment variables or a config service — never hardcoded per-environment in source.
- Keep an example config file (`.env.example`) checked in showing required variables without real values, so setting up a new environment doesn't require reverse-engineering the codebase for what's needed.
- Fail fast and loudly at startup if required configuration is missing, rather than failing confusingly later at the point of first use.
## Deployment safety
 
- Prefer deployment strategies that allow rollback without a rebuild (blue-green, rolling deploy with health checks, canary) over a hard cutover, especially for anything user-facing.
- Health check endpoints should verify real dependencies (DB connectivity, critical downstream services) are reachable, not just "the process is running" — a process can be up while its DB connection pool is exhausted.
- Database migrations that run as part of a deploy should be backward-compatible with the *previous* version of the app code for the duration of a rolling deploy (see `database-and-migrations.md`), since old and new instances may briefly run side by side.
- Document (briefly) the rollback procedure for anything non-trivial being deployed — if it's just "redeploy the previous image tag," say so; if it needs a compensating migration or manual step, spell that out before it's needed under pressure.
## What to include when asked for "deployment instructions"
 
A short, concrete runbook beats an exhaustive one: what to build, what environment variables must be set, the exact deploy command/pipeline trigger, how to verify it worked (a health check URL, a smoke test), and how to roll back if it didn't.