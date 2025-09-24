#!/bin/bash
# Kills server spawned by serverd.sh
pkill -f 'target/debug/airday' || true
