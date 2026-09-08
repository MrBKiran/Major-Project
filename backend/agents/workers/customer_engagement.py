"""Customer Engagement Worker – voice/text conversation with driver."""


DEMO_SCRIPT = [
    {
        "role": "assistant",
        "text": "Ramesh ji, aapki Bolero ka coolant temperature pichhle 6 dinon se badh raha hai.",
        "audio_key": "ce_line_1",
    },
    {
        "role": "user",
        "text": "Car theek chal rahi hai.",
        "audio_key": None,
    },
    {
        "role": "assistant",
        "text": "Is trend se water pump mein problem ho sakti hai. Breakdown se pehle check karwa lete hain.",
        "audio_key": "ce_line_2",
    },
    {
        "role": "user",
        "text": "Haan, book kar do.",
        "audio_key": None,
    },
]


def run(vin: str, diagnosis: dict, demo_mode: bool = True) -> dict:
    if not diagnosis.get("component"):
        return {"status": "NO_ACTION", "vin": vin}

    return {
        "status": "BOOKED",
        "vin": vin,
        "booking_intent": True,
        "conversation": DEMO_SCRIPT,
        "customer_language": "hi",
        "drive_state_safe": True,
    }
