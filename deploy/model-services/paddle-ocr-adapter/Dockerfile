ARG PADDLE_OCR_BASE_IMAGE=ccr-2vdh3abv-pub.cnc.bj.baidubce.com/paddlepaddle/paddleocr-vl@sha256:659eb236d509966380c0ac938049cbb3494f1e84c5d5c53fcac3572c05463487
FROM ${PADDLE_OCR_BASE_IMAGE}

ARG APP_VERSION=1.0.0
ARG RUNTIME_UID=10001
ARG RUNTIME_GID=10001
ARG SETUPTOOLS_VENDOR_JARACO_CONTEXT_VERSION=6.1.0
ARG SETUPTOOLS_VENDOR_WHEEL_VERSION=0.46.2

LABEL org.opencontainers.image.title="FINANCE-AGENT PaddleOCR adapter" \
      org.opencontainers.image.version="${APP_VERSION}" \
      org.opencontainers.image.base.digest="sha256:659eb236d509966380c0ac938049cbb3494f1e84c5d5c53fcac3572c05463487"

USER root
WORKDIR /srv/finance-agent-ocr

COPY requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir --upgrade pip==26.1.2 \
    && python -m pip install --no-cache-dir --upgrade -r requirements.txt \
    && SETUPTOOLS_VENDOR="$(python -c 'from pathlib import Path; import setuptools; print(Path(setuptools.__file__).parent / "_vendor")')" \
    && rm -rf \
        "${SETUPTOOLS_VENDOR}/jaraco.context-5.3.0.dist-info" \
        "${SETUPTOOLS_VENDOR}/jaraco/context.py" \
        "${SETUPTOOLS_VENDOR}/jaraco/__pycache__/context.cpython-310.pyc" \
        "${SETUPTOOLS_VENDOR}/wheel-0.45.1.dist-info" \
        "${SETUPTOOLS_VENDOR}/wheel" \
    && python -m pip install --no-cache-dir --no-deps --upgrade \
        --target /tmp/setuptools-vendor \
        "jaraco.context==${SETUPTOOLS_VENDOR_JARACO_CONTEXT_VERSION}" \
        "wheel==${SETUPTOOLS_VENDOR_WHEEL_VERSION}" \
    && cp -a /tmp/setuptools-vendor/jaraco/context "${SETUPTOOLS_VENDOR}/jaraco/context" \
    && cp -a /tmp/setuptools-vendor/jaraco_context-*.dist-info "${SETUPTOOLS_VENDOR}/" \
    && cp -a /tmp/setuptools-vendor/wheel "${SETUPTOOLS_VENDOR}/wheel" \
    && cp -a /tmp/setuptools-vendor/wheel-*.dist-info "${SETUPTOOLS_VENDOR}/" \
    && rm -rf /tmp/setuptools-vendor \
    && groupadd --gid "${RUNTIME_GID}" finance-agent \
    && useradd --uid "${RUNTIME_UID}" --gid "${RUNTIME_GID}" --no-create-home --shell /usr/sbin/nologin finance-agent \
    && chown -R "${RUNTIME_UID}:${RUNTIME_GID}" /srv/finance-agent-ocr

COPY --chown=${RUNTIME_UID}:${RUNTIME_GID} app ./app
COPY --chown=${RUNTIME_UID}:${RUNTIME_GID} tests ./tests

ENV PYTHONPATH=/srv/finance-agent-ocr \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOME=/tmp

RUN python -m unittest discover -s tests -p "test_*.py"

USER ${RUNTIME_UID}:${RUNTIME_GID}
EXPOSE 8868

ENTRYPOINT []
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8868", "--workers", "1"]
