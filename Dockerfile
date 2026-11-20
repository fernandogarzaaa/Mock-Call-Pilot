FROM node:26-slim
WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g pnpm@12.15.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY src ./src
COPY config ./config
COPY public ./public
EXPOSE 8080
CMD ["node", "src/server/main.ts"]
