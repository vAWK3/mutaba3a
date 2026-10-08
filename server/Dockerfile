# Mutaba3a API — Cloud Run image. Multi-stage, non-root, health-checked.
#
# Built on the operator's machine by scripts/deploy.sh (docker build
# --platform linux/amd64) and pushed to Artifact Registry; CI builds it to prove
# it still assembles. Migrations are NOT in this image and never run at
# container start: the operator runs `prisma migrate deploy` from server/
# through the Cloud SQL Auth Proxy before each rollout (ADR-025 §9, ADR-026).

FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Prisma's query engine links against OpenSSL 3 on musl.
RUN apk add --no-cache openssl
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/dist ./dist
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT:-8787}/health || exit 1
CMD ["node", "dist/index.js"]
