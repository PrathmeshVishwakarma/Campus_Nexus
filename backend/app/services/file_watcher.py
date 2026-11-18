"""watchdog wrapper — FS change -> callback, restartable when the root moves.

* Echoes of writes made by the API itself are ignored (storage.suppress_watcher),
  so an upload produces one event, not two.
* Bursts of identical notifications (editors fire several on_modified per save)
  are debounced per path.
"""

import threading
import time
from pathlib import Path

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer

from app.services.storage import is_suppressed

DEBOUNCE_S = 1.0


class _Handler(FileSystemEventHandler):
    def __init__(self, on_change):
        self.on_change = on_change
        self._last: dict[tuple[str, str], float] = {}
        self._lock = threading.Lock()

    def _emit(self, etype: str, path: str):
        if is_suppressed(path):
            return
        now = time.time()
        with self._lock:
            key = (etype, path)
            if now - self._last.get(key, 0) < DEBOUNCE_S:
                return
            self._last[key] = now
            if len(self._last) > 5000:
                self._last = {k: t for k, t in self._last.items() if now - t < DEBOUNCE_S}
        self.on_change(etype, path)

    def on_created(self, e):
        if not e.is_directory:
            self._emit("FILE_CREATED", e.src_path)

    def on_modified(self, e):
        if not e.is_directory:
            self._emit("FILE_MODIFIED", e.src_path)

    def on_deleted(self, e):
        if not e.is_directory:
            self._emit("FILE_DELETED", e.src_path)

    def on_moved(self, e):
        if not e.is_directory:
            self._emit("FILE_DELETED", e.src_path)
            self._emit("FILE_CREATED", e.dest_path)


class WatcherManager:
    def __init__(self):
        self._obs: Observer | None = None
        self._lock = threading.Lock()
        self.folder: Path | None = None
        self._on_change = None

    def start(self, folder: str | Path, on_change):
        with self._lock:
            self._on_change = on_change
            self._start_locked(Path(folder))

    def restart(self, folder: str | Path):
        with self._lock:
            if self._on_change is None:
                return
            self._stop_locked()
            self._start_locked(Path(folder))

    def stop(self):
        with self._lock:
            self._stop_locked()

    def _start_locked(self, folder: Path):
        folder.mkdir(parents=True, exist_ok=True)
        obs = Observer()
        obs.schedule(_Handler(self._on_change), str(folder), recursive=True)
        obs.daemon = True
        obs.start()
        self._obs, self.folder = obs, folder

    def _stop_locked(self):
        if self._obs is not None:
            try:
                self._obs.stop()
                self._obs.join(timeout=2)
            except Exception:
                pass
        self._obs = None


watcher = WatcherManager()


def start_watcher(folder: str | Path, on_change):
    watcher.start(folder, on_change)
    return watcher
