ARG PADDLE_OCR_BASE_IMAGE=ccr-2vdh3abv-pub.cnc.bj.baidubce.com/paddlepaddle/paddleocr-vl:latest-nvidia-gpu-sm120
FROM ${PADDLE_OCR_BASE_IMAGE}

WORKDIR /srv/finance-agent-ocr

COPY requirements.txt ./requirements.txt
RUN python -m pip install --no-cache-dir -r requirements.txt

COPY app ./app

ENV PYTHONPATH=/srv/finance-agent-ocr \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

EXPOSE 8868

ENTRYPOINT []
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8868", "--workers", "1"]
