FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY public ./public
RUN mkdir -p data && chown -R node:node /app
USER node
EXPOSE 4444
CMD ["node", "server.js"]
