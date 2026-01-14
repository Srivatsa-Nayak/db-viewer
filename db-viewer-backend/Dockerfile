FROM golang:1.25-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

ENV CGO_ENABLED=0 
ENV GOOS=linux

RUN go build -o server main.go

FROM alpine:latest

WORKDIR /root/

COPY --from=builder /app/server .

RUN mkdir -p /data

ENV DB_PATH=/data/visualizer.db
ENV PORT=8080
ENV GIN_MODE=release

EXPOSE 8080

CMD ["./server"]