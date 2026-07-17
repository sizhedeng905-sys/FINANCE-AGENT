import pathlib
import sys
import unittest


sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))

try:
    from fastapi import HTTPException
    from app import main
except ModuleNotFoundError:
    HTTPException = None
    main = None


@unittest.skipIf(main is None, "FastAPI adapter dependencies are not installed")
class HealthContractTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.original_key = main.API_KEY
        self.original_pipeline = main.pipeline
        main.API_KEY = "test-key-with-at-least-thirty-two-characters"
        main.pipeline = object()

    def tearDown(self):
        main.API_KEY = self.original_key
        main.pipeline = self.original_pipeline

    async def test_liveness_exposes_only_process_state(self):
        self.assertEqual(await main.live(), {"status": "live"})

    async def test_readiness_requires_bearer_and_reports_identity(self):
        with self.assertRaises(HTTPException) as missing:
            await main.ready(None)
        self.assertEqual(missing.exception.status_code, 401)

        with self.assertRaises(HTTPException) as wrong:
            await main.ready("Bearer wrong-key")
        self.assertEqual(wrong.exception.status_code, 401)

        response = await main.ready(f"Bearer {main.API_KEY}")
        self.assertEqual(response["status"], "ready")
        self.assertEqual(response["model"], {"name": main.MODEL_NAME, "version": main.PIPELINE_VERSION})
        self.assertIn("ocr_document", response["capabilities"])

    async def test_readiness_fails_when_pipeline_is_not_loaded(self):
        main.pipeline = None
        with self.assertRaises(HTTPException) as unavailable:
            await main.ready(f"Bearer {main.API_KEY}")
        self.assertEqual(unavailable.exception.status_code, 503)


if __name__ == "__main__":
    unittest.main()
