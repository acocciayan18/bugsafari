# Implementation Plan: Docker Compose MongoDB Atlas Migration

[Overview]
Migrate the Docker Compose orchestration from local MongoDB container dependency to cloud-managed MongoDB Atlas, removing any remaining local database container references and configuring environment variables properly.

[Context]
The current `docker-compose.local.yml` file already has the MongoDB service removed, but the environment configuration uses object-style format. The user requires array-style environment variables to properly receive the `${MONGODB_URI}` from the host context. This fix ensures the `bugsafari-api` and `bugsafari-worker` services can boot without waiting for a local MongoDB container and will connect to MongoDB Atlas using the provided connection string.

[Types]
YAML configuration changes for Docker Compose services.

[Files]
- **Modified**: `docker-compose.local.yml`
  - Convert `api` service environment from object-style to array-style
  - Convert `worker` service environment from object-style to array-style
  - Ensure proper PORT and MONGODB_URI variables in array format
  - Verify no mongodb dependencies exist in depends_on blocks

[Environment Variable Changes]
Current object-style format:
```yaml
environment:
  NODE_ENV: development
  MONGODB_URI: ${MONGODB_URI}
```

Target array-style format:
```yaml
environment:
  - MONGODB_URI=${MONGODB_URI}
  - NODE_ENV=development
  - PORT=3000
```

[Implementation Order]
1. Modify `docker-compose.local.yml`:
   - Update `api` service environment to array-style format
   - Update `worker` service environment to array-style format
   - Ensure MONGODB_URI, NODE_ENV, and PORT are all properly defined
2. Verify configuration syntax with docker-compose config

[Testing]
After applying changes:
1. Run `docker-compose -f docker-compose.local.yml config` to validate YAML syntax
2. Verify the services can start without MongoDB container dependency
3. Confirm API connects to Atlas using the environment variable
