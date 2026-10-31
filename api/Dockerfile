FROM node:22-alpine
ENV NODE_ENV=production TZ=Asia/Bangkok
RUN apk add --no-cache tzdata
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3001/api/health || exit 1
CMD ["node", "src/server.js"]
