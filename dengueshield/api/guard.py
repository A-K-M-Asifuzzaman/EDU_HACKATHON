"""Copilot abuse and spend controls (V3).

Application-level controls only. They limit what this server spends, but they are NOT a provider-enforced hard limit:
the owner should also set a monthly usage limit in the OpenAI dashboard.

- Client identity: the TCP peer address. `X-Forwarded-For` is honoured only for a configured number of trusted proxy hops
  (`COPILOT_TRUSTED_PROXY_HOPS`, default 0), counted from the right, so a caller cannot choose their own key.
- Rate limits: per client per hour AND a global per-hour ceiling that no identity trick can exceed.
- Concurrency: a global ceiling on simultaneous provider calls; extra requests are refused (no queueing).
- Budget: a monthly ledger persisted to disk. Each answer reserves its worst-case cost before the provider is called and is
  reconciled afterwards; cancellations, timeouts and errors are charged the full reservation (conservative).
- Fail safe: if the ledger cannot be read or written, generation is refused and the retrieval-only fallback is used.
"""
from __future__ import annotations

import json
import os
import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from pathlib import Path

from dengueshield.api.store import CACHE_ROOT


def _env_int(name: str, default: int) -> int:
    try:
        return max(0, int(os.environ.get(name, default)))
    except ValueError:
        return default


TRUSTED_HOPS = _env_int("COPILOT_TRUSTED_PROXY_HOPS", 0)
PER_CLIENT_PER_HOUR = _env_int("COPILOT_PER_CLIENT_PER_HOUR", 20)
GLOBAL_PER_HOUR = _env_int("COPILOT_GLOBAL_PER_HOUR", 120)
MAX_CONCURRENT = max(1, _env_int("COPILOT_MAX_CONCURRENT", 3))
MAX_BODY_BYTES = 16_000
STALE_SECONDS = 600            # a reservation or concurrency slot older than this is treated as abandoned
LEDGER_PATH = Path(os.environ.get("COPILOT_LEDGER", CACHE_ROOT / "copilot_ledger.json"))


def client_key(peer: str | None, xff: str | None, hops: int = TRUSTED_HOPS) -> str:
    """Rate-limit key. With hops=0 only the TCP peer counts. With hops=n, the n-th address from the right of X-Forwarded-For
    (the one appended by the outermost trusted proxy) is used; anything to its left was written by the caller and is ignored."""
    peer = peer or "unknown"
    if hops <= 0 or not xff:
        return peer
    parts = [p.strip() for p in xff.split(",") if p.strip()]
    return parts[-hops] if len(parts) >= hops else peer


class RateLimiter:
    def __init__(self, per_client: int = PER_CLIENT_PER_HOUR, global_limit: int = GLOBAL_PER_HOUR, window: float = 3600.0):
        self.per_client, self.global_limit, self.window = per_client, global_limit, window
        self._client: dict[str, deque] = defaultdict(deque)
        self._global: deque = deque()
        self._lock = threading.Lock()

    def _trim(self, q: deque, now: float):
        while q and now - q[0] >= self.window:
            q.popleft()

    def allow(self, key: str, now: float | None = None) -> tuple[bool, str]:
        now = time.time() if now is None else now
        with self._lock:
            q = self._client[key]
            self._trim(q, now), self._trim(self._global, now)
            if len(self._global) >= self.global_limit:
                return False, f"the service-wide limit of {self.global_limit} questions per hour was reached"
            if len(q) >= self.per_client:
                return False, f"the limit of {self.per_client} questions per hour was reached"
            q.append(now), self._global.append(now)
            if len(self._client) > 5000:                           # bounded memory: drop idle keys
                for k in [k for k, v in self._client.items() if not v][:2500]:
                    del self._client[k]
            return True, ""


@dataclass(eq=False)
class Reservation:
    amount: float
    month: str
    settled: bool = False
    created: float = 0.0


