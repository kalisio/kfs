ARG DEBIAN_VERSION=bookworm
ARG NODE_VERSION=20

# Use a builder
FROM node:${NODE_VERSION}-${DEBIAN_VERSION}-slim AS builder

COPY . /kfs
WORKDIR /kfs
RUN yarn install

# Copy build to slim image
FROM node:${NODE_VERSION}-${DEBIAN_VERSION}-slim

LABEL maintainer "<contact@kalisio.xyz>"
COPY --from=builder --chown=node:node /kfs /kfs
WORKDIR /kfs
USER node
EXPOSE 8081
CMD npm run prod
