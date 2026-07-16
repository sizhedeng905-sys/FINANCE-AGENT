import json
import pathlib
import sys
import unittest


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

from app.extraction import build_ocr_response, has_valid_file_signature, normalize_value, parse_template_fields


class ExtractionTests(unittest.TestCase):
    def setUp(self):
        self.fields = [
            {
                "fieldKey": "record_date",
                "fieldName": "日期",
                "fieldType": "date",
                "semanticType": "date",
                "aliases": ["发生日期"],
            },
            {
                "fieldKey": "amount",
                "fieldName": "金额",
                "fieldType": "money",
                "semanticType": "amount",
                "aliases": ["费用金额"],
            },
        ]

    def test_parses_and_validates_template_fields(self):
        parsed = parse_template_fields(json.dumps(self.fields, ensure_ascii=False), 10)
        self.assertEqual(parsed[0]["fieldKey"], "record_date")
        with self.assertRaisesRegex(ValueError, "duplicate fieldKey"):
            parse_template_fields(json.dumps([self.fields[0], self.fields[0]], ensure_ascii=False), 10)
        with self.assertRaisesRegex(ValueError, "valid JSON"):
            parse_template_fields("not-json", 10)

    def test_normalizes_dates_and_financial_numbers_conservatively(self):
        self.assertEqual(normalize_value("2026年7月14日", "date"), "2026-07-14")
        self.assertEqual(normalize_value("￥1,280.50元", "money"), "1280.50")
        self.assertEqual(normalize_value("约1280元", "money"), "约1280元")
        self.assertEqual(normalize_value("2026-02-30", "date"), "2026-02-30")

    def test_rejects_mismatched_file_signatures(self):
        self.assertTrue(has_valid_file_signature(".pdf", b"%PDF-1.7\n"))
        self.assertTrue(has_valid_file_signature(".png", b"\x89PNG\r\n\x1a\nrest"))
        self.assertFalse(has_valid_file_signature(".pdf", b"not-a-pdf"))
        self.assertFalse(has_valid_file_signature(".exe", b"MZ"))

    def test_preserves_precision_sensitive_numbers_as_json_strings(self):
        cases = {
            ".01": "0.01",
            ".09": "0.09",
            ".99": "0.99",
            "9,007,199,254,740,991": "9007199254740991",
            "9,007,199,254,740,993": "9007199254740993",
            "99,999,999,999,999.99": "99999999999999.99",
            "-1,280.50": "-1280.50",
        }
        for source, expected in cases.items():
            with self.subTest(source=source):
                value = normalize_value(source, "money")
                self.assertIsInstance(value, str)
                self.assertEqual(value, expected)

    def test_builds_low_confidence_candidates_with_page_evidence(self):
        fixture = {
            "res": {
                "page_index": 0,
                "parsing_res_list": [
                    {"block_id": 1, "block_label": "text", "block_bbox": [10, 20, 210, 50], "block_content": "日期：2026/07/14"},
                    {"block_id": 2, "block_label": "table", "block_bbox": [10, 60, 310, 160], "block_content": "费用金额: ￥1,280.50元"},
                ],
            }
        }
        response = build_ocr_response("doc-1", [fixture], self.fields, "PaddlePaddle/PaddleOCR-VL", "v1")
        self.assertEqual(response["documentId"], "doc-1")
        self.assertIn("日期", response["extractedText"])
        self.assertEqual(len(response["tables"]), 1)
        self.assertEqual(response["fieldCandidates"][0]["normalizedValue"], "2026-07-14")
        self.assertEqual(response["fieldCandidates"][1]["normalizedValue"], "1280.50")
        self.assertTrue(all(item["confidence"] < 0.8 for item in response["fieldCandidates"]))
        self.assertEqual(response["fieldCandidates"][1]["boundingBox"]["width"], 300.0)


if __name__ == "__main__":
    unittest.main()
