"""Feedback Worker – collects CSAT/NPS post-service."""


def run(vin: str) -> dict:
    return {
        "status": "PENDING_FEEDBACK",
        "vin": vin,
        "questions": [
            {"id": "q1", "text": "Service ke baad car kaisi chal rahi hai? (1–5)", "type": "rating"},
            {"id": "q2", "text": "Kya aap apne doston ko yeh service recommend karenge? (0–10)", "type": "nps"},
            {"id": "q3", "text": "Koi aur baat?", "type": "text"},
        ],
    }
