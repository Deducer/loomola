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

############
# Runtime
############
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Install Doppler CLI
RUN curl -Ls --tlsv1.2 --proto "=https" --retry 3 https://cli.doppler.com/install.sh | sh

# Copy standalone Next.js output
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public

# Copy migration script + drizzle folder + scripts + tsx for running ts directly
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/node_modules/tsx ./node_modules/tsx
COPY --from=build /app/node_modules/postgres ./node_modules/postgres
COPY --from=build /app/node_modules/drizzle-orm ./node_modules/drizzle-orm

EXPOSE 3000

ENTRYPOINT ["doppler", "run", "--"]
CMD ["sh", "-c", "node ./node_modules/tsx/dist/cli.mjs ./scripts/migrate.ts && node ./server.js"]
