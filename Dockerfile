# syntax=docker/dockerfile:1
# One image, two roles. Web is the default CMD; run the audit worker with
#   docker run ... <image> npm run docker-start-worker
# (see docker-compose.app.yml for both side by side).

# ---- build: full dependency set (vite and prisma are needed to build) -------
FROM node:20-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build
# Drop dev-only packages (vite, eslint, shopify cli...). prisma and tsx are
# regular dependencies, so the migration step and the worker keep working.
RUN npm prune --omit=dev && npm cache clean --force

# ---- runtime ----------------------------------------------------------------
FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl chromium nss freetype harfbuzz ca-certificates ttf-freefont
ENV NODE_ENV=production \
    CHROMIUM_PATH=/usr/bin/chromium-browser \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY --from=build /app/app ./app
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json /app/tsconfig.json ./

EXPOSE 3000

# Web: apply migrations, then serve. The worker role overrides CMD and does not
# run migrations (the web container owns them).
CMD ["npm", "run", "docker-start"]
