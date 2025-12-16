FROM node:24-alpine AS builder

WORKDIR /app

# Build arguments for Vite environment variables
ARG VITE_SENTRY_DSN
ARG VITE_OTEL_EXPORTER_OTLP_ENDPOINT
ENV VITE_SENTRY_DSN=$VITE_SENTRY_DSN
ENV VITE_OTEL_EXPORTER_OTLP_ENDPOINT=$VITE_OTEL_EXPORTER_OTLP_ENDPOINT

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
