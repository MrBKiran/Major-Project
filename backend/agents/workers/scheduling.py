"""Scheduling Worker Agent – finds and holds service slots."""
from datetime import datetime, timedelta


def run(vin: str, ce_result: dict) -> dict:
    if ce_result.get("status") != "BOOKED":
        return {"status": "DECLINED", "vin": vin}

    # Mock available slots
    slots = [
        {
            "slot_id": "S001",
            "center": "Mahindra Service – Koramangala",
            "date": (datetime.utcnow() + timedelta(days=2)).strftime("%Y-%m-%d"),
            "time": "10:00 AM",
            "available": True,
        },
        {
            "slot_id": "S002",
            "center": "Mahindra Service – Whitefield",
            "date": (datetime.utcnow() + timedelta(days=3)).strftime("%Y-%m-%d"),
            "time": "02:00 PM",
            "available": True,
        },
    ]

    selected = slots[0]
    return {
        "status": "CONFIRMED",
        "vin": vin,
        "appointment_id": f"APPT_{vin}_001",
        "slot": selected,
        "held": True,
        "show_card_on_park": True,
    }
