# Production image: builds the client and the bundled server, then ships only what runs.
#   docker build -t tuff .
#   docker run -p 7777:7777 -v tuff-save:/var/lib/tuff tuff
# With PostgreSQL, set DATABASE_URL (see docker-compose.yml).

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# The server bundle includes the shared package; only its native-ish dependencies are installed.
RUN echo '{"name":"tuff-runtime","private":true,"type":"module"}' > package.json \
  && npm install --omit=dev --no-audit --no-fund ws@8 pg@8 \
  && npm cache clean --force \
  && mkdir -p /var/lib/tuff && chown node:node /var/lib/tuff
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
COPY data data
ENV PORT=7777 \
    TUFF_SAVE_DIR=/var/lib/tuff
VOLUME /var/lib/tuff
EXPOSE 7777
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:7777/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server/dist/main.js"]
