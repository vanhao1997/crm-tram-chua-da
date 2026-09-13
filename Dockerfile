# Build frontend with dev dependencies available.
FROM node:20-alpine AS build
WORKDIR /app
ARG SOURCE_COMMIT=dev
ENV APP_VERSION=$SOURCE_COMMIT
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

# Run API and built frontend from one same-origin Node process.
FROM node:20-alpine AS runtime
WORKDIR /app
ARG SOURCE_COMMIT=dev
ENV APP_VERSION=$SOURCE_COMMIT
RUN apk add --no-cache wget
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY public ./public
COPY index.html marketing.html settings.html vite.config.js ./
EXPOSE 3000
CMD ["node", "server/index.js"]
