# Servidor de llenado + Claude Code (CLI). Imagen autocontenida para Railway.
FROM node:22-bookworm-slim

# poppler-utils: Claude Code lo usa para leer PDF por páginas. ca-certificates: TLS hacia Anthropic.
RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Claude Code. Para fijar una versión estable: --build-arg CLAUDE_CODE_VERSION=2.1.299
ARG CLAUDE_CODE_VERSION=latest
RUN npm install -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && npm cache clean --force

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
# Código de Excel de la plataforma empaquetado para Node (tools/excel-node → npm run build); se commitea ya generado.
COPY vendor ./vendor
COPY scripts ./scripts
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# El usuario "node" (uid 1000) ejecuta el servidor y Claude Code. HOME propio para ~/.claude.
# hasCompletedOnboarding evita el asistente de primer uso al autenticarse solo con CLAUDE_CODE_OAUTH_TOKEN.
RUN mkdir -p /home/node/.claude \
 && echo '{"hasCompletedOnboarding":true}' > /home/node/.claude.json \
 && chown -R node:node /home/node /app

ENV NODE_ENV=production \
    HOME=/home/node \
    DISABLE_AUTOUPDATER=1 \
    DATA_DIR=/data \
    RETENCION_DIAS=2

EXPOSE 8080
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "src/index.js"]
