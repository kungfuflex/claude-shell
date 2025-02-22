FROM node:lts

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

# Create app directory
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --prod

# Copy source files
COPY . .

# Build TypeScript
RUN pnpm build

# Use ENTRYPOINT with CMD for argument passing
ENTRYPOINT ["node", "bin/claude-shell.js"]
CMD []
