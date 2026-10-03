FROM node:24-bookworm-slim

# openssl: Prisma needs it. chromium: the payslip and statement PDFs.
# There is no bundled Chromium (PUPPETEER_SKIP_DOWNLOAD), so CHROME_PATH
# must point at this one.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates chromium fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    CHROME_PATH=/usr/bin/chromium

WORKDIR /app

# Dev dependencies stay in the image on purpose: `prisma db seed` needs tsx.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# Set after the build, so npm ci above keeps the dev packages.
ENV NODE_ENV=production

EXPOSE 4000
# Migrations are NOT run here: this container talks to a shared database.
# To apply them on purpose: docker compose run --rm server npx prisma migrate deploy
CMD ["node", "dist/index.js"]
