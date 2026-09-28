# Dashboard tático P&D — imagem para o Cloud Run
FROM node:22-slim
ENV NODE_ENV=production PORT=8080 TZ=America/Sao_Paulo
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY web ./web
# foto de dados do mock: usada só no modo demonstração (NOTION_MODE=fixture)
COPY docs/mock ./docs/mock
USER node
EXPOSE 8080
CMD ["node", "server/index.js"]
