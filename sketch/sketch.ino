// SPDX-FileCopyrightText: Copyright (C) Arduino s.r.l. and/or its affiliated companies
//
// SPDX-License-Identifier: MPL-2.0

#include <Arduino_RouterBridge.h>
#include <Arduino_Modulino.h>

ModulinoMovement movement;
ModulinoThermo   thermo;
ModulinoBuzzer   buzzer;

float x_accel, y_accel, z_accel;

unsigned long previousMillis = 0;
const long interval = 16;         // 62.5 Hz for anomaly detection model
int has_movement = 0;

unsigned long previousMillisThermo = 0;
const long intervalThermo = 1000; // 1 Hz for temperature/humidity

// Called by Python via Bridge.call() when a critical anomaly is detected.
// Plays one long 3-second loud alarm tone.
void triggerAlertBuzzer() {
  buzzer.tone(1000, 3000); // 1 kHz — loud and clear for 3 seconds
}

void setup() {
  Bridge.begin();

  Modulino.begin(Wire1);

  while (!movement.begin()) {
    delay(1000);
  }
  thermo.begin();
  buzzer.begin();

  // Register buzzer handler so Python can call it remotely
  Bridge.provide("trigger_alert_buzzer", triggerAlertBuzzer);
}

void loop() {
  unsigned long currentMillis = millis();

  // Accelerometer — 62.5 Hz
  if (currentMillis - previousMillis >= interval) {
    previousMillis = currentMillis;
    has_movement = movement.update();
    if (has_movement == 1) {
      x_accel = movement.getX();
      y_accel = movement.getY();
      z_accel = movement.getZ();
      Bridge.notify("record_sensor_movement", x_accel, y_accel, z_accel);
    }
  }

  // Temperature & Humidity — 1 Hz
  if (currentMillis - previousMillisThermo >= intervalThermo) {
    previousMillisThermo = currentMillis;
    float celsius  = thermo.getTemperature();
    float humidity = thermo.getHumidity();
    Bridge.notify("record_sensor_samples", celsius, humidity);
  }
}
