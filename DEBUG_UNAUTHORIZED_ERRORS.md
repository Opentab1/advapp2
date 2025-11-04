# Debugging "Unauthorized" Errors - Diagnostic Guide

## What to Check in Browser Console (F12)

After logging in and seeing the "Unauthorized" errors, please provide the following information from your browser console:

### 1. Open Browser Console (F12)

Press `F12` or right-click → Inspect → Console tab

### 2. Look for These Specific Logs

After the enhanced logging is deployed, you should see detailed diagnostic information. Look for:

#### A. Auth Session Details
Look for logs starting with `🔐 Auth session details:` - Copy the entire object:

```javascript
🔐 Auth session details: {
  hasTokens: true/false,
  hasIdToken: true/false,
  hasAccessToken: true/false,
  tokenType: "JWT" or "none",
  venueId: "FergData" or "NOT FOUND",
  userAttributes: [...]
}
```

#### B. GraphQL Request Details
Look for logs starting with `📡 GraphQL Request Details:` - Copy the entire object:

```javascript
📡 GraphQL Request Details: {
  endpoint: "https://...",
  query: "listVenueLocations" or "listSensorData",
  venueId: "FergData",
  authMode: "userPool"
}
```

#### C. Full Error Object
Look for logs starting with `🔍 Full Error Object:` - Copy the entire object:

```javascript
🔍 Full Error Object: {
  name: "...",
  message: "...",
  code: "...",
  statusCode: ...,
  errorType: "...",
  errors: [...],
  data: {...},
  fullError: "..."
}
```

#### D. GraphQL Response Errors
Look for logs starting with `❌ GraphQL Response Errors:` - Copy the entire object:

```javascript
❌ GraphQL Response Errors: {
  errors: [...],
  fullResponse: "..."
}
```

### 3. Network Tab Information

In the Network tab (F12 → Network):

1. Filter by "graphql" or "appsync"
2. Find the failed request (status code will be 401 or 403)
3. Click on it and check:
   - **Request Headers**: Look for `Authorization` header
   - **Request Payload**: Look for the GraphQL query and variables
   - **Response**: Copy the full response body
   - **Response Headers**: Look for any error details

### 4. Common Issues to Check

#### Issue 1: No Authorization Header
**Symptom**: Network request shows no `Authorization` header  
**Fix**: Token not being generated or sent correctly

#### Issue 2: Invalid Token Format
**Symptom**: Authorization header exists but token is malformed  
**Fix**: Cognito session issue - try logging out and back in

#### Issue 3: AppSync API Not Configured
**Symptom**: Endpoint shows "NOT SET" or placeholder value  
**Fix**: Set `VITE_GRAPHQL_ENDPOINT` in `.env` file

#### Issue 4: Wrong Auth Mode
**Symptom**: AppSync expects different auth mode  
**Fix**: Check AppSync API authorization settings

#### Issue 5: IAM Policy Issues
**Symptom**: Token valid but AppSync rejects with "Unauthorized"  
**Fix**: Check AppSync API IAM policy and Cognito User Pool permissions

### 5. Quick Diagnostic Commands

Run these in the browser console to check configuration:

```javascript
// Check if GraphQL endpoint is set
console.log('GraphQL Endpoint:', import.meta.env.VITE_GRAPHQL_ENDPOINT);

// Check stored token
console.log('Stored Token:', localStorage.getItem('pulse_auth_token'));

// Check user data
console.log('Stored User:', JSON.parse(localStorage.getItem('pulse_user') || '{}'));

// Check Amplify config
import { Amplify } from 'aws-amplify';
console.log('Amplify Config:', Amplify.getConfig());
```

### 6. What to Send Me

Please provide:

1. **All console logs** from the login attempt (copy entire console output)
2. **Network request details** for the failed GraphQL request:
   - Request URL
   - Request Headers (especially Authorization)
   - Request Payload
   - Response Status Code
   - Response Body
3. **Environment variables** (without sensitive values):
   - Is `VITE_GRAPHQL_ENDPOINT` set?
   - What's the first 30 characters of the endpoint? (e.g., `https://xxxxx.appsync-api.us-...`)

### 7. Most Likely Causes

Based on the error pattern, here are the most likely issues:

1. **AppSync API Authorization Mode Mismatch**
   - Your AppSync API might be configured for API Key auth instead of User Pool
   - Check: AWS Console → AppSync → Your API → Settings → Authorization modes

2. **IAM Policy Missing**
   - Cognito User Pool doesn't have permission to call AppSync
   - Check: AppSync API → Settings → Authorization → Cognito User Pool permissions

3. **GraphQL Schema/Resolvers**
   - Resolvers might not be configured to accept User Pool auth
   - Check: AppSync API → Schema → Resolvers

4. **Token Expiration**
   - Token might be expired
   - Solution: Clear cache and log in again

### 8. Quick Fixes to Try

1. **Clear all caches and log in again:**
   ```javascript
   localStorage.clear();
   sessionStorage.clear();
   window.location.reload();
   ```

2. **Verify GraphQL endpoint:**
   - Check `.env` file has `VITE_GRAPHQL_ENDPOINT` set
   - Restart dev server after changing `.env`

3. **Check Cognito User Pool:**
   - Verify user has `custom:venueId` attribute set to `FergData`
   - Verify user is confirmed and active

4. **Check AppSync API:**
   - Verify API exists and is accessible
   - Verify authorization mode includes "Amazon Cognito User Pool"
   - Verify API key is not required (if using User Pool auth)

---

**After gathering this information, the enhanced logging will help pinpoint exactly where the authorization is failing.**
