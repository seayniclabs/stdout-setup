FROM node:20-alpine

WORKDIR /app

# Install Docker CLI and docker-compose (to control host Docker via socket)
RUN apk add --no-cache docker-cli docker-compose curl

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy application
COPY . .

EXPOSE 8888

HEALTHCHECK --interval=5s --timeout=3s --retries=3 \
  CMD curl -f http://localhost:8888/health || exit 1

CMD ["node", "server.js"]
