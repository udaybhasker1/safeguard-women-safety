import random


def generate_normal_data():

    return {
        "heart_rate": random.randint(65, 95),
        "acceleration": round(random.uniform(0.5, 1.5), 2),
        "movement": round(random.uniform(0.5, 1.5), 2),
        "speed": round(random.uniform(0, 8), 2)
    }


def generate_anomaly_data():

    return {
        "heart_rate": random.randint(150, 180),
        "acceleration": round(random.uniform(3, 5), 2),
        "movement": round(random.uniform(3, 5), 2),
        "speed": round(random.uniform(15, 30), 2)
    }
