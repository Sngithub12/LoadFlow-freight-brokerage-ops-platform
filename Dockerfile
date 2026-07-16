FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /app/data

EXPOSE 3000

CMD ["sh", "-c", "test -f /app/data/loadflow.db || node --experimental-sqlite server/seed.js; node --experimental-sqlite server/server.js"]