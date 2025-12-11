#!/bin/bash
cd test-npm-sandbox
npm install
echo "Exit code: $?"
ls -la node_modules/ | head -5
