#include <WiFi.h>
#include <HTTPClient.h>
#include <DHT11.h>

#define DHTPIN 4
#define DHTTYPE DHT11

DHT11 dht11(DHTPIN);

// Sensor pins
#define SOIL_PIN 34
#define LDR_PIN 35

// WiFi credentials
const char* ssid = "vivo Y21G";
const char* password = "8347860511";

// Flask server address
String serverURL = "http://192.168.63.153:5001/data";   // IMPORTANT!

void setup() {
  Serial.begin(9600);

  // WiFi connect
  WiFi.begin(ssid, password);
  Serial.print("Connecting");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected!");
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {

    // Read sensors
    int temperature = 0, humidity = 0;
    int result = dht11.readTemperatureHumidity(temperature, humidity);
    int soil = analogRead(SOIL_PIN);
    int light = analogRead(LDR_PIN);

    // Safety check
    if (isnan(temperature) || isnan(humidity)) {
      Serial.println("DHT Error!");
      return;
    }

    // Create JSON
    String jsonData = "{";
    jsonData += "\"temperature\":" + String(temperature) + ",";
    jsonData += "\"humidity\":" + String(humidity) + ",";
    jsonData += "\"soil\":" + String(soil) + ",";
    jsonData += "\"light\":" + String(light);
    jsonData += "}";

    Serial.println("Sending: " + jsonData);

    HTTPClient http;
    http.begin(serverURL);
    http.addHeader("Content-Type", "application/json");

    int response = http.POST(jsonData);

    Serial.print("Server response: ");
    Serial.println(response);

    http.end();
  }

  delay(5000); // Send every 5 seconds
}
