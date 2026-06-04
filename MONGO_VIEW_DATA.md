# Viewing BugSafari Table Data in MongoDB Compass

This guide explains how to view your BugSafari database table data using MongoDB Compass. Follow these steps to resolve port conflicts and connect to your containerized MongoDB instance.

## Step-by-Step Fix to See Your Table Data

### Step 1: Kill the Laptop's Native Database Service

You need to free up port 27017 so your container can stream out to your desktop tools.

**On Windows:** Open your Start Menu, search for Services, locate MongoDB Server, right-click it, and choose Stop.



### Step 2: Clean and Rebuild the Stack Cluster

Force the containers to reclaim port 27017 completely:

**Windows PowerShell:**

```powershell
# Bring down the active instances safely
podman compose -f docker-compose.local.yml down

# Clear out any stuck sockets and spin the stack back up freshly
podman compose -f docker-compose.local.yml up -d
```



> **Note:** If using standard Docker instead of Podman, replace `podman` with `docker` in the commands above.

### Step 3: Open MongoDB Compass

1. Click **New Connection**.
2. Paste this precise string targeting your app namespace:

```
mongodb://localhost:27017/bugsafari
```

3. Hit **Connect**.

You will instantly see the custom `bugsafari` database reveal itself with your full user table right inside the panel dashboard views!

## Additional Instructions

### Checking Port Availability Before Starting

Before starting the stack, verify that port 27017 is not in use by another process:

**Windows PowerShell:**

```powershell
Get-NetTCPConnection -LocalPort 27017 -ErrorAction SilentlyContinue
```


If something is using the port, identify and stop the process before proceeding.

### Verifying MongoDB Container Is Running

Confirm the MongoDB container is healthy and running:

**Windows PowerShell:**

```powershell
docker compose -f docker-compose.local.yml ps mongodb
```



Expected result: `bugsafari-mongodb` should show as "healthy" in the status.

### Accessing Database via Command Line

If you prefer command-line access or Compass isn't working, you can inspect the database directly:

**Access the MongoDB shell inside the container:**

```powershell
docker compose -f docker-compose.local.yml exec mongodb mongosh "mongodb://localhost:27017/bugsafari"
```


**List all databases:**

```
show dbs
```

**Switch to bugsafari database:**

```
use bugsafari
```

**List all collections:**

```
show collections
```

**View all documents in a collection (e.g., users):**

```
db.users.find()
```

**View collection statistics:**

```
db.users.stats()
```

### Troubleshooting Common Issues

| Issue | Solution |
| --- | --- |
| Port 27017 already in use | Stop the local MongoDB service (Step 1) or identify and kill the conflicting process |
| Connection timeout | Ensure the container is running: `docker compose -f docker-compose.local.yml ps` |
| Authentication error | Check credentials in your environment or try connecting without auth |
| Empty database | Run the dashboard at least once to create initial data |
| Container keeps restarting | Check logs: `docker compose -f docker-compose.local.yml logs mongodb` |

### Viewing Data Without MongoDB Compass

If you don't have MongoDB Compass installed, you can use the included MongoDB shell:

```powershell
docker compose -f docker-compose.local.yml exec mongodb mongosh --quiet --eval "db.adminCommand('listDatabases')"
```

```bash
docker compose -f docker-compose.local.yml exec mongodb mongosh --quiet --eval "db.adminCommand('listDatabases')"
```

This will list all databases, including `bugsafari`.

## Quick Reference

| Item | Value |
| --- | --- |
| Connection URI | `mongodb://localhost:27017/bugsafari` |
| MongoDB Host Port | `27017` |
| Container Name | `bugsafari-mongodb` |
| Database Name | `bugsafari` |
| Docker Compose File | `docker-compose.local.yml` |
