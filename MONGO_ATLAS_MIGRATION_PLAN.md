# Implementation Plan

[Overview]
Migrate the Docker Compose orchestration from local MongoDB container to cloud-managed MongoDB Atlas, removing the container dependency that causes startup loop failures.

[Context]
After migrating the persistence layer to MongoDB Atlas, the `docker-compose.local.yml` still references a local `bugsafari-mongodb` container that no longer exists. This causes the cluster startup to fail because the services wait for a container that isn't running. We need to:
1. Remove the local MongoDB container dependency
2. Update environment variables to use Atlas connection string
3. Remove the unused MongoDB service definition

[Types]
YAML configuration changes for Docker Compose services.

[Files]
- **Modified**: `docker-compose.local.yml`
  - Remove entire `mongodb:` service definition (lines 17-41)
  - Remove `mongodb` from `depends_on` in `api` service
  - Remove `mongodb` from `depends_on` in `worker` service
  - Update `MONGODB_URI` environment variable in both services to use Atlas format
- **No Change Needed**: `testing-core/src/infrastructure/database/mongooseClient.ts` - Already correctly uses `process.env.MONGODB_URI` with proper fallback

[Environment Variable Changes]
The current default `mongodb://mongodb:27017/bugsafari` will be replaced with Atlas URI format:
- Format: `mongodb+srv://YOUR_USERNAME:YOUR_PASSWORD@cluster0.xxxx.mongodb.net/bugsafari?retryWrites=true&w=majority`
- The user must replace `YOUR_USERNAME`, `YOUR_PASSWORD`, and `cluster0.xxxx` with their actual Atlas credentials

[Implementation Order]
1. Update `docker-compose.local.yml`:
   - Remove the `mongodb` service block entirely
   - Remove `mongodb` from `api` service's `depends_on` array
   - Remove `mongodb` from `worker` service's `depends_on` array
   - Update `MONGODB_URI` environment variable in both services
2. Remove the unused MongoDB volumes from the `volumes:` section (mongodb-data, mongodb-config)

[Testing]
After applying changes:
1. Run `docker-compose -f docker-compose.local.yml config` to validate syntax
2. Start services with `docker-compose -f docker-compose.local.yml up -d`
3. Verify API connects to Atlas by checking logs for connection success message
