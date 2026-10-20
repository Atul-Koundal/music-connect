FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

# install production dependencies first (better layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# SQLite lives on a volume so data survives container restarts
ENV PORT=3000 DB_PATH=/data/app.db
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
