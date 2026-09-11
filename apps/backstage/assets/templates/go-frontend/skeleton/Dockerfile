FROM golang:1.22-alpine AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /app/frontend .

FROM gcr.io/distroless/static-debian12
WORKDIR /workdir
COPY --from=build /app/frontend .
COPY public/ ./public/
EXPOSE 8080
ENTRYPOINT ["/workdir/frontend"]