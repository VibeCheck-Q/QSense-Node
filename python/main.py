# SPDX-FileCopyrightText: Copyright (C) Arduino s.r.l. and/or its affiliated companies
#
# SPDX-License-Identifier: MPL-2.0

import json
import uuid
from datetime import datetime
import paho.mqtt.client as mqtt
from arduino.app_utils import *
from arduino.app_bricks.web_ui import WebUI
from arduino.app_bricks.vibration_anomaly_detection import VibrationAnomalyDetection

logger = Logger("vibration-detector")

# --- MQTT Configuration ---
MQTT_BROKER = "test.mosquitto.org"
MQTT_PORT   = 1883
MQTT_TOPIC  = "qsense/machine/monitoring"

# --- Machine / Part Info ---
MACHINE_NO = "M-01"
PART_NAME  = "Fan-Motor"
PART_NO    = "PN-001"


def publish_mqtt_alert(severity: float, timestamp: str):
    payload = {
        "alertId":   str(uuid.uuid4()),
        "machineNo": MACHINE_NO,
        "partName":  PART_NAME,
        "partNo":    PART_NO,
        "severity":  round(severity, 4),
        "timestamp": timestamp,
    }
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    try:
        client.connect(MQTT_BROKER, MQTT_PORT, keepalive=5)
        client.publish(MQTT_TOPIC, json.dumps(payload), qos=1)
        client.disconnect()
        logger.info(f"MQTT alert published to '{MQTT_TOPIC}': {payload}")
    except Exception as exc:
        logger.warning(f"MQTT publish failed: {exc}")

vibration_detection = VibrationAnomalyDetection(anomaly_detection_threshold=1.0)

def on_override_th(value: float):
    try:
        vibration_detection.anomaly_detection_threshold = value
    except ValueError as exc:
        logger.warning(f"Ignoring invalid anomaly threshold {value!r}: {exc}")
        return

    logger.info(f"Setting new anomaly threshold: {vibration_detection.anomaly_detection_threshold}")

ui = WebUI()
ui.on_message("override_th", lambda sid, threshold: on_override_th(threshold))

def get_fan_status(anomaly_detected: bool):
    return {
        "anomaly": anomaly_detected,
        "status_text": "Anomaly detected!" if anomaly_detected else "No anomaly"
    }

CRITICAL_SCORE_THRESHOLD = 5.0  # matches the UI critical boundary

# Register action to take after successful detection
def on_detected_anomaly(anomaly_score: float, classification: dict):
    timestamp = datetime.now().isoformat()
    anomaly_payload = {
        "score": anomaly_score,
        "timestamp": timestamp
    }
    ui.send_message('anomaly_detected', json.dumps(anomaly_payload))
    ui.send_message('fan_status_update', get_fan_status(True))
    publish_mqtt_alert(anomaly_score, timestamp)

    # Trigger 3-beep buzzer alert on the board for critical anomalies
    if anomaly_score >= CRITICAL_SCORE_THRESHOLD:
        try:
            Bridge.call("trigger_alert_buzzer")
            logger.info(f"Buzzer triggered — critical anomaly score: {anomaly_score:.2f}")
        except Exception as exc:
            logger.warning(f"Buzzer trigger failed: {exc}")

vibration_detection.on_anomaly(on_detected_anomaly)

def record_sensor_movement(x: float, y: float, z: float):
    # Convert g -> m/s^2 for the detector
    x_ms2 = x * 9.81
    y_ms2 = y * 9.81
    z_ms2 = z * 9.81

    # Forward raw data to UI for plotting
    ui.send_message('sample', {'x': x_ms2, 'y': y_ms2, 'z': z_ms2})

    # Forward samples to the vibration_detection brick
    vibration_detection.accumulate_samples((x_ms2, y_ms2, z_ms2))

# Register the Bridge RPC provider so the sketch can call into Python
Bridge.provide("record_sensor_movement", record_sensor_movement)


def record_sensor_samples(celsius: float, humidity: float):
    if celsius is None or humidity is None:
        return

    ts = int(datetime.now().timestamp() * 1000)
    ui.send_message('temperature', {"value": round(float(celsius), 2), "ts": ts})
    ui.send_message('humidity',    {"value": round(float(humidity), 2), "ts": ts})


Bridge.provide("record_sensor_samples", record_sensor_samples)

App.run()
