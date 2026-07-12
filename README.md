# QSense Node — Machine Monitor

> Part of **QSense Factory** · Snapdragon Multiverse Hackathon  
> Stage: **Detect** — the first node in the `Detect → Alert → Diagnose → Resolve` closed loop.

![Dashboard Screenshot](assets/docs_assets/dashboard-preview.png)

---

## What is QSense Factory?

QSense Factory is a **privacy-first, distributed edge-AI system** built for MSME manufacturers who can't afford to replace legacy machinery or send proprietary data to the cloud.

The system spans three devices that form a **closed loop** — not a one-way handoff:

| Device | Role | Stage |
|---|---|---|
| **Arduino UNO Q** (this repo) | Magnetically attaches to motors; continuously monitors vibration offline | Detect |
| **Snapdragon Copilot+ PC** | Receives anomaly alerts, logs events, pushes to mobile; also runs NPU-accelerated PPE detection | Alert |
| **Technician Mobile Device** | Receives alerts; locally runs a vision-language model for repair guidance from a photo | Diagnose → Resolve |

When the technician resolves the issue, the mobile device **signals back** through the PC to clear the dashboard and **reset the Arduino's baseline** — completing the cycle.

The result: a full factory AI assistant that catches problems early, explains how to fix them, and runs **entirely on-premises** — no internet required at any stage.

---

## This Repo — QSense Node

This repository contains the **Arduino UNO Q node** — the Detect stage. It retrofits existing motors with a magnetically-attached sensor that continuously monitors vibration for early signs of failure, entirely offline.

### What it does

- Reads raw accelerometer data (X, Y, Z axes) from a **Modulino Movement** sensor at 62.5 Hz
- Reads **temperature and humidity** from a **Modulino Thermo** sensor at 1 Hz
- Runs a **vibration anomaly detection** model locally on the board
- Streams live vibration and environment data to a real-time web dashboard
- Fires an alert (with anomaly score + timestamp) when vibration deviates from the learned baseline
- Publishes a structured **MQTT alert** (`machine/anomaly` topic) on every anomaly event
- Triggers a **3-second buzzer alarm** via Modulino Buzzer when the anomaly score exceeds the critical threshold (≥ 5.0)
- Accepts dynamic **threshold adjustments** from the dashboard without restarting
- Exposes a **reset endpoint** so the Copilot+ PC can reset the baseline once a repair is confirmed

### App Flow

```
┌──────────────────────────────────────────────────────────────────────┐
│                          Arduino UNO Q                               │
│                                                                      │
│  ┌─ Modulino Movement ─┐   62.5 Hz    ┌─────────────────────────┐   │
│  │  X / Y / Z accel    │──Bridge.notify─►  record_sensor_movement │   │
│  └─────────────────────┘              │  • g → m/s² conversion   │   │
│                                       │  • WebUI: live plot       │   │
│  ┌─ Modulino Thermo ───┐    1 Hz      │  • VibrationAnomalyDetect │   │
│  │  Temperature        │──Bridge.notify─►  record_sensor_samples  │   │
│  │  Humidity           │              │  • WebUI: temp / humidity │   │
│  └─────────────────────┘              └────────────┬────────────┘   │
│                                                    │                 │
│                                         on_detected_anomaly()        │
│                                                    │                 │
│                              ┌─────────────────────┼──────────────┐ │
│                              │  score < 5.0         │  score ≥ 5.0 │ │
│                              ▼                      ▼              │ │
│                         ⚠️ ANOMALY            🔴 CRITICAL          │ │
│                         WebUI badge           WebUI badge          │ │
│                         MQTT publish          MQTT publish         │ │
│                                               Bridge.call ──────► │ │
│                                               Modulino Buzzer      │ │
│                                               3-sec alarm tone     │ │
│                              └──────────────────────────────────┘  │ │
└──────────────────────────────────────────────────────────────────────┘
                    │ MQTT
                    ▼
           broker (machine/anomaly)
           {alertId, machineNo, partName, partNo, severity, timestamp}
                    │
                    ▼
           Copilot+ PC / any MQTT subscriber
```

