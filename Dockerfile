# Firesight: API + built website in one container.
#   docker build -t firesight .
#   docker run -p 8787:8787 -e FIRMS_MAP_KEY=... firesight
# public/data/ must exist before building (npm run data). With FIRMS_MAP_KEY
# set, the server refreshes the newest days from NASA FIRMS every six hours.
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV PORT=8787
EXPOSE 8787
CMD ["node", "--env-file-if-exists=.env", "server/main.ts"]
