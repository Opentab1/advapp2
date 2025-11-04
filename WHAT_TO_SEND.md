# 🔧 FIXING "UNAUTHORIZED" ERRORS - What F12 Logs I Need

## ✅ I've Enhanced Error Logging

I've added comprehensive diagnostic logging to your app. Now when you log in, you'll see detailed error information in the browser console.

## 📋 What to Do Now

### Step 1: Clear Browser Cache and Refresh
1. Open your app
2. Press `F12` to open DevTools
3. Right-click the refresh button → "Empty Cache and Hard Reload"
4. OR: Clear cache in Settings page → Clear Cache → Refresh

### Step 2: Log In Again
1. Log in to your app
2. Wait for the errors to appear

### Step 3: Open Browser Console (F12)
1. Press `F12` or Right-click → Inspect
2. Go to **Console** tab
3. Look for logs with these emojis:

### Step 4: Copy These Specific Logs

#### A. 🔐 Auth Session Details
Look for this log and copy the entire object:
```
🔐 Auth session details: { ... }
```

#### B. 📡 GraphQL Request Details  
Look for this log and copy the entire object:
```
📡 GraphQL Request Details: { ... }
```

#### C. 🔍 Full Error Object
Look for this log and copy the entire object:
```
🔍 Full Error Object: { ... }
```

#### D. ❌ GraphQL Response Errors (if present)
Look for this log and copy the entire object:
```
❌ GraphQL Response Errors: { ... }
```

### Step 5: Check Network Tab
1. Go to **Network** tab in DevTools
2. Filter by: `graphql` or `appsync`
3. Find the request with status `401` or `403` (red)
4. Click on it
5. Take screenshots or copy:
   - **Request Headers** tab (especially Authorization header)
   - **Request Payload** tab (the GraphQL query)
   - **Response** tab (the error response)

### Step 6: Run Diagnostic Script (Optional but Helpful)
1. Copy the contents of `run-diagnostic.js` file
2. Paste into browser console
3. Press Enter
4. Copy ALL output

---

## 🎯 What to Send Me

Please provide:

1. ✅ **All console logs** (especially the emoji-prefixed ones from Step 4)
2. ✅ **Network request details** (from Step 5)
3. ✅ **Diagnostic script output** (from Step 6, if you ran it)

---

## 🔍 Most Likely Issues (While You Gather Logs)

### Issue 1: AppSync API Authorization Mode
**Symptom**: Token exists but AppSync rejects it  
**Check**: AWS Console → AppSync → Your API → Settings → Authorization modes  
**Fix**: Ensure "Amazon Cognito User Pool" is enabled (not just API Key)

### Issue 2: GraphQL Resolvers Auth Mode
**Symptom**: Some queries work, others don't  
**Check**: AWS Console → AppSync → Your API → Schema → Resolvers  
**Fix**: Ensure all resolvers use `userPool` auth mode

### Issue 3: IAM Permissions
**Symptom**: Token valid but still unauthorized  
**Check**: AWS Console → AppSync → Your API → Settings  
**Fix**: Ensure Cognito User Pool has permission to call AppSync

### Issue 4: GraphQL Endpoint Not Set
**Symptom**: Endpoint shows "NOT SET" in logs  
**Fix**: Set `VITE_GRAPHQL_ENDPOINT` in `.env` file and restart dev server

---

## 📝 Quick Checklist

Before sending logs, verify:
- [ ] GraphQL endpoint is set in `.env` file (`VITE_GRAPHQL_ENDPOINT`)
- [ ] Dev server was restarted after setting `.env`
- [ ] User has `custom:venueId` attribute set to `FergData` in Cognito
- [ ] AppSync API exists and is accessible
- [ ] AppSync API authorization mode includes "Amazon Cognito User Pool"

---

## 🚀 After You Send Logs

Once I have the logs, I can:
1. Identify exactly where the authorization fails
2. See if the token is being sent correctly
3. Check if the AppSync API is configured properly
4. Provide a targeted fix

**The enhanced logging will show exactly what's happening!**
