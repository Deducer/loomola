# syntax=docker/dockerfile:1

############
# Base
############
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat curl bash gnupg
WORKDIR /app

############
# Deps
############
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

############
# Build
############
FROM base AS build
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
# Bundle migrate.ts into self-contained CJS so runtime needs no tsx/esbuild.
RUN npx esbuild scripts/migrate.ts \
      --bundle \
      --platform=node \
      --format=cjs \
      --target=node22 \
      --outfile=scripts/migrate.cjs

############
# Runtime
############
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Install Doppler CLI
RUN curl -Ls --tlsv1.2 --proto "=https" --retry 3 https://cli.doppler.com/install.sh | sh

# Copy standalone Next.js output (includes its own node_modules for what it imports)
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# Migration artifacts (SQL files + bundled runner)
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts/migrate.cjs ./scripts/migrate.cjs

EXPOSE 3000

ENTRYPOINT ["doppler", "run", "--"]
CMD ["sh", "-c", "node ./scripts/migrate.cjs && node ./server.js"]
