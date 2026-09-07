# ---- Build stage ----
FROM node:22-alpine AS build

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build
RUN npm prune --omit=dev

# ---- Production stage ----
FROM node:22-alpine AS production

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8088

COPY package.json package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY server ./server

EXPOSE 8088
VOLUME ["/app/.data"]

CMD ["node", "server/index.mjs"]
