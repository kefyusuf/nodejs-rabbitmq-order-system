FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm install

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runner
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY --from=builder /app/prisma ./prisma
# Install only production dependencies (prisma is a runtime dep so migrations
# still work via the entrypoint). This keeps dev tooling out of the image.
RUN npm ci --omit=dev \
  && npx prisma generate
COPY --from=builder /app/dist ./dist
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh \
  && addgroup -S nodejs \
  && adduser -S nodejs -G nodejs \
  && chown -R nodejs:nodejs /app /entrypoint.sh

USER nodejs
EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
