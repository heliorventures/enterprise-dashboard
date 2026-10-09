FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY --chown=node:node src ./src
COPY --chown=node:node migrations ./migrations
RUN mkdir -p /app/storage/imports && chown -R node:node /app/storage
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
