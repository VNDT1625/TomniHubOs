FROM oven/bun:1.2-alpine
WORKDIR /app
COPY package.json tsconfig.json vitest.config.ts ./
COPY src ./src
COPY migrations ./migrations
RUN bun install --production
USER bun
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD bun -e "fetch('http://127.0.0.1:8080/health/live').then((r) => { if (!r.ok) process.exit(1); }).catch(() => process.exit(1))"
CMD ["bun","run","src/index.ts"]
