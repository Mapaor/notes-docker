FROM rust:1.88-bookworm AS builder
WORKDIR /app
COPY Cargo.toml Cargo.lock* ./
COPY src ./src
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/target/release/notes /usr/local/bin/notes
COPY static ./static
RUN mkdir -p /data
ENV PORT=8084 DATABASE_PATH=/data/notes.db MAX_NOTE_SIZE=100000 RUST_LOG=info
EXPOSE 8084
CMD ["notes"]