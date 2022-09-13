#!/bin/bash

# Build docker with version number only on release
if [[ -z "$TRAVIS_TAG" ]]
then
	export TAG=latest
else
	export TAG=$(node -p -e "require('./package.json').version")
fi

echo Building kfs $TAG
docker login -u="$DOCKER_USER" -p="$DOCKER_PASSWORD"
docker build -t kalisio/kfs:$TAG .
docker push kalisio/kfs:$TAG
