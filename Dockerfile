# Run API and native ES-module frontend from one same-origin Node process.
FROM node:20-alpine AS runtime
WORKDIR /app

ARG SOURCE_COMMIT=dev
ENV APP_VERSION=$SOURCE_COMMIT
RUN apk add --no-cache wget

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

COPY package.json ./
COPY server ./server
COPY src ./src
COPY public ./public
COPY index.html vite.config.js google-apps-script.js ./

EXPOSE 3000
CMD ["node", "server/index.js"]
