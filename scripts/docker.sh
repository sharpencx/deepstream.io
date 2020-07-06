#!/bin/bash
set -e

PACKAGE_VERSION=$(node scripts/details.js VERSION)

# Get local vars for scripts
if [ -f .env ]; then
    source .env
fi

if [ "${REPO_NAMESPACE}" == "" ]; then
    REPO_NAMESPACE="deepstreamio"
fi

if [ "${REPO_NAME}" == "" ]; then
    REPO_NAME="deepstream.io"
fi

echo "REPO_NAMESPACE=${REPO_NAMESPACE}"
echo "REPO_NAME=${REPO_NAME}"

if [ "${REPO_NAMESPACE}" == "deepstreamio" ]; then
    echo "$DOCKER_PASSWORD" | docker login -u "$DOCKER_USERNAME" --password-stdin
fi

npm i
npm run tsc
cd dist

docker build . -t ${REPO_NAMESPACE}/${REPO_NAME}:${PACKAGE_VERSION} -t ${REPO_NAMESPACE}/${REPO_NAME}:latest
docker push ${REPO_NAMESPACE}/${REPO_NAME}:${PACKAGE_VERSION}
docker push ${REPO_NAMESPACE}/${REPO_NAME}:latest

npm uninstall --save uWebSockets.js
echo 'Replacing node with node-alpine'
sed -i 's@node:12@node:12-alpine@' Dockerfile
echo 'Building node alpine'
docker build . -t ${REPO_NAMESPACE}/${REPO_NAME}:${PACKAGE_VERSION}-alpine -t ${REPO_NAMESPACE}/${REPO_NAME}:latest-alpine
echo 'Pushing node alpine'
docker push ${REPO_NAMESPACE}/${REPO_NAME}:${PACKAGE_VERSION}-alpine
docker push ${REPO_NAMESPACE}/${REPO_NAME}:latest-alpine

cd ../
