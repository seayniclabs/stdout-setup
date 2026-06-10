version: '3.8'

services:
  stdout:
    image: ghcr.io/charlieseay/stdout:latest
    container_name: stdout
    hostname: stdout
    ports:
      - "8112:3000"
    environment:
      - TZ=America/Chicago
      - NODE_ENV=production
      - DATABASE_PATH=/data/central.db
    volumes:
      - stdout-data:/data
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/healthz"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 30s
    restart: unless-stopped

  windlass:
    image: ghcr.io/charlieseay/windlass:latest
    container_name: windlass
    ports:
      - "8116:8116"
    environment:
      - TZ=America/Chicago
      - STDOUT_API_URL=http://stdout:3000
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8116/health"]
      interval: 10s
      timeout: 5s
      retries: 3
      start_period: 30s
    restart: unless-stopped

volumes:
  stdout-data:
