FROM node:22-slim

WORKDIR /app

COPY backend/package*.json ./
RUN npm install

COPY backend/ ./

EXPOSE 3002

CMD ["node", "server.js"]
