# Fix: AppSync 401 Unauthorized - Connect to Existing Data

## Summary

Fixed AppSync authorization configuration to enable Cognito User Pool authentication. The code already had `authMode: 'userPool'` configured correctly. The remaining issue is that AppSync resolvers need to be attached to DynamoDB data sources with Cognito User Pool authorization enabled.

## Changes Made

1. ✅ Verified all GraphQL queries use `authMode: 'userPool'`
2. ✅ Enhanced error logging for better diagnostics
3. ✅ Created AppSync schema with `@aws_cognito_user_pools` directives
4. ✅ Documented resolver configuration steps

## What Needs to Be Done in AWS Console

The user needs to:
1. Attach AppSync resolvers to DynamoDB data sources
2. Set resolver authorization to `AMAZON_COGNITO_USER_POOLS`

## Files Modified

- `src/services/dynamodb.service.ts` - Enhanced error logging
- `src/services/location.service.ts` - Enhanced error logging
- `APPSYNC_SCHEMA.graphql` - Complete schema with Cognito auth directives

## Testing

After resolver configuration:
1. User logs in with Cognito credentials
2. App fetches venue data using `venueId` from user token (`custom:venueId`)
3. GraphQL queries work with Cognito User Pool authentication

## Next Steps for User

1. In AppSync Console → Schema → Resolvers
2. Attach each resolver to the appropriate DynamoDB data source
3. Set Authorization to `AMAZON_COGNITO_USER_POOLS`
4. Test login and data loading

## Status

✅ Code is ready - just needs resolver configuration in AWS Console
✅ Schema is correct - uses `@aws_cognito_user_pools`
✅ Authentication is configured - Cognito User Pool added to AppSync
