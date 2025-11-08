# Backend Dockerfile
FROM node:20-slim

# Install dependencies for native modules
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    openssl \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and Prisma schema
COPY package*.json ./
COPY prisma ./prisma

# Install ALL dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Remove devDependencies to reduce image size
RUN npm prune --production

# Now set NODE_ENV to production for runtime
ENV NODE_ENV=production

# Create uploads directory
RUN mkdir -p uploads

# Expose port (Render injects PORT at runtime; defaults to 4000 for local use)
EXPOSE 4000

# Add health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["CMD-SHELL", "curl -fsS http://localhost:${PORT:-4000}/health || exit 1"]

# Run migrations before starting the app (safe to run on every boot)
CMD ["sh", "-c", "npm run migrate && npm start"]
