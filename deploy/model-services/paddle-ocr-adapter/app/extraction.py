from __future__ import annotations

import json
import math
import re
from collections.abc import Iterable, Mapping, Sequence
from datetime import date
from decimal import Decimal, InvalidOperation
from typing import Any


FIELD_TYPES = {"text", "textarea", "number", "money", "date", "select", "file"}


def has_valid_file_signature(suffix: str, content: bytes) -> bool:
    signatures = {
        ".pdf": lambda value: value.startswith(b"%PDF-"),
        ".png": lambda value: value.startswith(b"\x89PNG\r\n\x1a\n"),
        ".jpg": lambda value: value.startswith(b"\xff\xd8\xff"),
        ".jpeg": lambda value: value.startswith(b"\xff\xd8\xff"),
        ".webp": lambda value: len(value) >= 12 and value.startswith(b"RIFF") and value[8:12] == b"WEBP",
        ".bmp": lambda value: value.startswith(b"BM"),
        ".tif": lambda value: value.startswith((b"II*\x00", b"MM\x00*")),
        ".tiff": lambda value: value.startswith((b"II*\x00", b"MM\x00*")),
    }
    validator = signatures.get(suffix.casefold())
    return bool(validator and validator(content))


def parse_template_fields(source: str, max_fields: int) -> list[dict[str, Any]]:
    if len(source) > 1_000_000:
        raise ValueError("templateFields is too large")
    try:
        value = json.loads(source)
    except json.JSONDecodeError as error:
        raise ValueError("templateFields must be valid JSON") from error
    if not isinstance(value, list):
        raise ValueError("templateFields must be a JSON array")
    if len(value) > max_fields:
        raise ValueError(f"templateFields cannot contain more than {max_fields} fields")

    fields: list[dict[str, Any]] = []
    seen_keys: set[str] = set()
    for index, item in enumerate(value):
        if not isinstance(item, Mapping):
            raise ValueError(f"templateFields[{index}] must be an object")
        field_key = _required_text(item.get("fieldKey"), 128, f"templateFields[{index}].fieldKey")
        field_name = _required_text(item.get("fieldName"), 128, f"templateFields[{index}].fieldName")
        field_type = _required_text(item.get("fieldType"), 32, f"templateFields[{index}].fieldType")
        if field_type not in FIELD_TYPES:
            raise ValueError(f"templateFields[{index}].fieldType is unsupported")
        normalized_key = field_key.casefold()
        if normalized_key in seen_keys:
            raise ValueError(f"duplicate fieldKey: {field_key}")
        seen_keys.add(normalized_key)

        aliases_value = item.get("aliases") or []
        if not isinstance(aliases_value, list) or len(aliases_value) > 20:
            raise ValueError(f"templateFields[{index}].aliases must be an array with at most 20 items")
        aliases = []
        for alias in aliases_value:
            if not isinstance(alias, str) or not alias.strip() or len(alias.strip()) > 128:
                raise ValueError(f"templateFields[{index}].aliases contains an invalid alias")
            aliases.append(alias.strip())

        fields.append({
            "fieldId": str(item.get("fieldId") or "")[:128],
            "fieldKey": field_key,
            "fieldName": field_name,
            "fieldType": field_type,
            "semanticType": str(item.get("semanticType") or "none")[:64],
            "aliases": aliases,
        })
    return fields


