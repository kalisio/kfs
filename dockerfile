# Use a builder
FROM node:12.16-buster-slim AS builder
RUN DEBIAN_FRONTEND=noninteractive && \
  apt-get update && \
  apt-get --no-install-recommends --yes install \
    ca-certificates \
    git
COPY . /kfs
WORKDIR /kfs
RUN yarn

# Copy build to slim image
FROM node:12.16-buster-slim
LABEL maintainer "<contact@kalisio.xyz>"
COPY --from=builder --chown=node:node /kfs /kfs
WORKDIR /kfs

USER node
EXPOSE 8081
CMD npm run prod