### MQTT Alert Payload

Every anomaly (regardless of severity) publishes to `machine/anomaly`:

```json
{
  "alertId":   "a3f1c842-...",
  "machineNo": "M-01",
  "partName":  "Fan Motor",
  "partNo":    "PN-001",
  "severity":  1.2345,
  "timestamp": "2026-07-12T01:20:30.123456"
}
```

Configure broker, topic, and machine details at the top of `python/main.py`:

```python
MQTT_BROKER = "localhost"
MQTT_PORT   = 1883
MQTT_TOPIC  = "machine/anomaly"
MACHINE_NO  = "M-01"
PART_NAME   = "Fan Motor"
PART_NO     = "PN-001"
```

### Machine Control (Emergency Stop)

On a critical anomaly the machine is **automatically stopped** via two GPIO pins wired to the machine's motor driver. It restarts only when the alert is acknowledged.

| Pin | Role |
|---|---|
| `D9` (`MACHINE_PIN_A`) | Direction / enable A |
| `D10` (`MACHINE_PIN_B`) | Direction / enable B |

```cpp
// Machine running (normal operation)
digitalWrite(9, HIGH);
digitalWrite(10, LOW);

// Machine stopped (critical anomaly)
digitalWrite(9, LOW);
digitalWrite(10, LOW);
```

Configure the pins at the top of `sketch/sketch.ino`:

```cpp
#define MACHINE_PIN_A 9
#define MACHINE_PIN_B 10
```

### Alarm Severity Levels

| Score | Status | Dashboard | Buzzer | LED Matrix | Machine | Recent Anomalies |
|---|---|---|---|---|---|---|
| — | ⏳ INITIALIZING | Grey | Silent | Off | Running | — |
| Any | 🟢 NOMINAL | Sage green | Silent | Off | Running | — |
| < 5.0 | ⚠️ ANOMALY DETECTED | Amber | Silent | Off | Running | `Anomaly` — normal style |
| ≥ 5.0 | 🔴 CRITICAL | Coral red | 3-sec 1 kHz tone | Blinking | **Stopped** | `🔴 CRITICAL` — bold red, red border |
| `resolved=1` received | 🟢 NOMINAL | Sage green | Silent | Off | **Restarted** | — |

---

## Hardware Requirements

| Component | Purpose | Quantity |
|---|---|---|
| Arduino UNO Q (or Arduino VENTUNO Q) | Main compute board | 1 |
| Modulino Movement (LSM6DSOX IMU) | Vibration / accelerometer | 1 |
| Modulino Thermo (HS300x) | Temperature + Humidity | 1 |
| Modulino Buzzer | Critical alarm output | 1 |
| Motor driver (e.g. L298N) | Machine emergency stop | 1 |
| Qwiic Cables | Sensor interconnect | 3 |
| USB-C to USB-A Cable | Power + serial | 1 |

Mount the Movement module magnetically onto the machine casing — no invasive modification required. The Thermo module can be placed nearby to monitor ambient conditions. The motor driver IN1/IN2 connects to pins D9/D10 on the UNO Q.

---

## Software Requirements

- **Arduino App Lab** — to deploy and run the app on the UNO Q
- No cloud account or internet connection needed at runtime

---

## Project Structure

```
qsense-node/
├── app.yaml              # App manifest (name, bricks, icon)
├── sketch/
│   ├── sketch.ino        # Arduino firmware — IMU read loop, Bridge.notify
│   └── sketch.yaml       # Board & library config
├── python/
│   └── main.py           # Python backend — anomaly detection, WebUI, Bridge RPC
└── assets/
    ├── index.html        # Dashboard — QSense Factory v2 design system
    ├── style.css         # QSense design tokens (Coral/Amber/Slate/Sage pipeline colours)
    ├── app.js            # Canvas chart, slider, anomaly list, feedback logic
    ├── img/              # Icons and logos
    ├── fonts/            # Local font files
    └── libs/             # socket.io, arduino.js
```

