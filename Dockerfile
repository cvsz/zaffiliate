FROM node:22-alpine AS web-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY apps/web ./apps/web
COPY vite.config.js ./vite.config.js
RUN npm run build:web && \
    test -s apps/web/dist/web/index.html && \
    test -d apps/web/dist/web/assets && \
    ! grep -q '/src/main.jsx' apps/web/dist/web/index.html

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY apps ./apps
COPY packages ./packages
COPY db ./db
COPY --from=web-build --chown=node:node /app/apps/web/dist/web ./apps/web/dist/web
USER node
EXPOSE 8080
CMD ["node", "apps/api/src/production-server.js"]
