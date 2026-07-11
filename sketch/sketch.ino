// SPDX-FileCopyrightText: Copyright (C) Arduino s.r.l. and/or its affiliated companies
//
// SPDX-License-Identifier: MPL-2.0

#include <Arduino_RouterBridge.h>
#include <Arduino_Modulino.h>
#include <Arduino_LED_Matrix.h>

ModulinoMovement movement;
ModulinoThermo   thermo;
ModulinoBuzzer   buzzer;
Arduino_LED_Matrix matrix;

float x_accel, y_accel, z_accel;

unsigned long previousMillis = 0;
const long interval = 16;           // 62.5 Hz for anomaly detection model

int has_movement = 0;

unsigned long previousMillisThermo = 0;
const long intervalThermo = 1000;   // 1 Hz for temperature/humidity

// --- LED Alert Animation (critical anomaly indicator) ---
// Two-frame alternating pattern; stays active until Python receives ack resolved=1.

uint8_t Frame_1[104] = {
  7,7,7,7,7,0,0,0,7,7,7,7,7,
  7,7,7,7,0,7,7,7,0,7,7,7,7,
  7,7,7,0,7,7,0,7,7,0,7,7,7,
  7,7,7,0,7,7,7,7,7,0,7,7,7,
  7,7,7,0,7,7,0,7,7,0,7,7,7,
  7,7,7,0,7,7,0,7,7,0,7,7,7,
  7,7,7,7,0,7,7,7,0,7,7,7,7,
  7,7,7,7,7,0,0,0,7,7,7,7,7,
};

uint8_t Frame_2[104] = {
  0,0,0,0,0,7,7,7,0,0,0,0,0,
  0,0,0,0,7,0,0,0,7,0,0,0,0,
  0,0,0,7,0,0,7,0,0,7,0,0,0,
  0,0,0,7,0,0,0,0,0,7,0,0,0,
  0,0,0,7,0,0,7,0,0,7,0,0,0,
  0,0,0,7,0,0,7,0,0,7,0,0,0,
  0,0,0,0,7,0,0,0,7,0,0,0,0,
  0,0,0,0,0,7,7,7,0,0,0,0,0,
};

uint8_t blankFrame[104] = { 0 };   // all LEDs off

uint8_t* animation[] = { Frame_1, Frame_2 };
const int frameCount  = 2;

bool alertActive = false;
int  frameIndex  = 0;
unsigned long previousMillisAnim = 0;
const long    intervalAnim       = 500; // 2 Hz blink (500 ms per frame)

// Called by Python when a critical anomaly is first detected.
void startAlertAnimation() {
  alertActive = true;
  frameIndex  = 0;
  // backdate the timer so the first frame draws immediately on the next loop tick
  previousMillisAnim = millis() - intervalAnim;
}

// Called by Python when qsense/machine/ack receives resolved=1.
void stopAlertAnimation() {
  alertActive = false;
  matrix.draw(blankFrame); // turn off all LEDs
}

// Called by Python via Bridge.call() when a critical anomaly is detected.
// Plays one 3-second loud alarm tone.
void triggerAlertBuzzer() {
  buzzer.tone(1000, 3000); // 1 kHz for 3 seconds
}

void setup() {
  Bridge.begin();

  matrix.begin();
  matrix.setGrayscaleBits(3); // enable 0–7 brightness per pixel

  Modulino.begin(Wire1);

  while (!movement.begin()) {
    delay(1000);
  }
  thermo.begin();
  buzzer.begin();

  Bridge.provide("trigger_alert_buzzer",  triggerAlertBuzzer);
  Bridge.provide("start_alert_animation", startAlertAnimation);
  Bridge.provide("stop_alert_animation",  stopAlertAnimation);
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

  // LED alert animation — non-blocking 2 Hz blink
  // Continues until stopAlertAnimation() is called by Python.
  if (alertActive && (currentMillis - previousMillisAnim >= intervalAnim)) {
    previousMillisAnim = currentMillis;
    matrix.draw(animation[frameIndex]);
    frameIndex = (frameIndex + 1) % frameCount;
  }
}
