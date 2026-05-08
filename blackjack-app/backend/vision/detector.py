"""
YOLOv8-baserad kortdetektion.

Placera den tränade modellen som best.pt i denna mapp (backend/vision/best.pt).
Modellen förväntas vara en YOLOv8-modell tränad på blackjack-kort med klassnamn
i formatet '<rank>-<suit>' (t.ex. 'k-h', '2-r') plus en klass 'back' för
nervända kort.
"""

import time
from pathlib import Path

_MODEL      = None
_MODEL_PATH = Path(__file__).parent / "best.pt"


def load_model():
    global _MODEL
    if _MODEL is not None:
        return _MODEL
    if not _MODEL_PATH.exists():
        raise FileNotFoundError(
            f"Modell saknas: {_MODEL_PATH}\n"
            "Kopiera den tränade YOLOv8-vikten som backend/vision/best.pt"
        )
    from ultralytics import YOLO
    _MODEL = YOLO(str(_MODEL_PATH))
    print(f"YOLO-modell laddad från {_MODEL_PATH}")
    return _MODEL


def detect(image, conf=0.5, iou=0.5, imgsz=416):
    """
    Kör inferens på en PIL-bild.

    Returnerar:
        {
            "detections": [
                {
                    "class": str,
                    "confidence": float,
                    "box": {"x1", "y1", "x2", "y2"},
                    "center": {"x", "y"}
                },
                ...
            ],
            "image_size": {"width": int, "height": int},
            "inference_time_ms": float
        }
    """
    model = load_model()

    t0 = time.perf_counter()
    results = model.predict(image, conf=conf, iou=iou, imgsz=imgsz, verbose=False)
    inference_ms = (time.perf_counter() - t0) * 1000

    detections = []
    for result in results:
        boxes   = result.boxes
        names   = result.names
        for box in boxes:
            cls_id  = int(box.cls[0])
            x1, y1, x2, y2 = (float(v) for v in box.xyxy[0])
            detections.append({
                "class":      names[cls_id],
                "confidence": round(float(box.conf[0]), 4),
                "box": {
                    "x1": round(x1, 1), "y1": round(y1, 1),
                    "x2": round(x2, 1), "y2": round(y2, 1),
                },
                "center": {
                    "x": round((x1 + x2) / 2, 1),
                    "y": round((y1 + y2) / 2, 1),
                },
            })

    return {
        "detections":       detections,
        "image_size":       {"width": image.width, "height": image.height},
        "inference_time_ms": round(inference_ms, 2),
    }
