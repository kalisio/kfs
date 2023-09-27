# Use a builder
FROM node:16-bookworm-slim AS builder

COPY . /kfs
WORKDIR /kfs
RUN yarn install

# Copy build to slim image
FROM node:16-bookworm-slim

LABEL maintainer "<contact@kalisio.xyz>"
COPY --from=builder --chown=node:node /kfs /kfs
WORKDIR /kfs
USER node
EXPOSE 8081
CMD npm run prod
