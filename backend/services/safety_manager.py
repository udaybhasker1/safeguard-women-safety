from models.anomaly_detector import AnomalyDetector


def risk_from_probability(p):
    if p >= 0.8:
        return "HIGH"
    if p >= 0.5:
        return "MEDIUM"
    return "LOW"


class SafetyManager:
    """Detection + escalation. Escalation level is tracked per user."""

    def __init__(self):
        self.detector = AnomalyDetector()
        self.levels = {}

    def level_for(self, user_id):
        return self.levels.get(user_id, 0)

    def analyze(self, sensor_data, user_id=0):
        probability = self.detector.probability(
            sensor_data["heart_rate"],
            sensor_data["acceleration"],
            sensor_data["movement"],
            sensor_data["speed"],
        )

        anomaly = probability >= 0.5
        risk = risk_from_probability(probability)

        if not anomaly:
            self.levels[user_id] = 0

            return {
                "anomaly": False,
                "risk": "LOW",
                "level": 0,
                "probability": round(probability, 2),
                "message": "Everything looks normal.",
            }

        self.levels[user_id] = 2 if risk == "HIGH" else 1

        return {
            "anomaly": True,
            "risk": risk,
            "level": self.levels[user_id],
            "probability": round(probability, 2),
            "message": "Unusual activity detected. Please confirm your safety.",
        }

    def process_response(self, response, user_id=0):
        response = response.lower()
        level = self.level_for(user_id)

        if response == "yes":
            self.levels[user_id] = 0

            return {
                "status": "safe",
                "level": 0,
                "message": "You are marked as safe.",
            }

        if response in ("no", "timeout"):
            level += 1

        if level >= 2:
            self.levels[user_id] = 2

            return {
                "status": "emergency",
                "level": 2,
                "message": "Emergency escalation activated.",
            }

        self.levels[user_id] = level

        if level == 1:
            return {
                "status": "escalation",
                "level": 1,
                "message": "Level 1 alert. Please confirm your safety.",
            }

        return {
            "status": "monitoring",
            "level": 0,
            "message": "Monitoring continues.",
        }