---

## CLI Quick Reference

The app ID is `user:qsense-machine-monitoring`.

| Action | Command |
|---|---|
| **Start** | `arduino-app-cli app start user:qsense-machine-monitoring` |
| **Stop** | `arduino-app-cli app stop user:qsense-machine-monitoring` |
| **Restart** *(after code changes)* | `arduino-app-cli app restart user:qsense-machine-monitoring` |
| **Watch live logs** | `arduino-app-cli app logs user:qsense-machine-monitoring` |
| **Check status of all apps** | `arduino-app-cli app list` |

> Add `-v` to any command for verbose output, e.g. `arduino-app-cli app start user:qsense-machine-monitoring -v`

---

## How to Run

1. **Connect hardware**  
   Plug the Modulino Movement and Modulino Thermo into the Arduino UNO Q via the Qwiic connector. Attach the Modulino Buzzer for critical alarm output.

2. **Start the app via CLI**  
   ```bash
   arduino-app-cli app start user:qsense-machine-monitoring
   ```

3. **Open the dashboard**  
   Navigate to `http://<UNO-Q-IP-ADDRESS>:7000` from any browser on the same network.

4. **Monitor**  
   The **Machine Faults** chart shows live X/Y/Z vibration waveforms. The **Environment** row shows live Temperature and Humidity from the Thermo module.

5. **Tune sensitivity**  
   Use the **Anomaly Threshold** slider.  
   - Lower → more sensitive (small deviations trigger alerts)  
   - Higher → less sensitive (only strong deviations trigger alerts)  
   - The value is a raw anomaly score, not a 0–1 confidence.  
   - Use the numeric input for scores above the slider range (>20).

6. **Trigger a test anomaly**  
   Shake the sensor by hand. The **Machine Status** panel will switch to ⚠️ ANOMALY DETECTED and log it in **Recent Anomalies** with a score and timestamp. If the score exceeds **5.0** (Critical):
   - Status locks to 🔴 **CRITICAL — Machine stopped. Awaiting resolve.**
   - Buzzer fires a 3-second alarm tone
   - LED matrix starts blinking
   - Machine output (pins D9/D10) is cut

7. **Resolve a critical alert**  
   Once the repair is done, publish the resolve command from any MQTT client on the network:
   ```bash
   mosquitto_pub -h "test.mosquitto.org" -t "qsense/machine/ack" \
     -m '{"alertId": "M-01", "resolved": 1}'
   ```
   This will:
   - Return the dashboard to 🟢 **NOMINAL — All systems operating normally**
   - Turn off the LED matrix
   - Restart the machine (pins D9/D10)

---

## How it Works

### Firmware — `sketch.ino`

Runs two independent timed loops:

- **62.5 Hz** — reads X/Y/Z from the LSM6DSOX IMU → `Bridge.notify("record_sensor_movement")`
- **1 Hz** — reads temperature + humidity from the HS300x → `Bridge.notify("record_sensor_samples")`
- Registers `triggerAlertBuzzer()`, `startAlertAnimation()`, and `stopAlertAnimation()` as Bridge-callables so Python can control buzzer, LED matrix, and machine output remotely
- Machine output (D9/D10) defaults to **ON** at boot; cut immediately on critical anomaly, restored on resolve

```cpp
// Accelerometer — 62.5 Hz
if (currentMillis - previousMillis >= interval) {
  has_movement = movement.update();
  if (has_movement == 1)
    Bridge.notify("record_sensor_movement", movement.getX(), movement.getY(), movement.getZ());
}

// Temperature & Humidity — 1 Hz
if (currentMillis - previousMillisThermo >= intervalThermo) {
  Bridge.notify("record_sensor_samples", thermo.getTemperature(), thermo.getHumidity());
}

// Buzzer handler — called by Python on critical anomaly
void triggerAlertBuzzer() {
  buzzer.tone(1000, 3000); // 1 kHz for 3 seconds
}
```

