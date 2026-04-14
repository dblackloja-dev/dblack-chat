FROM node:22-slim

# Instala fontes para o cupom de venda (@napi-rs/canvas precisa de fontes no sistema)
RUN apt-get update && apt-get install -y fontconfig fonts-dejavu-core && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/package*.json ./
RUN npm install

COPY backend/ ./

EXPOSE 3002

CMD ["node", "server.js"]
