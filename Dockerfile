FROM node:22-slim

# Fontes para o cupom (@napi-rs/canvas) + ffmpeg para converter áudio/vídeo ao formato do WhatsApp
RUN apt-get update && apt-get install -y fontconfig fonts-dejavu-core ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY backend/package*.json ./
RUN npm install

COPY backend/ ./

EXPOSE 3002

CMD ["node", "server.js"]
