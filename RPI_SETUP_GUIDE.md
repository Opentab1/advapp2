# 🚀 RPi Setup Guide - Connect Your Device to Pulse Dashboard

This guide will help you connect your Raspberry Pi to send sensor data to your Pulse Dashboard account.

## Prerequisites

Before starting, you need to know:
1. **Your VenueId** - The venueId that's set in your Cognito user's `custom:venueId` attribute
2. **Your User Login** - The email/password to log into the dashboard
3. **IoT Certificates** - Downloaded from AWS IoT Core (we'll get these below)

---

## Step 1: Find Your VenueId

You need to know which venueId to use. This was set when your Cognito user was created.

### Option A: If you know your login email

1. Log into the dashboard at your app URL
2. Open browser console (F12)
3. Look for logs that mention "venueId" - it will show your venueId

### Option B: Check in AWS Console

1. Go to **AWS Cognito Console** → User Pools → `us-east-2_sMY1wYEF9`
2. Click **Users** tab
3. Find your user and click on it
4. Look for `custom:venueId` attribute - this is your venueId

**Write down your venueId:** `_____________________`

---

## Step 2: Get Your IoT Certificates

Your RPi needs certificates to connect to AWS IoT Core.

### Check if IoT Thing Already Exists

1. Go to **AWS IoT Console** → **Manage** → **Things**
2. Look for a thing named like: `{yourVenueId}-rpi-001` or similar
3. **If it exists:**
   - Click on it → **Certificates** tab
   - If certificate exists, proceed to download it
   - If no certificate, you'll need to create one (see below)

### If IoT Thing Doesn't Exist - Create It

1. **Go to AWS IoT Console** → **Manage** → **Things**
2. Click **Create thing**
3. Thing name: `{yourVenueId}-rpi-001` (replace with your actual venueId)
4. Click **Next**
5. Choose **Auto-generate a new certificate**
6. Click **Create thing**

### Download Certificates

**IMPORTANT:** You can only download the private key once!

1. Download these 3 files:
   - `certificate.pem.crt` - Device certificate
   - `private.pem.key` - Private key (ONLY AVAILABLE ONCE!)
   - `AmazonRootCA1.pem` - Root CA certificate

2. Click **Activate** to activate the certificate
3. Click **Attach policy**

### Create/Attach IoT Policy

If you don't have a policy yet:

1. Go to **AWS IoT Console** → **Secure** → **Policies**
2. Click **Create policy**
3. Policy name: `PulseDevicePolicy`
4. Add these statements:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "iot:Connect",
        "iot:Publish",
        "iot:Subscribe",
        "iot:Receive"
      ],
      "Resource": "*"
    }
  ]
}
```

5. Click **Create**
6. Go back to your certificate and attach this policy

---

## Step 3: Set Up IoT Rule (If Not Already Created)

This rule routes MQTT messages to DynamoDB so they appear in your dashboard.

### Check if Rule Already Exists

1. Go to **AWS IoT Console** → **Message routing** → **Rules**
2. Look for a rule named like: `StoreSensorData-{yourVenueId}`
3. **If it exists:** Great! Skip to Step 4
4. **If it doesn't exist:** Create it:

### Create IoT Rule

1. Click **Create rule**
2. Rule name: `StoreSensorData-{yourVenueId}` (use your actual venueId)
3. SQL statement:
   ```sql
   SELECT * FROM 'venue/{yourVenueId}/sensors'
   ```
   (Replace `{yourVenueId}` with your actual venueId)

4. Click **Next**
5. **Action:** Choose "DynamoDB"
6. **Table name:** `SensorData`
7. **Partition key:** 
   - Key name: `venueId`
   - Value: `'{yourVenueId}'` (use your actual venueId, with quotes!)
   - Type: String

8. **Sort key:**
   - Key name: `timestamp`
   - Value: `${timestamp()}`
   - Type: String

9. **Create new role** or use existing role with DynamoDB write permissions
10. Click **Next** → **Create**

---

## Step 4: Set Up Your Raspberry Pi

### Install Python Dependencies

```bash
# Update system
sudo apt-get update
sudo apt-get upgrade -y

