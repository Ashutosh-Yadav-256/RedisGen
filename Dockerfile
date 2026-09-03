FROM node:18-alpine
WORKDIR /app
COPY package.json ./
COPY src/ ./src/
COPY tests/ ./tests/
EXPOSE 6379
ENV PORT=10000
CMD ["node", "src/server.js", "--bind", "0.0.0.0"]
