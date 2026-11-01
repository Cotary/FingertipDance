FROM golang:1.24-alpine AS builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/http ./cmd/http

FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
ENV TZ=Asia/Shanghai
WORKDIR /app
COPY --from=builder /out/http /app/http
COPY --from=builder /src/migrations /app/migrations
COPY --from=builder /src/data /app/data
EXPOSE 8080
ENTRYPOINT ["/app/http"]