def build_ocr_response(
    document_id: str,
    results: Iterable[Any],
    template_fields: list[dict[str, Any]],
    model_name: str,
    model_version: str,
) -> dict[str, Any]:
    pages: list[dict[str, Any]] = []
    text_blocks: list[dict[str, Any]] = []
    tables: list[dict[str, Any]] = []

    for ordinal, result in enumerate(results, start=1):
        payload = _result_payload(result)
        page_data = payload.get("res") if isinstance(payload.get("res"), Mapping) else payload
        page_number = _page_number(page_data, ordinal)
        blocks = _parsing_blocks(page_data)
        normalized_blocks = [_normalize_block(block, page_number, position) for position, block in enumerate(blocks)]
        normalized_blocks = [block for block in normalized_blocks if block is not None]

        if not normalized_blocks:
            normalized_blocks = _fallback_blocks(page_data, page_number)

        text_blocks.extend(normalized_blocks)
        tables.extend(block for block in normalized_blocks if _is_table(block.get("label", "")))
        pages.append({
            "page": page_number,
            "width": _page_dimension(page_data.get("width"), "width"),
            "height": _page_dimension(page_data.get("height"), "height"),
            "preprocessing": {
                "rotationReserved": True,
                "compressionReserved": True,
                "scalingReserved": True,
                "renderingReserved": True,
            },
        })

    text_blocks.sort(key=lambda item: (item["page"], item.get("order", 0)))
    extracted_text = "\n".join(
        block["text"].strip() for block in text_blocks if isinstance(block.get("text"), str) and block["text"].strip()
    )
    candidates = extract_field_candidates(text_blocks, template_fields)

    return {
        "documentId": document_id,
        "extractedText": extracted_text,
        "pages": pages,
        "textBlocks": text_blocks,
        "tables": tables,
        "fieldCandidates": candidates,
        "rawResult": {
            "provider": "local_paddle",
            "model": model_name,
            "version": model_version,
            "pageCount": len(pages),
            "textBlockCount": len(text_blocks),
            "tableCount": len(tables),
        },
    }


