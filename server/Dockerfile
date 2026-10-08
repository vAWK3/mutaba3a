# Mutaba3a API — Cloud Run images. Multi-stage, non-root, health-checked.
#
# Two targets come out of one build (see scripts/deploy.sh and cloudbuild.yaml):
#   --target runtime   the API service (default; production dependencies only)
#   --target migrate   the Cloud Run job that runs `prisma migrate deploy`
#
# The migrate target exists because the Prisma CLI is a devDependency: after
# `npm prune --omit=dev` the runtime image cannot run migrations, and it must
# not — migrations run as a separate job before each service rollout, never at
# container start (ADR-025 §9).

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma
RUN npx prisma generate

FROM deps AS builder
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---------------------------------------------------------------------------
# Migration job image: full dependency tree (Prisma CLI included), no app code.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS migrate
ENV NODE_ENV=production
WORKDIR /app
# Prisma's query/schema engines link against OpenSSL 3 on musl.
RUN apk add --no-cache openssl
COPY --from=deps /app/package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
USER node
CMD ["node_modules/.bin/prisma", "migrate", "deploy"]

# ---------------------------------------------------------------------------
# Service image.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT:-8787}/health || exit 1
CMD ["node", "dist/index.js"]
