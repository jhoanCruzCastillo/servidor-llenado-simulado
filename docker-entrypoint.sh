#!/bin/sh
# Los volúmenes de Railway se montan como root: se deja el directorio de datos en manos del usuario "node" y se baja de privilegios.
set -e
DIR="${DATA_DIR:-/data}"
mkdir -p "$DIR"
chown -R node:node "$DIR" 2>/dev/null || true
exec runuser -u node -- "$@"