def extract_field_candidates(
    text_blocks: list[dict[str, Any]], template_fields: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    lines: list[dict[str, Any]] = []
    for block in text_blocks:
        for line in str(block.get("text") or "").splitlines():
            cleaned = line.strip()
            if cleaned:
                lines.append({
                    "text": cleaned,
                    "page": max(1, int(block.get("page") or 1)),
                    "boundingBox": block.get("boundingBox"),
                })

    candidates = []
    for field in template_fields:
        if field["fieldType"] == "file":
            continue
        match = _find_field_value(lines, field)
        if match is None:
            continue
        raw_value, source_label, line, confidence, strategy = match
        normalized_value = normalize_value(raw_value, field["fieldType"])
        candidate = {
            "targetFieldKey": field["fieldKey"],
            "sourceLabel": source_label,
            "rawValue": raw_value,
            "normalizedValue": normalized_value,
            "page": line["page"],
            "confidence": confidence,
            "evidence": f"PaddleOCR-VL deterministic {strategy} label match; human confirmation required.",
        }
        if field.get("fieldId"):
            candidate["targetFieldId"] = field["fieldId"]
        if line.get("boundingBox") is not None:
            candidate["boundingBox"] = line["boundingBox"]
        candidates.append(candidate)
    return candidates


def normalize_value(raw_value: str, field_type: str) -> Any:
    value = raw_value.strip()
    if field_type in {"number", "money"}:
        compact = value.replace(",", "").replace(" ", "")
        if field_type == "money":
            compact = re.sub(r"^(?:CNY|RMB|CN¥|[¥￥])", "", compact, flags=re.IGNORECASE)
            compact = re.sub(r"(?:元|圆)$", "", compact)
        match = re.fullmatch(r"[-+]?(?:\d+(?:\.\d+)?|\.\d+)", compact)
        if match:
            try:
                number = Decimal(compact)
            except InvalidOperation:
                return value
            if not number.is_finite():
                return value
            return format(number, "f")
        return value
    if field_type == "date":
        match = re.fullmatch(r"(\d{4})[年./-](\d{1,2})[月./-](\d{1,2})(?:日)?", value)
        if match:
            try:
                parsed = date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
                return parsed.isoformat()
            except ValueError:
                return value
    return value


def _find_field_value(lines: list[dict[str, Any]], field: dict[str, Any]):
    labels = [field["fieldName"], *field.get("aliases", [])]
    for label_index, label in enumerate(labels):
        escaped = re.escape(label)
        separator_pattern = re.compile(rf"^\s*{escaped}\s*[:：=]\s*(.+?)\s*$", re.IGNORECASE)
        whitespace_pattern = re.compile(rf"^\s*{escaped}\s+(.+?)\s*$", re.IGNORECASE)
        for index, line in enumerate(lines):
            separator_match = separator_pattern.match(line["text"])
            if separator_match and separator_match.group(1).strip():
                confidence = 0.76 if label_index == 0 else 0.70
                return separator_match.group(1).strip(), label, line, confidence, "separator"
            whitespace_match = whitespace_pattern.match(line["text"])
            if whitespace_match and whitespace_match.group(1).strip():
                confidence = 0.70 if label_index == 0 else 0.64
                return whitespace_match.group(1).strip(), label, line, confidence, "whitespace"
            if _normalized_text(line["text"]) == _normalized_text(label) and index + 1 < len(lines):
                next_line = lines[index + 1]
                if next_line["page"] == line["page"]:
                    confidence = 0.66 if label_index == 0 else 0.60
                    return next_line["text"], label, next_line, confidence, "adjacent-line"
    return None


def _result_payload(result: Any) -> dict[str, Any]:
    value = getattr(result, "json", result)
    if callable(value):
        value = value()
    if isinstance(value, str):
        value = json.loads(value)
    if isinstance(value, Mapping):
        return dict(value)
    raise ValueError("PaddleOCR result is not a JSON object")


def _parsing_blocks(page_data: Mapping[str, Any]) -> list[Any]:
    for key in ("parsing_res_list", "parsing_result", "parsing_results"):
        value = page_data.get(key)
        if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
            return list(value)
    return []


def _normalize_block(block: Any, page: int, position: int) -> dict[str, Any] | None:
    if not isinstance(block, Mapping):
        block = _result_payload(block)
    text = block.get("block_content") or block.get("content") or block.get("text") or ""
    if not isinstance(text, str) or not text.strip():
        return None
    label = str(block.get("block_label") or block.get("label") or "text")[:64]
    normalized: dict[str, Any] = {
        "page": page,
        "order": _integer(block.get("block_order"), _integer(block.get("block_id"), position)),
        "label": label,
        "text": text.strip(),
    }
    bounding_box = _bounding_box(block.get("block_bbox") or block.get("bbox") or block.get("bounding_box"))
    if bounding_box is not None:
        normalized["boundingBox"] = bounding_box
    return normalized


def _fallback_blocks(page_data: Mapping[str, Any], page: int) -> list[dict[str, Any]]:
    values: list[str] = []
    for key in ("markdown", "markdown_text", "text"):
        value = page_data.get(key)
        if isinstance(value, str) and value.strip():
            values.append(value.strip())
        elif isinstance(value, Mapping):
            nested = value.get("text") or value.get("markdown")
            if isinstance(nested, str) and nested.strip():
                values.append(nested.strip())
    overall = page_data.get("overall_ocr_res")
    if isinstance(overall, Mapping):
        recognized = overall.get("rec_texts")
        if isinstance(recognized, Sequence) and not isinstance(recognized, (str, bytes, bytearray)):
            values.extend(str(item).strip() for item in recognized if str(item).strip())
    return [{"page": page, "order": index, "label": "text", "text": value} for index, value in enumerate(values)]


def _bounding_box(value: Any) -> dict[str, float] | None:
    if isinstance(value, Mapping):
        try:
            return {
                "x": float(value.get("x", 0)),
                "y": float(value.get("y", 0)),
                "width": max(0.0, float(value.get("width", 0))),
                "height": max(0.0, float(value.get("height", 0))),
            }
        except (TypeError, ValueError):
            return None
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)) and len(value) >= 4:
        try:
            x1, y1, x2, y2 = (float(value[index]) for index in range(4))
            return {"x": x1, "y": y1, "width": max(0.0, x2 - x1), "height": max(0.0, y2 - y1)}
        except (TypeError, ValueError):
            return None
    return None


def _page_number(page_data: Mapping[str, Any], ordinal: int) -> int:
    value = page_data.get("page_index")
    if isinstance(value, int) and value >= 0:
        return value + 1
    value = page_data.get("page")
    if isinstance(value, int) and value > 0:
        return value
    return ordinal


def _page_dimension(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"PaddleOCR page {label} is missing or invalid")
    parsed = float(value)
    if not math.isfinite(parsed) or parsed <= 0 or parsed > 200_000 or not parsed.is_integer():
        raise ValueError(f"PaddleOCR page {label} is missing or invalid")
    return int(parsed)


def _integer(value: Any, fallback: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _is_table(label: str) -> bool:
    return "table" in label.casefold() or "表格" in label


def _normalized_text(value: str) -> str:
    return re.sub(r"\s+", "", value).casefold()


def _required_text(value: Any, max_length: int, label: str) -> str:
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > max_length:
        raise ValueError(f"{label} must be a non-empty string no longer than {max_length} characters")
    return value.strip()
