# SPDX-FileCopyrightText: Copyright (C) Arduino s.r.l. and/or its affiliated companies
#
# SPDX-License-Identifier: MPL-2.0

import json
from datetime import datetime
import paho.mqtt.client as mqtt
from arduino.app_utils import *
from arduino.app_bricks.web_ui import WebUI
from arduino.app_bricks.vibration_anomaly_detection import VibrationAnomalyDetection

logger = Logger("vibration-detector")

# --- MQTT Configuration ---
MQTT_BROKER    = "test.mosquitto.org"
MQTT_PORT      = 1883
MQTT_TOPIC     = "qsense/machine/monitoring"  # outbound: anomaly alerts
MQTT_ACK_TOPIC = "qsense/machine/ack"         # bidirectional: resolved=0 / resolved=1

# --- Machine / Part Info ---
MACHINE_NO = "M-01"
PART_NAME  = "Fan-Motor"
PART_NO    = "PN-001"

# Fixed alert ID for this machine — used in every alert and ack message.
# To resolve: mosquitto_pub -h test.mosquitto.org -t qsense/machine/ack
#             -m '{"alertId": "M-01", "resolved": 1}'
ALERT_ID = "M-01"

CRITICAL_SCORE_THRESHOLD = 5.0  # matches the UI critical boundary


# ---------------------------------------------------------------------------
# Persistent MQTT client — stays connected so we can subscribe to ack topic
# ---------------------------------------------------------------------------

def _on_connect(client, userdata, flags, reason_code, properties):
    if reason_code == 0:
        client.subscribe(MQTT_ACK_TOPIC, qos=1)
        logger.info(f"MQTT connected — subscribed to '{MQTT_ACK_TOPIC}'")
    else:
        logger.warning(f"MQTT connect failed: reason_code={reason_code}")


def _on_message(client, userdata, msg):
    """Handle incoming messages on qsense/machine/ack."""
    try:
        payload = json.loads(msg.payload.decode())
    except Exception:
        return

    if payload.get("alertId") != ALERT_ID:
        return

    if payload.get("resolved") == 1:
        logger.info(f"Alert {ALERT_ID} acknowledged — stopping LED animation, restarting machine")
        ui.send_message('machine_resolved', {})
        try:
            Bridge.call("stop_alert_animation")
        except Exception as exc:
            logger.warning(f"stop_alert_animation failed: {exc}")


mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
mqtt_client.on_connect = _on_connect
mqtt_client.on_message = _on_message

try:
    mqtt_client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
    mqtt_client.loop_start()   # background thread — handles sends, receives, and keepalive
except Exception as exc:
    logger.warning(f"MQTT initial connect failed (will retry on reconnect): {exc}")


def _mqtt_publish(topic: str, payload: dict):
    try:
        mqtt_client.publish(topic, json.dumps(payload), qos=1)
        logger.info(f"MQTT → '{topic}': {payload}")
    except Exception as exc:
        logger.warning(f"MQTT publish failed: {exc}")


# ---------------------------------------------------------------------------
# Vibration anomaly detection
# ---------------------------------------------------------------------------

vibration_detection = VibrationAnomalyDetection(anomaly_detection_threshold=1.0)

ui = WebUI()


def on_override_th(value: float):
    try:
        vibration_detection.anomaly_detection_threshold = value
    except ValueError as exc:
        logger.warning(f"Ignoring invalid anomaly threshold {value!r}: {exc}")
        return
    logger.info(f"New anomaly threshold: {vibration_detection.anomaly_detection_threshold}")


ui.on_message("override_th", lambda sid, threshold: on_override_th(threshold))


def on_detected_anomaly(anomaly_score: float, classification: dict):
    timestamp = datetime.now().isoformat()

    # Push event to dashboard
    ui.send_message('anomaly_detected', json.dumps({"score": anomaly_score, "timestamp": timestamp}))
    ui.send_message('fan_status_update', {"anomaly": True, "status_text": "Anomaly detected!"})

    # Publish full anomaly alert to monitoring topic
    _mqtt_publish(MQTT_TOPIC, {
        "alertId":   ALERT_ID,
        "machineNo": MACHINE_NO,
        "partName":  PART_NAME,
        "partNo":    PART_NO,
        "severity":  round(anomaly_score, 4),
        "timestamp": timestamp,
    })

    if anomaly_score >= CRITICAL_SCORE_THRESHOLD:
        # Publish unresolved ack so downstream subscribers know alert is active
        _mqtt_publish(MQTT_ACK_TOPIC, {"alertId": ALERT_ID, "resolved": 0})

        # Start LED alert animation — stays on until resolved=1 arrives on ack topic
        try:
            Bridge.call("start_alert_animation")
        except Exception as exc:
            logger.warning(f"start_alert_animation failed: {exc}")

        # Fire 3-second buzzer alarm
        try:
            Bridge.call("trigger_alert_buzzer")
            logger.info(f"Critical alert [{ALERT_ID}] — buzzer + LED animation started (score: {anomaly_score:.2f})")
        except Exception as exc:
            logger.warning(f"trigger_alert_buzzer failed: {exc}")


vibration_detection.on_anomaly(on_detected_anomaly)


# ---------------------------------------------------------------------------
# Bridge RPC providers (sketch → Python)
# ---------------------------------------------------------------------------

def record_sensor_movement(x: float, y: float, z: float):
    x_ms2 = x * 9.81
    y_ms2 = y * 9.81
    z_ms2 = z * 9.81
    ui.send_message('sample', {'x': x_ms2, 'y': y_ms2, 'z': z_ms2})
    vibration_detection.accumulate_samples((x_ms2, y_ms2, z_ms2))


Bridge.provide("record_sensor_movement", record_sensor_movement)


def record_sensor_samples(celsius: float, humidity: float):
    if celsius is None or humidity is None:
        return
    ts = int(datetime.now().timestamp() * 1000)
    ui.send_message('temperature', {"value": round(float(celsius), 2), "ts": ts})
    ui.send_message('humidity',    {"value": round(float(humidity), 2), "ts": ts})


Bridge.provide("record_sensor_samples", record_sensor_samples)

App.run()
