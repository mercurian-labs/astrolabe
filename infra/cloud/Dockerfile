# The migration task's image. The context is dist/migrate after `vp run build`: the
# bundled migrator plus migrations/. The API is Alchemy-hosted (src/Api.ts).
FROM node:24-slim
WORKDIR /app
COPY . .
USER node
CMD ["node", "migrate.mjs"]
