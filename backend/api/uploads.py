"""Saving the multipart upload to disk before the UDP sender reads it."""

import os
import threading
import time
from urllib.parse import unquote

from fastapi import HTTPException, UploadFile

from udp import protocol


def _uploads_dir():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    d = os.path.join(root, "..", "transfers", "uploads")
    os.makedirs(d, exist_ok=True)
    return os.path.abspath(d)


def save_upload(file: UploadFile):
    """Write the multipart upload to a unique path under transfers/uploads.

    Returns ``(upload_path, safe_base_name, size)``. Raises HTTPException
    (400) when the selected file is empty (nothing to transfer).
    """
    name = unquote(file.filename or "")
    base = protocol.safe_filename(name)

    run_id = time.strftime("%H%M%S") + str(threading.get_ident())[-3:]
    upload_path = os.path.join(_uploads_dir(), f"{run_id}_{base}")
    size = 0
    with open(upload_path, "wb") as out:
        while True:
            chunk = file.file.read(65536)
            if not chunk:
                break
            size += len(chunk)
            out.write(chunk)

    if size == 0:
        os.remove(upload_path)
        raise HTTPException(status_code=400, detail="selected file is empty")
    return upload_path, base, size
