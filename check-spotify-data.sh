#!/bin/bash

# Check if Spotify data is being saved to DynamoDB
# Diagnostic script to verify the fix

REGION="us-east-2"
RULE_NAME="PulseSensorDataRule"
TABLE_NAME="SensorData"

echo "🔍 Spotify Data Diagnostic Check"
echo "=================================="
echo ""

# Check 1: IoT Rule SQL
echo "1️⃣  Checking IoT Rule SQL..."
if RULE_SQL=$(aws iot get-topic-rule --rule-name "$RULE_NAME" --region "$REGION" 2>/dev/null | jq -r '.rule.sql'); then
    echo "   Current SQL: $RULE_SQL"
    
    if echo "$RULE_SQL" | grep -q "currentSong"; then
        echo "   ✅ SQL includes currentSong mapping"
    else
        echo "   ❌ SQL does NOT include currentSong mapping"
        echo "   🔧 Run ./fix-iot-rule-spotify.sh to fix this"
    fi
else
    echo "   ❌ Could not retrieve IoT Rule"
fi
echo ""

# Check 2: Latest DynamoDB Item
echo "2️⃣  Checking latest DynamoDB item..."
if LATEST_ITEM=$(aws dynamodb scan \
    --table-name "$TABLE_NAME" \
    --limit 1 \
    --region "$REGION" 2>/dev/null | jq -r '.Items[0]'); then
    
    # Check for spotify fields
    HAS_CURRENT_SONG=$(echo "$LATEST_ITEM" | jq -r '.currentSong // empty')
    HAS_ARTIST=$(echo "$LATEST_ITEM" | jq -r '.artist // empty')
    TIMESTAMP=$(echo "$LATEST_ITEM" | jq -r '.timestamp.S // .timestamp')
    
    echo "   Latest item timestamp: $TIMESTAMP"
    
    if [ -n "$HAS_CURRENT_SONG" ]; then
        SONG_VALUE=$(echo "$LATEST_ITEM" | jq -r '.currentSong.S // .currentSong')
        ARTIST_VALUE=$(echo "$LATEST_ITEM" | jq -r '.artist.S // .artist')
        echo "   ✅ Has currentSong: $SONG_VALUE"
        echo "   ✅ Has artist: $ARTIST_VALUE"
    else
        echo "   ❌ Does NOT have currentSong field"
        
        # Check if it has the OLD spotify nested object
        HAS_SPOTIFY_OBJECT=$(echo "$LATEST_ITEM" | jq -r '.spotify // empty')
        if [ -n "$HAS_SPOTIFY_OBJECT" ]; then
            echo "   ⚠️  Has 'spotify' object (not flattened)"
            echo "      This means the IoT Rule is not transforming the data"
        fi
    fi
    
    # Show all keys
    echo ""
    echo "   📋 Available fields in item:"
    echo "$LATEST_ITEM" | jq -r 'keys[]' | sed 's/^/      - /'
else
    echo "   ❌ Could not scan DynamoDB table"
fi
echo ""

# Check 3: MQTT Message Format (if test client available)
echo "3️⃣  MQTT Messages:"
echo "   To check MQTT messages in real-time:"
echo "   - Go to: https://console.aws.amazon.com/iot/home?region=$REGION"
echo "   - Click: MQTT test client"
echo "   - Subscribe to: pulse/sensors/#"
echo "   - Verify messages have 'spotify' object with 'current_song', 'artist', 'album_art'"
echo ""

# Summary
echo "=================================="
echo "📊 SUMMARY"
echo "=================================="

# Determine status
RULE_OK=false
DATA_OK=false

if aws iot get-topic-rule --rule-name "$RULE_NAME" --region "$REGION" 2>/dev/null | jq -r '.rule.sql' | grep -q "currentSong"; then
    RULE_OK=true
fi

if [ -n "$HAS_CURRENT_SONG" ]; then
    DATA_OK=true
fi

if $RULE_OK && $DATA_OK; then
    echo "✅ WORKING: IoT Rule is correctly saving Spotify data"
    echo ""
    echo "Next: Check your dashboard to see songs in 'Now Playing' widget"
elif $RULE_OK && ! $DATA_OK; then
    echo "⚠️  RULE FIXED, WAITING FOR DATA"
    echo ""
    echo "The IoT Rule is configured correctly, but DynamoDB doesn't have"
    echo "the new fields yet. This means:"
    echo "  - The fix was recently applied"
    echo "  - New sensor data hasn't arrived yet"
    echo ""
    echo "Wait 5-10 seconds and run this script again."
elif ! $RULE_OK; then
    echo "❌ NOT FIXED: IoT Rule needs to be updated"
    echo ""
    echo "Run this command to fix it:"
    echo "  ./fix-iot-rule-spotify.sh"
fi

echo ""
