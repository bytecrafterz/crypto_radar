# Imagen del Crypto Radar.
# Se compila TypeScript en una fase aparte para que la imagen final
# no lleve las herramientas de desarrollo.

FROM node:22-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---------------------------------------------------------------------------

FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV TZ=Europe/Madrid

# Solo dependencias de produccion.
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY db ./db
COPY config ./config

# Usuario sin privilegios.
RUN addgroup -S radar && adduser -S radar -G radar && chown -R radar:radar /app
USER radar

EXPOSE 3000

HEALTHCHECK --interval=60s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/index.js"]
