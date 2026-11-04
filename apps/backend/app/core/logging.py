import json
import logging
from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Any

request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        request_id = getattr(record, "request_id", None) or request_id_var.get()
        if request_id:
            payload["request_id"] = request_id
        for field in ("dependency", "error_code"):
            value = getattr(record, field, None)
            if value is not None:
                payload[field] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=True)


class StructuredStreamHandler(logging.StreamHandler[Any]):
    pass


def configure_logging(level: str) -> None:
    root_logger = logging.getLogger()
    handler = next(
        (
            configured_handler
            for configured_handler in root_logger.handlers
            if isinstance(configured_handler, StructuredStreamHandler)
        ),
        None,
    )
    if handler is None:
        handler = StructuredStreamHandler()
        root_logger.addHandler(handler)
    handler.setFormatter(JsonFormatter())
    root_logger.setLevel(level)