# Install Python 3 and pip
sudo apt-get install python3 python3-pip -y

# Install AWS IoT SDK
pip3 install awsiotsdk
```

### Create Certificate Directory

```bash
# Create directory for certificates
mkdir -p /home/pi/certs
cd /home/pi/certs

# Copy your downloaded certificates here
# You can use scp, USB drive, or any method to transfer them
```

**Your certificates should be at:**
- `/home/pi/certs/certificate.pem.crt`
- `/home/pi/certs/private.pem.key`
- `/home/pi/certs/root-CA.crt`

### Download the Publisher Script

```bash
# Download the publisher script (from this repo)
cd /home/pi
wget https://YOUR_REPO_URL/rpi-sensor-publisher.py
# Or manually copy rpi-sensor-publisher.py to your RPi
```

### Configure the Script

Edit the script to set your venueId:

```bash
nano rpi-sensor-publisher.py
```

Update these lines:
```python
VENUE_ID = "your-actual-venue-id"  # Replace with YOUR venueId!

# Verify certificate paths match:
CERT_PATH = "/home/pi/certs/certificate.pem.crt"
PRIVATE_KEY_PATH = "/home/pi/certs/private.pem.key"
ROOT_CA_PATH = "/home/pi/certs/root-CA.crt"
```

Save and exit (Ctrl+X, Y, Enter)

---

## Step 5: Test the Connection

### Run the Script Manually

```bash
python3 /home/pi/rpi-sensor-publisher.py
```

**You should see:**
```
🔌 Connecting to AWS IoT Core...
✅ Connected to AWS IoT Core
📡 Starting to publish sensor data...

📤 Published at 2025-11-13T12:00:00Z
   🔊 Sound: 75.2 dB
   ☀️  Light: 385.4 lux
   🌡️  Temp: 72.3°F
   💧 Humidity: 48.2%
```

If you see this, **it's working!** 🎉

Press Ctrl+C to stop.

---

## Step 6: Verify Data in Dashboard

1. **Log into your dashboard** with your account
2. You should see **real-time data** updating!
3. Check browser console (F12) for any errors

**If data doesn't appear:**
- Check that your venueId matches in:
  - ✅ Cognito user's `custom:venueId`
  - ✅ RPi script's `VENUE_ID`
  - ✅ IoT Rule's SQL topic filter
  - ✅ VenueConfig table entry

---

## Step 7: Run Automatically on Boot (Optional)

To make the script run automatically when your RPi boots:

### Create Systemd Service

```bash
sudo nano /etc/systemd/system/pulse-publisher.service
```

Paste this:
```ini
[Unit]
Description=Pulse Dashboard Sensor Publisher
After=network.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi
ExecStart=/usr/bin/python3 /home/pi/rpi-sensor-publisher.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Save and exit.

### Enable and Start Service

```bash
# Reload systemd
sudo systemctl daemon-reload

# Enable service to start on boot
sudo systemctl enable pulse-publisher

# Start service now
sudo systemctl start pulse-publisher

# Check status
sudo systemctl status pulse-publisher
```

### View Logs

```bash
# View live logs
sudo journalctl -u pulse-publisher -f

# View recent logs
sudo journalctl -u pulse-publisher -n 50
```

---

## Troubleshooting

### Connection Errors

**Error: "No such file or directory" (certificates)**
- Check that certificate files exist at specified paths
- Verify file permissions: `ls -la /home/pi/certs/`

**Error: "Connection refused" or "Timeout"**
- Check internet connection
- Verify IoT endpoint is correct
- Check firewall/router allows outbound port 8883

**Error: "Not authorized"**
- Verify IoT policy is attached to certificate
- Check policy allows `iot:Connect` and `iot:Publish`

### No Data in Dashboard

