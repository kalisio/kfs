FROM node:16.13-bullseye-slim
LABEL maintainer "<contact@kalisio.xyz>"

EXPOSE 8081

ENV HOME /kfs
RUN mkdir ${HOME}

COPY . ${HOME}

WORKDIR ${HOME}

RUN yarn

CMD npm run prod
