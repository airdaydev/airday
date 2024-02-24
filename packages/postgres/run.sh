#!/bin/bash
# Runs Development Postgresql in Docker

WORK_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

CONTAINER=borde_postgres
DB_NAME=borde_dev
NETWORK_NAME=borde
USER=borde_dev
# Using non-standard port as it conflicts with my day job
PORT=5430

echo "Stopping $CONTAINER container"
docker stop $CONTAINER &>/dev/null
echo "Creating $NETWORK_NAME container"
docker network create $NETWORK_NAME &>/dev/null

# Create container
docker run -e 'TZ=Australia/Sydney' --rm -d -p $PORT:5432 \
  -e "POSTGRES_HOST_AUTH_METHOD=trust" \
  --network $NETWORK_NAME --name $CONTAINER postgres:16.2

# Wait for connection
until docker run --rm -it --network $NETWORK_NAME postgres:16.2 psql -h $CONTAINER -p 5432 -U postgres -w -c '\q' &>/dev/null
  do echo "Waiting for PSQL"
  sleep 1
done

echo Creating user
docker exec -u postgres $CONTAINER createuser -s --no-password $USER
echo Creating DB
docker exec -u postgres $CONTAINER createdb $DB_NAME

# TODO: Run migrations
