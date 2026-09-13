FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY api/package.json api/package.json
COPY web/package.json web/package.json
RUN npm ci

COPY . .

WORKDIR /app/api
EXPOSE 3000

CMD ["npm", "run", "dev"]
