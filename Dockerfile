# Firesight: API + built website in one container.
#   docker build -t firesight .
#   docker run -p 8787:8787 -e FIRMS_MAP_KEY=... -v firesight-storage:/app/storage firesight
# public/data/ must exist before building (npm run data). With FIRMS_MAP_KEY
# set, the server refreshes the newest days from NASA FIRMS every six hours and
# serves live hotspots. Ground reports from the phone app live in /app/storage:
# keep it on a volume or they are lost on every redeploy.
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV PORT=8787
ENV STORAGE_DIR=/app/storage
VOLUME /app/storage
EXPOSE 8787
CMD ["node", "--env-file-if-exists=.env", "server/main.ts"]
