FROM node:22-alpine AS build
WORKDIR /app
COPY package.json server.js ./
RUN npm install --omit=dev --ignore-scripts

FROM gcr.io/distroless/nodejs22-debian12
WORKDIR /app
COPY --from=build /app .
EXPOSE 3000
CMD ["/app/server.js"]