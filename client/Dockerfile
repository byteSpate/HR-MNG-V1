FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Both values are baked into the build, so they cannot change at run time.
# NEXT_PUBLIC_API_URL (where the BROWSER reaches the API) comes from
# client/.env, which is copied in with the rest of the folder.
# API_ORIGIN (where this Next server reaches the API, for /api/auth/*) is
# fixed here. client/.env says localhost, and inside this container that
# would mean the client itself. A value set here wins over the .env file.
ENV API_ORIGIN=http://server:4000 \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
