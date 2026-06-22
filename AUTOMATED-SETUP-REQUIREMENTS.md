# StdOut Automated Setup - Complete Requirements

## What MUST Happen on First Installation (Zero Manual Steps)

### 1. Container Deployment ✅
- **stdout** container running on :8112
- **windlass** container running on :8116  
- **stdout-ollama** container running on :11434
- **observatory-sentinel** container running on :5683

### 2. License Validation ✅
- Ed25519 signed license validated offline
- License stored in database
- No "trial mode" - license is REQUIRED

### 3. Observatory Auto-Configuration ⚠️
- **MUST**: Ollama container pulls `llama3.2:3b-instruct-q4_K_M` model automatically
- **MUST**: Observatory Sentinel connects to Ollama (via OLLAMA_URL env var)
- **MUST**: Observatory Sentinel connects to StdOut API (via SENTINEL_API_URL env var)
- **MUST**: Observatory starts in "discover" mode
- **MUST**: Initial watch queues activated

### 4. Windlass Auto-Sync ⚠️
- **MUST**: Windlass endpoint auto-configured in database
- **MUST**: Initial sync performed automatically (not manual button click)
- **MUST**: Service registry populated from Windlass
- **MUST**: Dashboard shows services, not "No services synced yet"

### 5. Network Scanner & Discovery ❌ NOT WORKING
- **MUST**: Scanner API token auto-created on install
- **MUST**: Initial network scan triggered immediately (not just scheduled)
- **MUST**: Hosts discovered and added to database
- **MUST**: Monitors auto-created from discovered services
- **MUST**: Dashboard shows discovered infrastructure

### 6. Onboarding Dismissal ✅
- `onboarding_dismissed = 1` in tenant_preferences
- All 8 setup steps marked complete in setup_progress
- No "Getting Started" checklist visible on dashboard

---

## Required Environment Variables

**stdout container** in docker-compose.yml:
```yaml
environment:
  - ADMIN_EMAIL={{ADMIN_EMAIL}}          # From install form
  - ADMIN_PASSWORD={{ADMIN_PASSWORD}}    # From install form
  - WINDLASS_URL=http://windlass:8116   # Auto-sync trigger
  - SENTINEL_API_URL=http://observatory-sentinel:5683  # Observatory wiring
  - OLLAMA_URL=http://stdout-ollama:11434  # LLM endpoint
```

---

## Automation Scripts (Execution Order)

### 1. init-setup.sh (runs on container start)
Location: `/app/scripts/init-setup.sh`

Responsibilities:
- Creates admin user from ADMIN_EMAIL/ADMIN_PASSWORD
- Calls `bootstrap-unattended.js` to mark setup complete
- Calls `create-windlass-config-from-env.js` if WINDLASS_URL set
- Checks Observatory Sentinel availability

### 2. bootstrap-unattended.js (called by init-setup.sh)
Location: `/app/scripts/bootstrap-unattended.js`

Responsibilities:
- Marks all 8 setup_progress steps as completed
- Sets system_state.installation_complete = true
- Idempotent (safe to run multiple times)

### 3. mark-installation-complete.js (step 8 of installer)
Location: `/app/scripts/mark-installation-complete.js`

**CURRENT**: Only dismisses onboarding
**MUST DO**:
- Create scanner API token
- Trigger immediate network scan (not just schedule)
- Sync Windlass services
- Pull Ollama model
- Configure Observatory watches

---

## Missing Automation (TO FIX)

### Issue 1: Ollama Model Not Downloaded
**Current**: Step 8 triggers `ollama pull llama3.2` in background but doesn't wait
**Fix Needed**: 
- Add synchronous model pull to step 8
- Show progress: "Downloading AI model (1.9GB)..."
- Don't complete until model ready

### Issue 2: Scanner Doesn't Auto-Run
**Current**: Creates schedule but doesn't trigger scan
**Fix Needed**:
- `mark-installation-complete.js` should call scanner immediately
- Create scan_imports row with discovered hosts
- Auto-create monitors from scan results

### Issue 3: Windlass Not Auto-Synced
**Current**: Config created but no sync happens
**Fix Needed**:
- Call Windlass `/sync` endpoint from mark-installation-complete.js
- Wait for sync to complete
- Populate service registry

### Issue 4: Observatory Not Wired
**Current**: Containers run but don't communicate
**Fix Needed**:
- Ensure SENTINEL_API_URL env var reaches runtime
- Observatory Sentinel needs restart after stdout ready
- Verify `/health` endpoints before marking complete

---

## Validation Commands

```bash
# 1. Check all containers running
docker ps --format "table {{.Names}}\t{{.Status}}"
# Expected: stdout, windlass, stdout-ollama, observatory-sentinel all "Up"

# 2. Check Ollama model downloaded
docker exec stdout-ollama ollama list
# Expected: llama3.2:3b-instruct-q4_K_M present

# 3. Check Windlass config exists
docker exec stdout sqlite3 /data/stdout.db "SELECT endpoint_url FROM windlass_config"
# Expected: http://windlass:8116

# 4. Check scanner token created  
docker exec stdout sqlite3 /data/stdout.db "SELECT name FROM api_tokens WHERE name='Scanner'"
# Expected: Scanner

# 5. Check scan was triggered
docker exec stdout sqlite3 /data/stdout.db "SELECT COUNT(*) FROM satellites"
# Expected: > 0 (discovered hosts)

# 6. Check monitors created
docker exec stdout sqlite3 /data/stdout.db "SELECT COUNT(*) FROM monitors"  
# Expected: > 0 (auto-created from discovery)

# 7. Check onboarding dismissed
docker exec stdout sqlite3 /data/stdout.db "SELECT onboarding_dismissed FROM tenant_preferences"
# Expected: 1
```

---

## Test License

Valid Ed25519 signed license:
```
SL-eyJlIjoidGVzdC11c2VyQGV4YW1wbGUuY29tIiwiaSI6MTc4MjE2NzAxMSwibSI6OTl9.lOVS2tnBY8Wj4sFdcX5mrMk6cFcTGqLEyArn-oLtl4P9z3olP9p1yYtJxMIcK_2k0qIteFpNvC9dloRj16siAw
```
- Email: test-user@example.com
- Password: password123
- Max activations: 99
- Expires: Never

---

## Success Criteria

Installation is ONLY complete when:
1. ✅ All 4 containers running and healthy
2. ✅ License validated and stored
3. ⚠️ Ollama model downloaded and ready
4. ⚠️ Windlass synced with services visible on dashboard
5. ❌ Network scan completed with hosts discovered
6. ❌ Monitors auto-created and showing on HUD
7. ✅ Observatory wired and watching
8. ✅ Onboarding dismissed (no manual checklist)

**Current State**: 4/8 automated (50%)
**Target**: 8/8 automated (100%)
