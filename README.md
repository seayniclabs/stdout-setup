# StdOut Setup Server

Home Assistant-style installation server for StdOut. Provides a visual, guided setup experience with real-time progress tracking.

## What This Does

This is an ephemeral setup server that:
1. Runs on port 8888 during installation
2. Serves a visual wizard UI at `http://stdout.local:8888`
3. Orchestrates Docker container deployment
4. Streams real-time progress to the browser
5. Self-destructs after installation completes

## Architecture

```
Browser (http://stdout.local:8888)
    ↓ SSE (Server-Sent Events)
Setup Server (Express + Node.js)
    ↓ execFile (secure command execution)
Docker Daemon (on host)
    ↓ creates
StdOut Stack (stdout + windlass containers)
```

## Installation Steps

The installer performs 8 steps:

1. **Generate Configuration** — Creates docker-compose.yml from template
2. **Pull Docker Images** — Downloads stdout and windlass images from GitHub Container Registry
3. **Start Containers** — Launches containers with docker-compose
4. **Wait for Health Checks** — Polls until containers are healthy
5. **Initialize Database** — Runs migrations to create schema
6. **Create Admin Account** — Creates first user with provided credentials
7. **Configure Environment** — Sets environment name
8. **Finalize Installation** — Marks installation complete and runs final health check

## Security

- **No command injection**: Uses `execFile` with argument arrays, not shell strings
- **No XSS**: DOM manipulation uses `textContent`, not `innerHTML`
- **Input validation**: Email and password validated before submission
- **Ephemeral**: Setup server is removed after installation

## Local Development

```bash
npm install
npm run dev
```

Server runs on http://localhost:8888

## Building Docker Image

```bash
docker build -t ghcr.io/seayniclabs/stdout-setup:latest .
docker push ghcr.io/seayniclabs/stdout-setup:latest
```

## Usage

This container is typically started by the `install.sh` script:

```bash
docker run -d \
  --name stdout-setup \
  --hostname stdout \
  --restart unless-stopped \
  -p 8888:8888 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v $(pwd)/stdout-data:/workspace \
  ghcr.io/seayniclabs/stdout-setup:latest
```

## Files

- `server.js` — Express server with SSE endpoint
- `installer.js` — Installation orchestrator (8 steps)
- `templates/docker-compose.yml.tpl` — Template for StdOut stack
- `public/index.html` — Setup wizard UI
- `public/setup.js` — SSE client and progress rendering
- `public/styles.css` — Visual styling

## Environment Variables

None required — all configuration comes from the browser form.

## Self-Destruct

After installation completes, the container automatically runs:

```bash
docker stop stdout-setup
docker rm stdout-setup
```

This happens 10 seconds after the completion message is sent to the browser.

## License

MIT
