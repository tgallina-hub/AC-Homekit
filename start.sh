#!/bin/zsh
set -eu
ROOT="${0:A:h}"
cd "$ROOT"
exec "$ROOT/node_modules/node/bin/node" "$ROOT/node_modules/homebridge/bin/homebridge.js" -U "$ROOT/storage" -P "$ROOT/node_modules/homebridge-midea-platform" --strict-plugin-resolution
