# What F12 Logs to Provide for "Unauthorized" Error Diagnosis

## Quick Answer

After logging in and seeing the errors, open F12 (Browser DevTools) and provide:

### 1. Console Tab - Copy ALL logs with these emojis:
- 🔐 (Auth session details)
- 📡 (GraphQL Request Details)  
- ❌ (Error messages)
- 🔍 (Full Error Object)
- 🌐 (Network Error Details)

### 2. Network Tab - Find the failed GraphQL request:
- Right-click the failed request → Copy → Copy as cURL
- Or screenshot the Request/Response tabs

---

## Detailed Steps

### Step 1: Open Browser Console
1. Press `F12` or Right-click → Inspect
2. Go to **Console** tab
3. Clear the console (🚫 icon or Ctrl+L)

### Step 2: Reproduce the Error
1. Log in to your app
2. Wait for the "Unauthorized" errors to appear

### Step 3: Copy Console Logs
Look for these specific log entries and copy them:

#### A. Auth Session Details
```
🔐 Auth session details: {
  hasTokens: ...,
  hasIdToken: ...,
  hasAccessToken: ...,
  tokenType: ...,
  venueId: ...,
  userAttributes: [...]
}
```

#### B. GraphQL Request Details
```
📡 GraphQL Request Details: {
  endpoint: "...",
  query: "...",
  venueId: "...",
  authMode: "..."
}
```

#### C. Full Error Object
```
🔍 Full Error Object: {
  name: "...",
  message: "...",
  code: ...,
  statusCode: ...,
  errorType: "...",
  errors: [...],
  data: {...},
  fullError: "..."
}
```

#### D. GraphQL Response Errors (if present)
```
❌ GraphQL Response Errors: {
  errors: [...],
  fullResponse: "..."
}
```

### Step 4: Check Network Tab
1. Go to **Network** tab in DevTools
2. Filter by: `graphql` or `appsync` or `graphql-api`
3. Find the request with status `401` or `403` (red)
4. Click on it
5. Check these tabs:

#### Request Headers Tab:
Look for `Authorization` header - copy its value (first 50 chars)

#### Request Payload Tab:
Copy the entire GraphQL query and variables

#### Response Tab:
Copy the entire response body (usually JSON with error details)

#### Preview Tab:
Screenshot or copy what's shown

### Step 5: Run Diagnostic Commands
In the Console tab, paste and run these commands:

```javascript
// 1. Check GraphQL endpoint
console.log('GraphQL Endpoint:', import.meta.env.VITE_GRAPHQL_ENDPOINT);

// 2. Check Amplify config
import { Amplify } from 'aws-amplify';
console.log('Amplify Config:', JSON.stringify(Amplify.getConfig(), null, 2));

// 3. Check stored token
const token = localStorage.getItem('pulse_auth_token');
console.log('Token exists:', !!token);
console.log('Token length:', token?.length);
console.log('Token preview:', token?.substring(0, 50) + '...');

// 4. Check user data
const user = JSON.parse(localStorage.getItem('pulse_user') || '{}');
console.log('User data:', user);

// 5. Check Cognito session
import { fetchAuthSession } from '@aws-amplify/auth';
fetchAuthSession().then(session => {
  console.log('Session tokens:', {
    hasTokens: !!session.tokens,
    hasIdToken: !!session.tokens?.idToken,
    hasAccessToken: !!session.tokens?.accessToken,
    idTokenPreview: session.tokens?.idToken?.toString().substring(0, 50)
  });
});
```

Copy the output of all these commands.

---

## What to Send Me

Please provide:

1. ✅ **All console logs** (from Step 3) - especially the emoji-prefixed ones
2. ✅ **Network request details** (from Step 4):
   - Request URL
   - Request Headers (especially Authorization)
   - Request Payload  
   - Response Status Code
   - Response Body
3. ✅ **Diagnostic command outputs** (from Step 5)
4. ✅ **Screenshot** of the Network tab showing the failed request

---

## Most Common Issues (Quick Checks)

### Issue 1: GraphQL Endpoint Not Set
**Check**: Run `console.log(import.meta.env.VITE_GRAPHQL_ENDPOINT)` in console
**Fix**: Set `VITE_GRAPHQL_ENDPOINT` in `.env` file and restart dev server

### Issue 2: No Authorization Header
**Check**: Network tab → Request Headers → Look for `Authorization` header
**Fix**: Token not being generated - check Cognito login

### Issue 3: Invalid Token
**Check**: Console shows `hasTokens: false` or `tokenType: "none"`
**Fix**: Clear cache and log in again

### Issue 4: AppSync API Auth Mode Mismatch
**Check**: AWS Console → AppSync → Your API → Settings → Authorization modes
**Fix**: Ensure "Amazon Cognito User Pool" is enabled

### Issue 5: IAM Permissions
**Check**: AWS Console → AppSync → Your API → Settings → Authorization
**Fix**: Ensure Cognito User Pool has permission to call AppSync

---

## Quick Test

Try this in the browser console after logging in:

```javascript
import { generateClient } from '@aws-amplify/api';
import { fetchAuthSession } from '@aws-amplify/auth';

// Test if we can get a token
const session = await fetchAuthSession();
console.log('Session:', session);

// Test if we can make a GraphQL call
const client = generateClient();
try {
  const result = await client.graphql({
    query: `query { __typename }`,
    authMode: 'userPool'
  });
  console.log('GraphQL test successful:', result);
} catch (error) {
  console.error('GraphQL test failed:', error);
}
```

Copy the output of this test.

---

**Once you provide these logs, I can pinpoint exactly where the authorization is failing!**
