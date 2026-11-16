# Context Graph Lab on a Hugging Face Docker Space: HydraDB (graph-node) + the demo server in one container.
# The graph-node binary is HydraDB v0.4.0 built from source (github.com/hydra-db/hydradb, Elastic License 2.0),
# on Ubuntu 24.04 with the stock libgraphblas7 and libcypher-parser packages.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils libgraphblas7 libgomp1 \
 && curl -fsSL https://nodejs.org/dist/v22.11.0/node-v22.11.0-linux-x64.tar.xz | tar -xJ -C /usr/local --strip-components=1 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv/ctx
COPY bin/graph-node /usr/local/bin/graph-node
COPY . /srv/ctx
RUN chmod +x /usr/local/bin/graph-node /srv/ctx/start.sh && useradd -m -u 1000 user && chown -R user:user /srv/ctx
USER user

ENV PORT=7860 HYDRA_URL=http://127.0.0.1:18443
EXPOSE 7860
CMD ["/srv/ctx/start.sh"]
