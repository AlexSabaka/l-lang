#!/bin/bash
#
# L-Lang Test Runner Wrapper
# This is a convenience script that calls the main TypeScript test runner.
# 
# Usage:
#   ./test_all.sh           # Run all tests
#   ./test_all.sh --verbose # Show detailed output on failures
#

cd "$(dirname "$0")"

# Run the TypeScript test runner
ts-node src/test/runner.ts "$@"
