from __future__ import annotations

import asyncio
import hmac
import os
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile

from .extraction import build_ocr_response, has_valid_file_signature, parse_template_fields


MODEL_PATH = Path(os.environ.get("MODEL_PATH", "/models/PaddleOCR-VL"))
PIPELINE_VERSION = os.environ.get("PIPELINE_VERSION", "v1")
MODEL_NAME = os.environ.get("MODEL_NAME", "PaddlePaddle/PaddleOCR-VL")
DEVICE = os.environ.get("DEVICE", "gpu:0")
API_KEY = os.environ.get("API_KEY", "")
MAX_UPLOAD_SIZE = int(os.environ.get("MAX_UPLOAD_SIZE_MB", "50")) * 1024 * 1024
MAX_TEMPLATE_FIELDS = int(os.environ.get("MAX_TEMPLATE_FIELDS", "200"))
ALLOWED_SUFFIXES = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"}

pipeline: Any | None = None
inference_lock = asyncio.Lock()


def load_pipeline():
    if len(API_KEY) < 32:
        raise RuntimeError("API_KEY must contain at least 32 characters")
    if not MODEL_PATH.is_dir():
        raise RuntimeError(f"MODEL_PATH does not exist: {MODEL_PATH}")
    if MAX_UPLOAD_SIZE < 1024 * 1024 or MAX_UPLOAD_SIZE > 100 * 1024 * 1024:
        raise RuntimeError("MAX_UPLOAD_SIZE_MB must be between 1 and 100")
    if MAX_TEMPLATE_FIELDS < 1 or MAX_TEMPLATE_FIELDS > 1000:
        raise RuntimeError("MAX_TEMPLATE_FIELDS must be between 1 and 1000")
    layout_path = MODEL_PATH / "PP-DocLayoutV2"
    if not layout_path.is_dir():
        raise RuntimeError(f"Layout model does not exist: {layout_path}")

    from paddleocr import PaddleOCRVL

    return PaddleOCRVL(
        pipeline_version=PIPELINE_VERSION,
        layout_detection_model_dir=str(layout_path),
        vl_rec_model_dir=str(MODEL_PATH),
        device=DEVICE,
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
    )


@asynccontextmanager
async def lifespan(_: FastAPI):
    global pipeline
    pipeline = await asyncio.to_thread(load_pipeline)
    yield
    pipeline = None


app = FastAPI(
    title="FINANCE-AGENT PaddleOCR Provider",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    lifespan=lifespan,
)


@app.get("/live")
async def live():
    return {"status": "live"}


@app.get("/ready")
async def ready(authorization: str | None = Header(default=None)):
    authorize(authorization)
    if pipeline is None:
        raise HTTPException(status_code=503, detail="model is not loaded")
    return {
        "status": "ready",
        "model": {"name": MODEL_NAME, "version": PIPELINE_VERSION},
        "capabilities": ["ocr_document"],
        "device": DEVICE,
        "busy": inference_lock.locked(),
    }


@app.post("/ocr")
async def recognize(
    file: UploadFile = File(...),
    document_id: str = Form(..., alias="documentId"),
    template_fields_source: str = Form(..., alias="templateFields"),
    authorization: str | None = Header(default=None),
):
    authorize(authorization)
    if not document_id.strip() or len(document_id.strip()) > 128:
        raise HTTPException(status_code=400, detail="documentId is invalid")
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=415, detail="unsupported document type")
    try:
        template_fields = parse_template_fields(template_fields_source, MAX_TEMPLATE_FIELDS)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    content = await file.read(MAX_UPLOAD_SIZE + 1)
    await file.close()
    if not content:
        raise HTTPException(status_code=400, detail="file is empty")
    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(status_code=413, detail="file exceeds the configured size limit")
    if not has_valid_file_signature(suffix, content):
        raise HTTPException(status_code=415, detail="file signature does not match its extension")
    if pipeline is None:
        raise HTTPException(status_code=503, detail="model is not loaded")

    temporary_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(prefix="finance-agent-ocr-", suffix=suffix, delete=False) as temporary:
            temporary.write(content)
            temporary_path = temporary.name
        async with inference_lock:
            results = await asyncio.to_thread(run_prediction, temporary_path)
        return build_ocr_response(
            document_id.strip(),
            results,
            template_fields,
            MODEL_NAME,
            PIPELINE_VERSION,
        )
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"OCR inference failed: {type(error).__name__}") from error
    finally:
        if temporary_path:
            Path(temporary_path).unlink(missing_ok=True)


def run_prediction(file_path: str):
    if pipeline is None:
        raise RuntimeError("model is not loaded")
    return list(pipeline.predict(file_path))


def authorize(authorization: str | None):
    expected = f"Bearer {API_KEY}"
    if authorization is None or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="invalid bearer token", headers={"WWW-Authenticate": "Bearer"})
