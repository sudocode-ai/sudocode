# Docker environment for isolated npm install profiling
# This creates a fresh Node.js environment that mimics GitHub Codespaces
# to reproduce slow npm install behavior without affecting development setup

FROM node:20-slim

# Install basic utilities for debugging
RUN apt-get update && apt-get install -y \
    git \
    curl \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /profiling

# Clear npm cache to ensure fresh state
RUN npm cache clean --force

# Set npm to not use any cached data between runs
ENV npm_config_cache=/tmp/npm-cache
ENV npm_config_prefer_offline=false

# Label for documentation
LABEL description="Fresh Node.js environment for profiling npm install performance"
LABEL node_version="20"
LABEL purpose="sudocode npm install profiling"

# Default command: interactive bash for debugging
CMD ["/bin/bash"]