**Dashboard shows "No data found"**
1. Check RPi script is running: `sudo systemctl status pulse-publisher`
2. Check IoT Rule exists and is enabled
3. Verify venueId matches everywhere
4. Check DynamoDB table has new entries:
   - AWS Console → DynamoDB → Tables → SensorData
   - Look for recent timestamps with your venueId

**Data in DynamoDB but not in Dashboard**
1. Check `.env` file has `VITE_GRAPHQL_ENDPOINT` set
2. Verify user's `custom:venueId` matches the data in DynamoDB
3. Check AppSync resolvers are configured correctly
4. Look at browser console (F12) for GraphQL errors

### Script Crashes

**Check logs:**
```bash
sudo journalctl -u pulse-publisher -n 100
```

**Common issues:**
- Missing Python packages: `pip3 install awsiotsdk`
- Certificate permissions: `chmod 644 /home/pi/certs/*`
- Invalid JSON in message payload

---

## Adding Real Sensors

The script currently sends **mock data** for testing. To connect real sensors:

1. **Set `USE_REAL_SENSORS = True`** in the script

2. **Install sensor libraries:**
   ```bash
   # Example for DHT22 temperature/humidity sensor
   pip3 install adafruit-circuitpython-dht
   sudo apt-get install libgpiod2
   ```

3. **Update sensor reading functions** in the script:
   - `read_sound_sensor()` - Connect sound level sensor
   - `read_light_sensor()` - Connect light sensor (TSL2561, etc.)
   - `read_temperature_sensor()` - Connect temp sensor (DHT22, DS18B20, etc.)
   - `read_humidity_sensor()` - Usually same as temperature sensor

4. **Example: DHT22 Temperature/Humidity Sensor**
   ```python
   import board
   import adafruit_dht
   
   dht_sensor = adafruit_dht.DHT22(board.D4)  # GPIO pin 4
   
   def read_temperature_sensor():
       return dht_sensor.temperature * 9/5 + 32  # Convert to Fahrenheit
   
   def read_humidity_sensor():
       return dht_sensor.humidity
   ```

---

## Quick Reference

### Your Configuration
- **VenueId:** `_____________________` (fill this in)
- **User Email:** `_____________________` (fill this in)
- **IoT Endpoint:** `a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com`
- **MQTT Topic:** `venue/{yourVenueId}/sensors`
- **Device ID:** `{yourVenueId}-rpi-001`

### Useful Commands

```bash
# Start publisher
python3 /home/pi/rpi-sensor-publisher.py

# Check service status
sudo systemctl status pulse-publisher

# View logs
sudo journalctl -u pulse-publisher -f

# Restart service
sudo systemctl restart pulse-publisher

# Test MQTT connection
mosquitto_pub -h a1h5tm3jvbz8cg-ats.iot.us-east-2.amazonaws.com \
  -p 8883 -t "venue/{yourVenueId}/sensors" \
  -m '{"test":"message"}' \
  --cert /home/pi/certs/certificate.pem.crt \
  --key /home/pi/certs/private.pem.key \
  --cafile /home/pi/certs/root-CA.crt
```

---

## Summary Checklist

- [ ] Found your venueId from Cognito
- [ ] Created/found IoT Thing in AWS
- [ ] Downloaded IoT certificates (certificate, private key, root CA)
- [ ] Created/verified IoT policy is attached
- [ ] Created/verified IoT Rule exists to route to DynamoDB
- [ ] Installed Python and awsiotsdk on RPi
- [ ] Copied certificates to `/home/pi/certs/`
- [ ] Updated `VENUE_ID` in rpi-sensor-publisher.py
- [ ] Ran script manually and saw "Connected" message
- [ ] Verified data appears in dashboard
- [ ] (Optional) Set up systemd service for auto-start

---

**You're all set!** Your RPi is now sending data to your Pulse Dashboard account. 🎉

If you have issues, check the Troubleshooting section or the browser console (F12) when logged into the dashboard.
