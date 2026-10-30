FROM rust:1.85-bookworm AS builder
WORKDIR /app

COPY Cargo.toml Cargo.lock ./
RUN mkdir src && echo "fn main() {}" > src/main.rs && cargo build --release && rm -rf src

COPY src ./src
COPY public ./public
RUN touch src/main.rs && cargo build --release

FROM debian:bookworm-slim
WORKDIR /app
COPY --from=builder /app/target/release/retone-v2 /app/retone-v2
COPY --from=builder /app/public /app/public
ENV PORT=10000
EXPOSE 10000
CMD ["/app/retone-v2"]