class SpendLedger:
    """Monthly spend persisted to a JSON file. Reservations are held in memory and count against the budget immediately."""

    def __init__(self, budget_usd: float, path: Path = LEDGER_PATH):
        self.budget, self.path = float(budget_usd), Path(path)
        self._lock = threading.Lock()
        self._reserved = 0.0
        self._active: list[Reservation] = []

    @staticmethod
    def _month() -> str:
        return time.strftime("%Y-%m")

    def _read(self) -> dict:
        if not self.path.exists():
            return {}
        return json.loads(self.path.read_text())

    def _write(self, data: dict):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data))
        tmp.replace(self.path)

    def spent(self) -> float:
        with self._lock:
            return float(self._read().get(self._month(), 0.0))

    def snapshot(self) -> dict:
        with self._lock:
            try:
                spent = float(self._read().get(self._month(), 0.0))
            except Exception:
                return {"month": self._month(), "budget_usd": self.budget, "ledger": "unavailable"}
            return {"month": self._month(), "budget_usd": self.budget, "spent_usd_estimate": round(spent, 4),
                    "reserved_usd": round(self._reserved, 4), "remaining_usd": round(max(0.0, self.budget - spent - self._reserved), 4)}

    def reserve(self, amount: float) -> Reservation | None:
        """Reserve `amount` USD or return None if the budget would be exceeded or the ledger is unusable (fail safe)."""
        with self._lock:
            try:
                spent = float(self._read().get(self._month(), 0.0))
                self._write(self._read() | {self._month(): spent})      # proves the ledger is writable before spending
            except Exception:
                return None
            now = time.time()
            for r in [r for r in self._active if now - r.created > STALE_SECONDS]:   # abandoned (never settled): charge in full
                self._settle_locked(r, None)
            spent = float(self._read().get(self._month(), 0.0))
            if spent + self._reserved + amount > self.budget:
                return None
            self._reserved += amount
            r = Reservation(amount, self._month(), created=now)
            self._active.append(r)
            return r

    def settle(self, res: Reservation, actual: float | None):
        """Release the reservation and record the cost. `actual=None` (cancelled, failed, unknown) charges the full reservation."""
        with self._lock:
            self._settle_locked(res, actual)

    def _settle_locked(self, res: Reservation, actual: float | None):
        if res.settled:
            return
        res.settled = True
        self._active = [r for r in self._active if r is not res]
        self._reserved = max(0.0, self._reserved - res.amount)
        cost = res.amount if actual is None else max(0.0, float(actual))
        try:
            data = self._read()
            data[res.month] = float(data.get(res.month, 0.0)) + cost
            self._write(data)
        except Exception:
            pass                                                # reservation already released; next reserve() fails safe if IO keeps failing


class ConcurrencyGate:
    """At most `limit` provider calls at once. Slots expire after STALE_SECONDS so an abandoned call cannot block forever."""

    def __init__(self, limit: int = MAX_CONCURRENT):
        self.limit = limit
        self._slots: dict[int, float] = {}
        self._next = 0
        self._lock = threading.Lock()

    def try_enter(self) -> int | None:
        with self._lock:
            now = time.time()
            for k in [k for k, t in self._slots.items() if now - t > STALE_SECONDS]:
                del self._slots[k]
            if len(self._slots) >= self.limit:
                return None
            self._next += 1
            self._slots[self._next] = now
            return self._next

    def leave(self, token: int | None):
        with self._lock:
            self._slots.pop(token, None)

    def in_use(self) -> int:
        with self._lock:
            return len(self._slots)


def worst_case_cost(prompt_chars: int, price_in: float, price_out: float, rounds: int, max_out: int, tool_chars: int = 12_000) -> float:
    """Upper-bound estimate of one answer: every round may re-send the prompt, earlier outputs and tool results
    (previous_response_id bills the stored context again), plus the maximum output per round. Tokens ≈ chars / 3."""
    per_round_in = prompt_chars / 3 + tool_chars / 3 + rounds * max_out
    return rounds * (per_round_in / 1e6 * price_in + max_out / 1e6 * price_out)


class BodyLimit:
    """ASGI middleware: refuse request bodies over `limit` bytes on the given POST paths, including chunked bodies that
    carry no Content-Length. The body is counted as it streams, before the endpoint parses it."""

    def __init__(self, app, paths: tuple[str, ...], limit: int = MAX_BODY_BYTES):
        self.app, self.paths, self.limit = app, paths, limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") != "POST" or scope.get("path") not in self.paths:
            return await self.app(scope, receive, send)
        declared = dict(scope.get("headers") or []).get(b"content-length")
        if declared is not None and declared.isdigit() and int(declared) > self.limit:
            return await _reply_413(send)
        chunks, size = [], 0
        while True:
            msg = await receive()
            if msg["type"] == "http.request":
                size += len(msg.get("body", b""))
                if size > self.limit:
                    return await _reply_413(send)
                chunks.append(msg)
                if not msg.get("more_body"):
                    break
            else:
                chunks.append(msg)
                break
        it = iter(chunks)

        async def replay():
            try:
                return next(it)
            except StopIteration:
                return await receive()
        return await self.app(scope, replay, send)


async def _reply_413(send):
    body = b'{"detail":"request too large"}'
    await send({"type": "http.response.start", "status": 413, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
    await send({"type": "http.response.body", "body": body})
