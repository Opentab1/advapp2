# Fix: "Unable to Load Data from DynamoDB" Error

## 🔴 Problem
After login, you see:
```
Unable to Load Data from DynamoDB
Failed to fetch live data from DynamoDB: Failed to fetch live data from DynamoDB: undefined
Your venueId: FergData
```

## ✅ Root Cause
**The `.env` file is missing or doesn't have the AWS AppSync GraphQL endpoint configured.**

Without this endpoint, the app cannot connect to DynamoDB through AppSync, resulting in the "undefined" error.

---

## 🚀 Quick Fix (If AppSync is Already Set Up)

### Step 1: Get Your AppSync API URL

1. Go to [AWS AppSync Console](https://console.aws.amazon.com/appsync)
2. Open your API (e.g., `PulseDashboardAPI`)
3. Go to **Settings**
4. Copy the **API URL** (looks like: `https://xxxxx.appsync-api.us-east-2.amazonaws.com/graphql`)

### Step 2: Update the .env File

I've already created a `.env` file for you. Open it and replace the placeholder:

**File: `.env`**
```env
# Replace this line with your actual AppSync API URL:
VITE_GRAPHQL_ENDPOINT=https://your-actual-api-id.appsync-api.us-east-2.amazonaws.com/graphql
```

### Step 3: Restart Your Dev Server

```bash
# Stop the current server (Ctrl+C)
npm run dev
```

### Step 4: Test

1. Refresh your browser (`Ctrl+Shift+R` to hard refresh)
2. Login again
3. ✅ The error should be gone!

---

## 🛠️ If AppSync is NOT Set Up Yet

You need to set up the AWS infrastructure first. This involves:

1. **Creating DynamoDB tables** (`SensorData`, `VenueConfig`, `OccupancyMetrics`)
2. **Creating AWS AppSync GraphQL API**
3. **Configuring resolvers** to connect AppSync to DynamoDB
4. **Adding data** to DynamoDB tables

📚 **Complete instructions:** See [DYNAMODB_SETUP.md](./DYNAMODB_SETUP.md)

This is a significant setup that requires AWS Console access. If you're not the AWS administrator, contact them to:
- Set up AppSync API
- Provide you with the GraphQL endpoint URL
- Ensure your Cognito user has the `custom:venueId` attribute

---

## 🔍 Verification

After fixing, you should see in browser console (F12):

```
🔍 Fetching live data from DynamoDB for venue: FergData
✅ Live data received from DynamoDB
```

And on the dashboard:
- ✅ No error message
- ✅ Live sensor data displayed
- ✅ Metrics showing actual values

---

## 📝 What I've Created for You

1. **`.env`** - Environment configuration file (YOU NEED TO UPDATE THIS!)
2. **`.env.example`** - Template for environment variables
3. **`TROUBLESHOOTING_GUIDE.md`** - Detailed troubleshooting steps
4. **`FIX_DYNAMODB_ERROR.md`** - This quick fix guide

---

## ❓ Common Questions

### Q: Where do I get the AppSync endpoint?
**A:** AWS Console → AppSync → Your API → Settings → API URL

### Q: I don't have AWS Console access
**A:** Contact your AWS administrator to get the AppSync endpoint URL

### Q: The error still appears after updating .env
**A:** Make sure you:
1. Saved the `.env` file
2. Restarted the dev server (`npm run dev`)
3. Hard refreshed your browser (`Ctrl+Shift+R`)

### Q: How do I know if AppSync is set up?
**A:** Check AWS AppSync Console. If you see an API listed and it's in "Active" state, it's set up.

### Q: The .env file doesn't work
**A:** Make sure:
- File is named exactly `.env` (not `.env.txt`)
- File is in project root (same folder as `package.json`)
- No extra spaces in the URL

---

## 🆘 Still Stuck?

1. Check [TROUBLESHOOTING_GUIDE.md](./TROUBLESHOOTING_GUIDE.md) for detailed diagnostics
2. Check browser console (F12) for specific error messages
3. Verify AppSync is working by testing queries directly in AWS Console
4. Contact your AWS administrator if infrastructure is not set up

---

## ✨ Next Steps After Fix

Once the error is resolved:
1. Verify your venueId (`FergData`) has data in DynamoDB
2. Check that IoT devices are publishing sensor data
3. Explore the dashboard features (live data, historical charts, reports)

Good luck! 🚀
