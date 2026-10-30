FROM node:20-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
RUN pnpm install --filter @air/web --no-frozen-lockfile
COPY apps/web apps/web
# rewrites 在构建时固化，指向 compose 服务名
ENV PLATFORM_API_URL=http://api:4000
ENV AGENT_SERVER_URL=http://agent-server:8100
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @air/web build

FROM node:20-alpine
WORKDIR /repo
RUN corepack enable
COPY --from=build /repo ./
ENV PORT=3000 NEXT_TELEMETRY_DISABLED=1
EXPOSE 3000
CMD ["pnpm", "--filter", "@air/web", "start"]
