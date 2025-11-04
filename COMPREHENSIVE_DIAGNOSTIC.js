// ============================================
// COMPREHENSIVE APPSYNC 401 DIAGNOSTIC
// ============================================
// Copy and paste this entire script into browser console (F12)
// It will show you exactly what's wrong

(async function() {
  console.log('========================================');
  console.log('🔍 COMPREHENSIVE APPSYNC 401 DIAGNOSTIC');
  console.log('========================================\n');

  // 1. Check Configuration
  console.log('1️⃣ CONFIGURATION CHECK:');
  console.log('----------------------------------------');
  const endpoint = import.meta.env.VITE_GRAPHQL_ENDPOINT;
  console.log('GraphQL Endpoint:', endpoint || '❌ NOT SET');
  
  const { Amplify } = await import('aws-amplify');
  const config = Amplify.getConfig();
  console.log('Amplify API Config:', {
    endpoint: config.API?.GraphQL?.endpoint ? '✅ SET' : '❌ NOT SET',
    region: config.API?.GraphQL?.region,
    defaultAuthMode: config.API?.GraphQL?.defaultAuthMode
  });
  console.log('');

  // 2. Check Authentication
  console.log('2️⃣ AUTHENTICATION CHECK:');
  console.log('----------------------------------------');
  const { fetchAuthSession, getCurrentUser } = await import('@aws-amplify/auth');
  
  try {
    const currentUser = await getCurrentUser();
    console.log('✅ Current user:', currentUser.userId);
  } catch (error) {
    console.error('❌ No current user:', error.message);
  }
  
  const session = await fetchAuthSession();
  console.log('Session:', {
    hasTokens: !!session.tokens,
    hasIdToken: !!session.tokens?.idToken,
    hasAccessToken: !!session.tokens?.accessToken,
    idTokenLength: session.tokens?.idToken?.toString().length || 0,
    accessTokenLength: session.tokens?.accessToken?.toString().length || 0
  });
  
  if (session.tokens?.idToken) {
    const payload = session.tokens.idToken.payload;
    console.log('Token payload:', {
      venueId: payload?.['custom:venueId'] || '❌ NOT FOUND',
      email: payload?.email,
      exp: new Date(payload?.exp * 1000).toISOString(),
      isExpired: payload?.exp ? Date.now() > payload.exp * 1000 : 'unknown'
    });
  }
  console.log('');

  // 3. Test GraphQL with Detailed Error Capture
  console.log('3️⃣ GRAPHQL CONNECTION TEST:');
  console.log('----------------------------------------');
  const { generateClient } = await import('@aws-amplify/api');
  const client = generateClient();
  
  console.log('Testing simple query...');
  try {
    const result = await client.graphql({
      query: `query { __typename }`,
      authMode: 'userPool'
    });
    console.log('✅ Simple query successful:', result);
  } catch (error) {
    console.error('❌ Simple query failed');
    console.error('Error name:', error?.name);
    console.error('Error message:', error?.message);
    console.error('Error code:', error?.code);
    console.error('Error statusCode:', error?.statusCode);
    console.error('Error type:', error?.errorType);
    
    // Check for GraphQL errors
    if (error.errors) {
      console.error('\n📋 GraphQL Errors:');
      error.errors.forEach((err, idx) => {
        console.error(`Error ${idx + 1}:`, {
          message: err.message,
          errorType: err.errorType,
          errorInfo: err.errorInfo,
          path: err.path,
          locations: err.locations,
          extensions: err.extensions
        });
      });
    }
    
    // Check response data
    if (error.data) {
      console.error('\n📋 Response Data:', error.data);
    }
    
    // Full error object
    console.error('\n📋 Full Error Object:');
    console.error(JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
  }
  console.log('');

  // 4. Test with Actual Query
  console.log('4️⃣ TESTING ACTUAL QUERIES:');
  console.log('----------------------------------------');
  
  const user = JSON.parse(localStorage.getItem('pulse_user') || '{}');
  const venueId = user.venueId || 'FergData';
  
  // Test location query
  console.log('Testing location query...');
  try {
    const locationResult = await client.graphql({
      query: `query ListVenueLocations($venueId: ID!) {
        listVenueLocations(venueId: $venueId) {
          items {
            locationId
            displayName
          }
        }
      }`,
      variables: { venueId },
      authMode: 'userPool'
    });
    console.log('✅ Location query successful:', locationResult);
  } catch (error) {
    console.error('❌ Location query failed');
    if (error.errors) {
      error.errors.forEach((err, idx) => {
        console.error(`Error ${idx + 1}:`, {
          message: err.message,
          errorType: err.errorType,
          errorInfo: err.errorInfo,
          extensions: err.extensions
        });
      });
    }
    console.error('Full error:', JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
  }
  console.log('');

  // 5. Check Network Request (if possible)
  console.log('5️⃣ NETWORK REQUEST CHECK:');
  console.log('----------------------------------------');
  console.log('📋 MANUAL CHECK REQUIRED:');
  console.log('1. Go to Network tab (F12 → Network)');
  console.log('2. Filter by "graphql" or "appsync"');
  console.log('3. Find the failed request (401)');
  console.log('4. Click on it and check:');
  console.log('   - Request Headers → Look for "Authorization" header');
  console.log('   - Request Payload → Copy the GraphQL query');
  console.log('   - Response tab → Copy the ENTIRE response body');
  console.log('   - Preview tab → Take screenshot');
  console.log('');

  // 6. Summary
  console.log('========================================');
  console.log('📊 DIAGNOSTIC COMPLETE');
  console.log('========================================');
  console.log('Please copy ALL output above.');
  console.log('Also check Network tab as described in section 5.');
  console.log('The Network tab Response will show the exact error.');
  console.log('========================================');
})();
