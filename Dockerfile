FROM node:20-bullseye

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY index.js ./

ENV PORT=8080
EXPOSE 8080

CMD ["node", "index.js"]