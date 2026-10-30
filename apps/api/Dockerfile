FROM node:20-alpine
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/api/package.json apps/api/
RUN pnpm install --filter @air/api --no-frozen-lockfile
COPY apps/api apps/api
ENV PORT=4000 DB_PATH=/data/platform.db
VOLUME /data
EXPOSE 4000
CMD ["pnpm", "--filter", "@air/api", "start"]
