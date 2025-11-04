// ============================================
// UNAUTHORIZED ERROR DIAGNOSTIC SCRIPT
// ============================================
// Copy and paste this entire script into your browser console (F12)
// after logging into your app. Copy ALL output and send it to me.

console.log('========================================');
console.log('🔍 UNAUTHORIZED ERROR DIAGNOSTIC');
console.log('========================================\n');

// 1. Check Environment Variables
console.log('1️⃣ ENVIRONMENT VARIABLES:');
console.log('----------------------------------------');
const graphqlEndpoint = import.meta.env.VITE_GRAPHQL_ENDPOINT;
console.log('VITE_GRAPHQL_ENDPOINT:', graphqlEndpoint || '❌ NOT SET');
console.log('Endpoint preview:', graphqlEndpoint ? graphqlEndpoint.substring(0, 50) + '...' : 'N/A');
console.log('');

// 2. Check Amplify Configuration
console.log('2️⃣ AMPLIFY CONFIGURATION:');
console.log('----------------------------------------');
try {
  const { Amplify } = await import('aws-amplify');
  const config = Amplify.getConfig();
  console.log('✅ Amplify configured');
  console.log('Auth Config:', config.Auth);
  console.log('API Config:', {
    endpoint: config.API?.GraphQL?.endpoint ? config.API.GraphQL.endpoint.substring(0, 50) + '...' : 'NOT SET',
    region: config.API?.GraphQL?.region,
    defaultAuthMode: config.API?.GraphQL?.defaultAuthMode
  });
} catch (error) {
  console.error('❌ Failed to get Amplify config:', error);
}
console.log('');

// 3. Check Local Storage
console.log('3️⃣ LOCAL STORAGE:');
console.log('----------------------------------------');
const token = localStorage.getItem('pulse_auth_token');
const user = localStorage.getItem('pulse_user');
console.log('Stored Token:', token ? `✅ Found (${token.length} chars)` : '❌ NOT FOUND');
console.log('Token preview:', token ? token.substring(0, 50) + '...' : 'N/A');
console.log('Stored User:', user ? JSON.parse(user) : '❌ NOT FOUND');
console.log('');

// 4. Check Cognito Session
console.log('4️⃣ COGNITO SESSION:');
console.log('----------------------------------------');
try {
  const { fetchAuthSession, getCurrentUser } = await import('@aws-amplify/auth');
  
  try {
    const currentUser = await getCurrentUser();
    console.log('✅ Current user:', currentUser.userId);
  } catch (error) {
    console.error('❌ No current user:', error.message);
  }
  
  const session = await fetchAuthSession();
  console.log('Session tokens:', {
    hasTokens: !!session.tokens,
    hasIdToken: !!session.tokens?.idToken,
    hasAccessToken: !!session.tokens?.accessToken,
    tokenType: session.tokens?.idToken?.payload ? 'JWT' : 'none'
  });
  
  if (session.tokens?.idToken) {
    const payload = session.tokens.idToken.payload;
    console.log('Token payload:', {
      venueId: payload?.['custom:venueId'] || '❌ NOT FOUND',
      email: payload?.email,
      customAttributes: Object.keys(payload || {}).filter(k => k.startsWith('custom:'))
    });
  }
} catch (error) {
  console.error('❌ Failed to get session:', error);
}
console.log('');

// 5. Test GraphQL Connection
console.log('5️⃣ GRAPHQL CONNECTION TEST:');
console.log('----------------------------------------');
try {
  const { generateClient } = await import('@aws-amplify/api');
  const { fetchAuthSession } = await import('@aws-amplify/auth');
  
  const session = await fetchAuthSession();
  if (!session.tokens) {
    console.error('❌ No tokens available for GraphQL test');
  } else {
    const client = generateClient();
    console.log('✅ GraphQL client created');
    
    // Test with a simple introspection query
    try {
      const result = await client.graphql({
        query: `query { __typename }`,
        authMode: 'userPool'
      });
      console.log('✅ GraphQL test query successful:', result);
    } catch (error) {
      console.error('❌ GraphQL test query failed:');
      console.error('Error name:', error?.name);
      console.error('Error message:', error?.message);
      console.error('Error code:', error?.code);
      console.error('Error statusCode:', error?.statusCode);
      console.error('Error type:', error?.errorType);
      console.error('Error info:', error?.errorInfo);
      console.error('Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    }
  }
} catch (error) {
  console.error('❌ Failed to test GraphQL:', error);
}
console.log('');

// 6. Check Network Request (manual)
console.log('6️⃣ NETWORK REQUEST CHECK:');
console.log('----------------------------------------');
console.log('📋 MANUAL CHECK REQUIRED:');
console.log('1. Go to Network tab in DevTools');
console.log('2. Filter by "graphql" or "appsync"');
console.log('3. Find request with status 401 or 403');
console.log('4. Check Request Headers for "Authorization" header');
console.log('5. Copy the entire Request Payload');
console.log('6. Copy the entire Response body');
console.log('');

// 7. Summary
console.log('========================================');
console.log('📊 DIAGNOSTIC SUMMARY');
console.log('========================================');
console.log('Please copy ALL output above and send it to me.');
console.log('Also check Network tab as described in section 6.');
console.log('========================================');
