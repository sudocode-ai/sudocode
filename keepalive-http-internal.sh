#!/bin/bash
# keepalive-http-internal.sh
# Start simple server in background
echo "Starting HTTP server on port 3000..."
python3 -m http.server 3000 > /tmp/http-server.log 2>&1 &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"

# Wait for server to start
sleep 2

# Make internal requests for 8 minutes (longer than 5min timeout)
for i in {1..16}; do
  curl -s http://localhost:3000 > /dev/null
  echo "$(date '+%Y-%m-%d %H:%M:%S'): Internal request $i/16"
  sleep 30
done

kill $SERVER_PID
echo "$(date '+%Y-%m-%d %H:%M:%S'): Script completed"
