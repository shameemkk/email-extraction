FROM node:18-bullseye

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install && \
    npm install -g pm2 && \
    npx playwright install-deps && \
    npx playwright install chromium

COPY . .

CMD ["pm2-runtime", "server.js"]
