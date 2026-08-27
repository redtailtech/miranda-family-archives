FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends poppler-utils libimage-exiftool-perl openssl \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .

CMD ["npx", "tsx", "worker/index.ts"]
