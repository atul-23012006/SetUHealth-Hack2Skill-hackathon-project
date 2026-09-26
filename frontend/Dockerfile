# Only needed if not deploying to Vercel/Netlify directly (recommended path
# for this static Vite app). Builds the app and serves it via nginx.
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
RUN npm run build

# nginx:alpine's master process runs as root (needed to bind port 80, then
# it drops worker processes to an unprivileged user); nginx-unprivileged is
# the maintained image that runs the whole container, master included, as
# non-root — hence the unprivileged port 8080 below instead of 80.
FROM nginxinc/nginx-unprivileged:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
