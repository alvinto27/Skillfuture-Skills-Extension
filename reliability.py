import asyncio
import copy
import json
import logging
import threading
import time
from collections import OrderedDict, deque
from uuid import uuid4


logger = logging.getLogger("skillsfuture.api")


class TTLCache:
    def __init__(self, max_size=256, ttl_seconds=900):
        self.max_size = max(int(max_size), 1)
        self.ttl_seconds = max(float(ttl_seconds), 0.001)
        self._items = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key):
        now = time.monotonic()
        with self._lock:
            item = self._items.get(key)
            if item is None:
                return None
            expires_at, value = item
            if expires_at <= now:
                self._items.pop(key, None)
                return None
            self._items.move_to_end(key)
            return copy.deepcopy(value)

    def set(self, key, value):
        with self._lock:
            self._items[key] = (
                time.monotonic() + self.ttl_seconds,
                copy.deepcopy(value),
            )
            self._items.move_to_end(key)
            while len(self._items) > self.max_size:
                self._items.popitem(last=False)

    def clear(self):
        with self._lock:
            self._items.clear()

    def __len__(self):
        with self._lock:
            return len(self._items)


class SlidingWindowRateLimiter:
    def __init__(self, limit=30, window_seconds=60):
        self.limit = max(int(limit), 1)
        self.window_seconds = max(float(window_seconds), 1.0)
        self._requests = {}
        self._lock = threading.Lock()

    def check(self, key):
        now = time.monotonic()
        cutoff = now - self.window_seconds
        with self._lock:
            timestamps = self._requests.setdefault(key, deque())
            while timestamps and timestamps[0] <= cutoff:
                timestamps.popleft()
            if len(timestamps) >= self.limit:
                retry_after = max(int(self.window_seconds - (now - timestamps[0])) + 1, 1)
                return False, retry_after
            timestamps.append(now)
            return True, 0


async def run_with_timeout(function, *args, timeout_seconds=30, **kwargs):
    return await asyncio.wait_for(
        asyncio.to_thread(function, *args, **kwargs),
        timeout=float(timeout_seconds),
    )


def request_id():
    return uuid4().hex


def log_event(event, **fields):
    payload = {"event": event, **fields}
    logger.info(json.dumps(payload, ensure_ascii=True, sort_keys=True, default=str))
