#!/bin/sh
# Deploys the function to the local Lambda, with the steps a deploy to AWS Lambda has: zip the bundle,
# create the function as version 1 with its settings, and tell Restate where it is. Floci runs this
# once it is ready. The settings come from compose.yaml.
#
# The tests run it again with another name and bundle, to deploy a copy of the function that stops
# part-way.
set -e
name=${1:-book-trade}
bundle=${2:-index.js}

work=$(mktemp -d)
cp "/function/$bundle" "$work/index.js"
(cd "$work" && python3 -m zipfile -c function.zip index.js)
arn=$(aws lambda create-function --function-name "$name" \
  --runtime nodejs22.x --handler index.handler \
  --role arn:aws:iam::000000000000:role/lambda \
  --zip-file "fileb://$work/function.zip" --timeout 60 \
  --environment "Variables={DATABASE_HOST=$DATABASE_HOST,DATABASE_PORT=$DATABASE_PORT,DATABASE_USER=$DATABASE_USER,DATABASE_PASSWORD=$DATABASE_PASSWORD,DATABASE_NAME=$DATABASE_NAME,TYCOSTREAM_URL=$TYCOSTREAM_URL}" \
  --publish --query "join(':', [FunctionArn, Version])" --output text)
rm -r "$work"

# Restate then asks the function what it contains, and sends it new work from here on
until curl -sf -o /dev/null http://restate:9070/health; do sleep 1; done
curl -sf -o /dev/null -X POST http://restate:9070/deployments -H 'content-type: application/json' \
  -d "{\"arn\": \"$arn\", \"force\": true}"
echo "deployed $arn and registered it with Restate"
