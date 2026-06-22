version: '3.8'

services:
  stdout:
    image: charlieseay/stdout:latest
    container_name: stdout
    hostname: stdout
    ports:
      - "8112:3000"
    environment:
      - TZ=America/Chicago
      - NODE_ENV=production
      - DB_PATH=/data/stdout.db
      - ADMIN_EMAIL={{ADMIN_EMAIL}}
      - ADMIN_PASSWORD={{ADMIN_PASSWORD}}
      - WINDLASS_URL=http://windlass:8116
      - SENTINEL_API_URL=http://observatory-sentinel:5683
      - OLLAMA_URL=http://stdout-ollama:11434
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
    image: charlieseay/windlass:latest
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

  # Observatory: AI-powered log analysis and anomaly detection
  ollama:
    image: ollama/ollama:latest
    container_name: stdout-ollama
    ports:
      - "11434:11434"
    environment:
      - TZ=America/Chicago
    volumes:
      - ollama-data:/root/.ollama
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:11434/api/tags"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
    restart: unless-stopped

  observatory-sentinel:
    image: charlieseay/observatory-sentinel:latest
    container_name: observatory-sentinel
    ports:
      - "5683:5683"
    environment:
      - TZ=America/Chicago
      - OLLAMA_HOST=http://ollama:11434
      - STDOUT_API_URL=http://stdout:3000
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - observatory-data:/data
    depends_on:
      - ollama
      - stdout
    restart: unless-stopped

volumes:
  stdout-data:
  ollama-data:
  observatory-data:
