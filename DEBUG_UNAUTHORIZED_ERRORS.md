# 🔍 Debug Guide: "Unauthorized" Errors - What F12 Logs to Share

This guide will help you identify exactly what's causing the "Unauthorized" errors and what information to share for debugging.

## 📋 Step 1: Open Browser Console (F12)

1. **Press F12** (or right-click → Inspect → Console tab)
2. **Clear the console** (click the 🚫 icon or press Ctrl+L)
3. **Refresh the page** (F5) after logging in
4. **Wait for errors to appear**

## 🔍 Step 2: Look for These Specific Logs

The enhanced logging will now show detailed diagnostic information. Copy and share these specific sections:

### ✅ **Critical Logs to Share:**

#### 1. **GraphQL Endpoint Configuration**
```
📡 GraphQL Endpoint: https://xxxxx.appsync-api.us-east-2.amazonaws.com/graphql...
```
**What to check:**
- Is the endpoint shown? (Should NOT say "NOT SET")
- Does it match your AppSync API endpoint?

#### 2. **Authentication Session Details**
```
🔐 Authentication Session: {
  hasTokens: true/false,
  hasIdToken: true/false,
  hasAccessToken: true/false,
  tokenExpiry: "2024-01-01T12:00:00.000Z",
  tokenIssuedAt: "2024-01-01T11:00:00.000Z",
  tokenIssuer: "https://cognito-idp.us-east-2.amazonaws.com/us-east-2_I6EBJm3te",
  userId: "abc-123-def-456"
}
```
**What to check:**
- `hasTokens`: Should be `true`
- `hasIdToken`: Should be `true`
- `tokenExpiry`: Should be in the future (not expired)
- `tokenIssuer`: Should match your Cognito User Pool

#### 3. **GraphQL Request Details**
```
📤 Sending GraphQL request: {
  query: "listVenueLocations" or "listSensorData",
  variables: { venueId: "FergData", ... },
  authMode: "userPool"
}
```
**What to check:**
- `venueId`: Should be "FergData" (your venue)
- `authMode`: Should be "userPool"

#### 4. **GraphQL Response Details**
```
📥 GraphQL Response: {
  hasData: true/false,
  hasErrors: true/false,
  errorsCount: 0 or more,
  dataKeys: [...],
  responseKeys: [...]
}
```
**What to check:**
- `hasErrors`: Should be `false` (if `true`, errors are below)
- `errorsCount`: Should be `0`

#### 5. **GraphQL Error Details (if any)**
```
❌ GraphQL Errors: [...]
  Error 1: {
    message: "...",
    errorType: "...",
    errorInfo: {...},
    path: [...],
    extensions: {...},
    fullError: "..."
  }
```
**This is CRITICAL - Copy the entire error object!**

#### 6. **Full Error Object**
```
❌ Failed to fetch locations from DynamoDB: ...
   Error type: ...
   Error name: ...
   Error code: ...
   Error message: ...
   Error stack: ...
   Full error object: {...}
```
**Copy the entire "Full error object" JSON!**

### 🔒 **Authentication Error Detection**
If you see:
```
🔒 Authentication Error Detected - Check:
   1. JWT token is valid and not expired
   2. AppSync API uses Cognito User Pool authentication
   3. User has custom:venueId attribute in Cognito
   4. AppSync resolver authorization is configured correctly
```

This means the error is authentication-related. Check the items above.

### 🌐 **Network Error Detection**
If you see:
```
🌐 Network Error Detected - Check:
   1. VITE_GRAPHQL_ENDPOINT is correct
   2. CORS is configured on AppSync API
   3. Network connectivity
   4. AppSync API is accessible
```

This means the error is network-related. Check CORS and endpoint configuration.

## 📸 Step 3: Network Tab (Also Important!)

1. **Click the "Network" tab** in F12
2. **Filter by "Fetch/XHR"** or search for "graphql"
3. **Look for failed requests** (red status codes)
4. **Click on the failed request** (usually named "graphql" or your endpoint)
5. **Check these tabs:**
   - **Headers**: Look for `Authorization: Bearer ...` header
   - **Response**: See the actual error response
   - **Preview**: See formatted error message

**What to share:**
- The **Status Code** (should be 401, 403, or 200)
- The **Response** tab content (the actual error from AppSync)
- The **Request Headers** (especially the Authorization header - you can mask the token)

## 🔑 Common Issues and Solutions

### Issue 1: Token Expired
**Symptoms:**
- `tokenExpiry` is in the past
- Error: "Unauthorized" or "Token expired"

**Solution:**
- Log out and log back in
- Check Cognito token expiration settings

### Issue 2: Missing venueId
**Symptoms:**
- `❌ Missing venueId in token payload`
- Error: "No venueId found in user attributes"

**Solution:**
- Add `custom:venueId` attribute to your Cognito user
- Value should be "FergData"

### Issue 3: AppSync Not Configured for Cognito
**Symptoms:**
- Error: "Unauthorized"
- GraphQL response has 401/403 status

**Solution:**
- Check AppSync API → Settings → Authorization
- Ensure "Amazon Cognito User Pool" is enabled
- Ensure your User Pool ID matches: `us-east-2_I6EBJm3te`

### Issue 4: Resolver Authorization Issue
**Symptoms:**
- GraphQL returns data structure but with errors
- Error mentions "Not authorized" or "Access denied"

**Solution:**
- Check AppSync → Schema → Resolvers
- Ensure resolver uses `$context.identity.sub` for authorization
- Check IAM policy for AppSync

### Issue 5: CORS Error
**Symptoms:**
- Network error in console
- CORS error message in browser

**Solution:**
- Check AppSync API → Settings → CORS
- Add your domain to allowed origins
- Or use wildcard `*` for development

## 📝 What to Share When Asking for Help

Copy and paste these sections in order:

1. **GraphQL Endpoint**: `📡 GraphQL Endpoint: ...`
2. **Authentication Session**: Entire `🔐 Authentication Session:` object
3. **GraphQL Request**: `📤 Sending GraphQL request:` object
4. **GraphQL Response**: `📥 GraphQL Response:` object
5. **Any GraphQL Errors**: Entire `❌ GraphQL Errors:` section
6. **Full Error Object**: Entire `Full error object:` JSON
7. **Network Tab**: Status code and Response from failed request

## 🚨 Quick Checklist Before Sharing Logs

- [ ] Console is cleared and refreshed after login
- [ ] Copied all diagnostic logs (🔍, 📡, 🔐, 📤, 📥, ❌)
- [ ] Checked Network tab for failed requests
- [ ] Verified GraphQL endpoint is set in .env
- [ ] Verified user has custom:venueId attribute
- [ ] Verified AppSync uses Cognito User Pool auth

## 💡 Pro Tip

If you see the same error repeatedly, try:
1. **Clear browser cache** (Ctrl+Shift+Delete)
2. **Log out completely**
3. **Clear localStorage** (F12 → Console → Run: `localStorage.clear()`)
4. **Log back in**
5. **Check console again**

This ensures you're getting fresh diagnostic information without cached errors.
