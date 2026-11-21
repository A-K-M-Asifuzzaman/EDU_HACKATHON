"""Vercel entry point: the same FastAPI app, served as a Python function. Static dashboard files are served by Vercel's CDN (see vercel.json)."""
from dengueshield.api.main import app  # noqa: F401
