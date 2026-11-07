# Las etapas de build y de dependencias corren en la plataforma del runner ($BUILDPLATFORM): el resultado (dist/ y un
# node_modules sin módulos nativos) sirve igual para amd64 y arm64. Así Node nunca corre emulado con QEMU, que en arm64
# muere con "Illegal instruction" durante npm install.
FROM --platform=$BUILDPLATFORM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM --platform=$BUILDPLATFORM node:20-alpine AS deps
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

RUN addgroup -S kyc && adduser -S kyc -G kyc
USER kyc

EXPOSE 8080
CMD ["node", "dist/server.js"]
