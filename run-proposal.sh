#!/bin/bash

# Check if a proposal ID was provided
if [ -z "$1" ]; then
  echo "Error: Please provide a proposal ID"
  echo "Usage: ./run-proposal.sh <proposal-id>"
  exit 1
fi

# Set environment variables
export DAO_NAME="Uniswap"
export GOVERNOR_ADDRESS="0x408ED6354d4973f66138C91495F2f2FCbd8724C3"

# Run the script with the provided proposal ID
bun run-checks.ts "$1" 