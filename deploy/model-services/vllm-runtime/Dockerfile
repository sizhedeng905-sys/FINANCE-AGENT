ARG VLLM_BASE_IMAGE=vllm/vllm-openai@sha256:6d8429e38e3747723ca07ee1b17972e09bb9c51c4032b266f24fb1cc3b22ed8f
FROM ${VLLM_BASE_IMAGE}

ARG RUNTIME_UID=10001
ARG RUNTIME_GID=10001

LABEL org.opencontainers.image.title="FINANCE-AGENT vLLM runtime" \
      org.opencontainers.image.version="0.23.0" \
      org.opencontainers.image.base.digest="sha256:6d8429e38e3747723ca07ee1b17972e09bb9c51c4032b266f24fb1cc3b22ed8f"

USER root
RUN python3 -m pip uninstall --yes mooncake-transfer-engine \
    && apt-get purge --yes python3-cryptography python3-jwt \
    && rm -rf /opt/uv/cache /var/lib/apt/lists/* \
    && groupadd --gid "${RUNTIME_GID}" finance-agent \
    && useradd --uid "${RUNTIME_UID}" --gid "${RUNTIME_GID}" --home-dir /tmp --no-create-home --shell /usr/sbin/nologin finance-agent

ENV HOME=/tmp \
    HF_HOME=/tmp/huggingface \
    TORCHINDUCTOR_CACHE_DIR=/tmp/torchinductor \
    NUMBA_CACHE_DIR=/tmp/numba \
    VLLM_CACHE_ROOT=/tmp/vllm \
    TRITON_CACHE_DIR=/tmp/.triton \
    CUDA_CACHE_PATH=/tmp/cuda \
    TORCH_EXTENSIONS_DIR=/tmp/torch-extensions

USER ${RUNTIME_UID}:${RUNTIME_GID}
