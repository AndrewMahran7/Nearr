FROM node:22-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da
WORKDIR /app
COPY server.cjs ./server.cjs
USER node
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server.cjs"]
