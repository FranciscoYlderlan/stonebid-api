# Node LTS em imagem slim (Debian). Troque a versão aqui quando subir o LTS.
ARG NODE_VERSION=24

# ---------- build: dependências completas, Prisma Client e bundle ----------
FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app

# openssl: exigido pelo schema engine do Prisma (migrate deploy)
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# O postinstall roda `prisma generate` (e baixa o schema engine), que precisa do schema e do config.
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig.json tsup.config.ts ./
COPY src ./src
RUN npm run build \
  && npm prune --omit=dev

# ---------- runtime: só dependências de produção ----------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime
WORKDIR /app

RUN apt-get update -y && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3333

# node_modules de produção (inclui o CLI prisma, o schema engine e o tsx do seed),
# o bundle, e prisma/ + src/ para `prisma migrate deploy` e `npm run db:seed`
# (o mesmo contêiner roda o Cloud Run Job de migração e seed).
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json /app/prisma.config.ts ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/dist ./dist

USER node
EXPOSE 3333

HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3333)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Só o servidor. Migração e seed rodam fora do start (pipeline / serviço migrate do Compose).
CMD ["npm", "run", "start:prod"]
