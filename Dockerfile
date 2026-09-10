# Build frontend with dev dependencies available.
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

# Run API and the built frontend from one same-origin Node process.
FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache wget
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY public ./public
COPY index.html marketing.html vite.config.js ./
EXPOSE 3000
CMD ["node", "server/index.js"]
