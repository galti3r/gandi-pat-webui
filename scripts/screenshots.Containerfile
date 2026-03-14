# Screenshot capture image — real Google Chrome via Playwright
FROM mcr.microsoft.com/playwright:v1.50.1-noble

WORKDIR /app

# Install screenshot script dependencies + real Chrome
COPY scripts/package.json ./scripts/
RUN cd scripts && npm install --ignore-scripts && npx playwright install chrome

# cors-proxy.py and dist/ are mounted at runtime
