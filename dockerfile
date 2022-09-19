FROM node:12.16-buster-slim
LABEL maintainer "<contact@kalisio.xyz>"

RUN apt-get -y update && apt-get -y install git

EXPOSE 8081

ENV HOME /kfs
RUN mkdir ${HOME}

COPY . ${HOME}

WORKDIR ${HOME}

RUN yarn

CMD npm run prod
