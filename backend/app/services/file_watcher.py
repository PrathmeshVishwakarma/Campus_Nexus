"""watchdog wrapper — FS change -> callback."""

from pathlib import Path

from watchdog.events import FileSystemEventHandler
from watchdog.observers import Observer


class _Handler(FileSystemEventHandler):
    def __init__(self, on_change):
        self.on_change = on_change

    def on_created(self, e):
        if not e.is_directory:
            self.on_change("FILE_CREATED", e.src_path)

    def on_modified(self, e):
        if not e.is_directory:
            self.on_change("FILE_MODIFIED", e.src_path)

    def on_deleted(self, e):
        if not e.is_directory:
            self.on_change("FILE_DELETED", e.src_path)


def start_watcher(folder: str | Path, on_change) -> Observer:
    folder = str(folder)
    Path(folder).mkdir(parents=True, exist_ok=True)
    obs = Observer()
    obs.schedule(_Handler(on_change), folder, recursive=True)
    obs.start()
    return obs
