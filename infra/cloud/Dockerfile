# The context is dist/ after `vp run build`: the bundles plus migrations/.
FROM node:24-slim
WORKDIR /app
COPY . .
USER node
CMD ["node", "server.mjs"]
