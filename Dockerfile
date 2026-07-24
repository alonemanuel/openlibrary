# node:sqlite needs Node 22.5+; no native modules means no build toolchain.
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    OPENLIB_DATA_DIR=/data \
    OPENLIB_SYNC_ROOT=/sync \
    PORT=8787

COPY package.json package-lock.json ./
COPY server/package.json server/
RUN npm ci --omit=dev --workspace server && npm cache clean --force

COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist

# Mount /sync at a folder your Drive, Dropbox or Syncthing client watches, and
# a `local` sync destination lands your CSVs straight into your own storage.
VOLUME ["/data", "/sync"]
EXPOSE 8787

# The server resolves web/dist relative to the working directory.
WORKDIR /app/server
CMD ["node", "dist/index.js"]