### Backend — `main.py`

**Vibration path** — receives IMU data, converts g → m/s², feeds the anomaly detection brick, and pushes the live waveform to the dashboard:

```python
def record_sensor_movement(x, y, z):
    x_ms2, y_ms2, z_ms2 = x * 9.81, y * 9.81, z * 9.81
    ui.send_message('sample', {'x': x_ms2, 'y': y_ms2, 'z': z_ms2})
    vibration_detection.accumulate_samples((x_ms2, y_ms2, z_ms2))
```

**Environment path** — receives temperature and humidity, forwards to dashboard:

```python
def record_sensor_samples(celsius, humidity):
    ts = int(datetime.now().timestamp() * 1000)
    ui.send_message('temperature', {"value": round(celsius, 2), "ts": ts})
    ui.send_message('humidity',    {"value": round(humidity, 2), "ts": ts})
```

**Anomaly path** — on every detected anomaly:
1. Pushes the event to the dashboard (score + timestamp)
2. Publishes a structured MQTT alert to `qsense/machine/monitoring`
3. If score ≥ 5.0 (Critical):
   - Publishes `{"alertId": "M-01", "resolved": 0}` to `qsense/machine/ack`
   - Calls `Bridge.call("start_alert_animation")` → LED matrix blinks, machine stops
   - Calls `Bridge.call("trigger_alert_buzzer")` → 3-second alarm tone

**Resolve path** — when `{"alertId": "M-01", "resolved": 1}` arrives on `qsense/machine/ack`:
1. Sends `machine_resolved` WebUI event → dashboard returns to 🟢 NOMINAL
2. Calls `Bridge.call("stop_alert_animation")` → LED off, machine restarts

**Threshold control** — slider changes arrive as WebUI messages and apply immediately without restart:

```python
def on_override_th(value):
    vibration_detection.anomaly_detection_threshold = value
```

### Dashboard — `index.html` + `app.js`

Built with the **QSense Factory design system (v2 — light/minimal)**:

| Section | Content |
|---|---|
| **Stats bar** | Machine ID · Placement · Run-time · Last Anomaly · Live Date & Time |
| **Machine Faults** | Full-width live X/Y/Z waveform (HTML5 Canvas, 200 pts rolling) |
| **Machine Status** | Industrial badge — 🟢 NOMINAL / ⚠️ ANOMALY / 🔴 CRITICAL (locked until resolved=1) |
| **Anomaly Threshold** | Pill slider (0–20+) with live numeric input and reset |
| **Recent Anomalies** | Last 5 events — score, label, timestamp (scrollable); critical entries shown in bold red with 🔴 CRITICAL label |
| **Temperature** | Live big-number display + Chart.js sparkline |
| **Humidity** | Live big-number display + Chart.js sparkline |

Design tokens: Coral `#EA6F56` · Amber `#F0B94D` · Slate `#445067` · Sage `#6FA980`  
Fonts: **Clash Display** (headlines, scores) · **Satoshi** (body, labels)

---

## The Closed Loop

```
Arduino UNO Q          Copilot+ PC            Mobile Device
─────────────          ───────────            ─────────────
Detect anomaly  ──►   Log + push alert  ──►  Receive alert
                                              Photograph component
                                              VLM generates repair steps
                       Clear dashboard  ◄──  Mark resolved
Reset baseline  ◄──   Signal reset
```

Every node is necessary. The three devices don't hand off once — they form an actual **closed cycle** from detection to resolution.

---

## License

SPDX-FileCopyrightText: Copyright (C) Arduino s.r.l. and/or its affiliated companies  
SPDX-License-Identifier: MPL-2.0
