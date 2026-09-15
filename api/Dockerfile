FROM node:22-alpine

# poppler-utils (pdftoppm): renders PDF pages to images for F1.7's vision-only statement
# extraction pipeline (decision: see planning/F1.7 - Statement Upload - Brainstorm.md).
RUN apk add --no-cache poppler-utils

WORKDIR /app

COPY package.json package-lock.json ./
COPY api/package.json api/package.json
COPY web/package.json web/package.json
RUN npm ci

COPY . .

WORKDIR /app/api
EXPOSE 3000

CMD ["npm", "run", "dev"]
