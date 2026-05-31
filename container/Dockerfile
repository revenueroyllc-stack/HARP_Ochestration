# H.A.R.P.™ — Container image.
#
# Houses a single provider behind an mTLS HTTPS server. The provider lives and
# works only inside this image; the core and concierge never see it.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
COPY container ./container
# Build both shared contracts and the container code.
RUN npx tsc -p tsconfig.json

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Copy only what the container needs to run.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

# Runs as non-root for safety.
USER node

# Internal network port; not published to the host by default.
EXPOSE 8443

# Certs are mounted at runtime (read-only); secrets injected via env/secrets.
CMD ["node", "dist/container/src/index.js"]
