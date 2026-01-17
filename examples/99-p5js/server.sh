#!/bin/bash

# Simple HTTP server to test the p5.js example
cd /Volumes/2TB/repos/l-lang/examples/99-p5js

echo "Starting HTTP server on http://localhost:8000"
echo "Visit http://localhost:8000 to see the platformer"
echo "Press Ctrl+C to stop"

python3 -m http.server 8000
