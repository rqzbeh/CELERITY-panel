# Hysteria Backend - Docker Image
FROM node:20-alpine

WORKDIR /app

# Устанавливаем системные зависимости (mongodump для бэкапов)
RUN apk add --no-cache mongodb-tools

# Копируем зависимости
COPY package*.json ./

# Устанавливаем зависимости
RUN npm install --omit=dev

# Копируем исходники
COPY . .

# Создаём директории для логов и бэкапов
RUN mkdir -p logs backups && \
    chmod -R 755 backups

# Порты
EXPOSE 3000 8444

# Запуск
CMD ["node", "index.js"]
