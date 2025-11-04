#!/bin/bash

# Script to help retrieve AppSync GraphQL endpoint from AWS

echo "🔍 Fetching AppSync API information from AWS..."
echo ""

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI is not installed"
    echo "   Please install it: https://aws.amazon.com/cli/"
    echo ""
    echo "   Or get the endpoint manually:"
    echo "   1. Go to AWS Console → AppSync"
    echo "   2. Click on your API"
    echo "   3. Copy the 'API URL' or 'GraphQL endpoint'"
    exit 1
fi

# Fetch AppSync APIs
echo "📡 Fetching AppSync APIs in us-east-2 region..."
apis=$(aws appsync list-graphql-apis --region us-east-2 2>&1)

if [ $? -ne 0 ]; then
    echo "❌ Failed to fetch AppSync APIs"
    echo "$apis"
    echo ""
    echo "   Please make sure:"
    echo "   1. AWS CLI is configured (run 'aws configure')"
    echo "   2. You have permissions to access AppSync"
    exit 1
fi

# Parse and display APIs
echo "$apis" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    apis = data.get('graphqlApis', [])
    
    if not apis:
        print('⚠️  No AppSync APIs found in us-east-2 region')
        print('')
        print('   Please create an AppSync API first.')
        print('   See DYNAMODB_SETUP.md for instructions.')
        sys.exit(1)
    
    print('✅ Found {} AppSync API(s):'.format(len(apis)))
    print('')
    
    for i, api in enumerate(apis, 1):
        print('{}. Name: {}'.format(i, api.get('name', 'N/A')))
        print('   API ID: {}'.format(api.get('apiId', 'N/A')))
        print('   GraphQL Endpoint: {}'.format(api['uris'].get('GRAPHQL', 'N/A')))
        print('   Auth Type: {}'.format(api.get('authenticationType', 'N/A')))
        print('')
    
    # If only one API, show how to update .env
    if len(apis) == 1:
        endpoint = apis[0]['uris'].get('GRAPHQL')
        print('=' * 60)
        print('To update your .env file, run:')
        print('')
        print('sed -i \"s|VITE_GRAPHQL_ENDPOINT=.*|VITE_GRAPHQL_ENDPOINT={}|\" .env'.format(endpoint))
        print('')
        print('Or manually edit .env and set:')
        print('VITE_GRAPHQL_ENDPOINT={}'.format(endpoint))
        print('=' * 60)
    else:
        print('Multiple APIs found. Please manually update .env with the correct endpoint.')
        
except Exception as e:
    print('❌ Error parsing AppSync data:', str(e))
    print(sys.stdin.read())
" 2>&1

if [ $? -ne 0 ]; then
    echo "⚠️  Unable to parse AppSync data"
    echo ""
    echo "   Please get the endpoint manually:"
    echo "   1. Go to AWS Console → AppSync"
    echo "   2. Click on your API"
    echo "   3. Copy the 'API URL' and update .env file"
fi

echo ""
echo "📝 After getting the endpoint, update your .env file:"
echo "   VITE_GRAPHQL_ENDPOINT=https://your-api-id.appsync-api.us-east-2.amazonaws.com/graphql"
echo ""
echo "   Then restart your dev server or rebuild for production."
