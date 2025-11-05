#!/bin/bash
# Quick diagnostic script for Pulse Dashboard setup
# Run this to check if your system is configured correctly

echo "=========================================================================="
echo "🔍 PULSE DASHBOARD - QUICK DIAGNOSTIC CHECK"
echo "=========================================================================="
echo ""

ISSUES=0

# Check 1: .env file exists
echo "1️⃣  Checking .env file..."
if [ -f ".env" ]; then
    echo "   ✅ .env file exists"
    
    # Check if GraphQL endpoint is configured
    if grep -q "VITE_GRAPHQL_ENDPOINT" .env; then
        ENDPOINT=$(grep VITE_GRAPHQL_ENDPOINT .env | cut -d'=' -f2)
        if [[ $ENDPOINT == *"your-appsync-api"* ]] || [ -z "$ENDPOINT" ]; then
            echo "   ❌ GraphQL endpoint not configured properly"
            echo "      Current value: $ENDPOINT"
            echo "      Fix: Set real AppSync endpoint in .env"
            ISSUES=$((ISSUES + 1))
        else
            echo "   ✅ GraphQL endpoint configured"
        fi
    else
        echo "   ❌ VITE_GRAPHQL_ENDPOINT not found in .env"
        ISSUES=$((ISSUES + 1))
    fi
else
    echo "   ❌ .env file NOT FOUND!"
    echo "      This is likely why you're not seeing data"
    echo "      Fix: cp .env.example .env"
    ISSUES=$((ISSUES + 1))
fi
echo ""

# Check 2: AWS CLI configured
echo "2️⃣  Checking AWS CLI configuration..."
if command -v aws &> /dev/null; then
    echo "   ✅ AWS CLI installed"
    
    # Check if credentials are configured
    if aws sts get-caller-identity &> /dev/null; then
        echo "   ✅ AWS credentials configured"
        ACCOUNT=$(aws sts get-caller-identity --query Account --output text 2>/dev/null)
        echo "      AWS Account: $ACCOUNT"
    else
        echo "   ⚠️  AWS credentials not configured"
        echo "      Run: aws configure"
        ISSUES=$((ISSUES + 1))
    fi
else
    echo "   ⚠️  AWS CLI not installed"
    echo "      Install: pip3 install awscli"
fi
echo ""

# Check 3: DynamoDB tables exist
echo "3️⃣  Checking DynamoDB tables..."
if command -v aws &> /dev/null && aws sts get-caller-identity &> /dev/null; then
    TABLES=$(aws dynamodb list-tables --region us-east-2 2>/dev/null | grep -E "(SensorData|VenueConfig|OccupancyMetrics)")
    
    if echo "$TABLES" | grep -q "SensorData"; then
        echo "   ✅ SensorData table exists"
    else
        echo "   ❌ SensorData table NOT FOUND"
        ISSUES=$((ISSUES + 1))
    fi
    
    if echo "$TABLES" | grep -q "VenueConfig"; then
        echo "   ✅ VenueConfig table exists"
    else
        echo "   ❌ VenueConfig table NOT FOUND"
        ISSUES=$((ISSUES + 1))
    fi
    
    if echo "$TABLES" | grep -q "OccupancyMetrics"; then
        echo "   ✅ OccupancyMetrics table exists"
    else
        echo "   ⚠️  OccupancyMetrics table NOT FOUND (optional)"
    fi
else
    echo "   ⚠️  Cannot check (AWS CLI not configured)"
fi
echo ""

# Check 4: AppSync API exists
echo "4️⃣  Checking AppSync GraphQL API..."
if command -v aws &> /dev/null && aws sts get-caller-identity &> /dev/null; then
    APIS=$(aws appsync list-graphql-apis --region us-east-2 2>/dev/null | grep -c "name")
    
    if [ "$APIS" -gt 0 ]; then
        echo "   ✅ AppSync API(s) found: $APIS"
        aws appsync list-graphql-apis --region us-east-2 --query 'graphqlApis[*].[name,apiId]' --output text 2>/dev/null
    else
        echo "   ❌ No AppSync APIs found"
        echo "      Create one using DYNAMODB_SETUP.md"
        ISSUES=$((ISSUES + 1))
    fi
else
    echo "   ⚠️  Cannot check (AWS CLI not configured)"
fi
echo ""

# Check 5: Node modules installed
echo "5️⃣  Checking Node.js dependencies..."
if [ -d "node_modules" ]; then
    echo "   ✅ node_modules directory exists"
else
    echo "   ❌ node_modules NOT FOUND"
    echo "      Run: npm install"
    ISSUES=$((ISSUES + 1))
fi
echo ""

# Check 6: User Pool exists
echo "6️⃣  Checking Cognito User Pool..."
if command -v aws &> /dev/null && aws sts get-caller-identity &> /dev/null; then
    USER_POOL=$(aws cognito-idp describe-user-pool --user-pool-id us-east-2_I6EBJm3te --region us-east-2 2>/dev/null)
    
    if [ $? -eq 0 ]; then
        echo "   ✅ User Pool exists: us-east-2_I6EBJm3te"
        
        # Check if custom attributes are configured
        CUSTOM_ATTRS=$(echo "$USER_POOL" | grep -c "custom:venueId")
        if [ "$CUSTOM_ATTRS" -gt 0 ]; then
            echo "   ✅ custom:venueId attribute configured"
        else
            echo "   ⚠️  custom:venueId attribute may not be configured"
        fi
    else
        echo "   ❌ User Pool not found or no access"
        ISSUES=$((ISSUES + 1))
    fi
else
    echo "   ⚠️  Cannot check (AWS CLI not configured)"
fi
echo ""

# Summary
echo "=========================================================================="
echo "📊 DIAGNOSTIC SUMMARY"
echo "=========================================================================="
echo ""

if [ $ISSUES -eq 0 ]; then
    echo "✅ All critical checks passed!"
    echo ""
    echo "Your setup looks good. If you're still not seeing data:"
    echo "1. Ensure your Cognito user has custom:venueId attribute"
    echo "2. Ensure DynamoDB has data for your venueId"
    echo "3. Check browser console (F12) for detailed errors"
    echo ""
    echo "Next steps:"
    echo "  npm run dev              # Start the development server"
    echo "  npm run build            # Build for production"
else
    echo "❌ Found $ISSUES issue(s) that need attention"
    echo ""
    echo "📚 RECOMMENDED FIXES:"
    echo ""
    echo "1. Create .env file:"
    echo "   cp .env.example .env"
    echo "   # Edit .env and set VITE_GRAPHQL_ENDPOINT"
    echo ""
    echo "2. Configure AWS credentials:"
    echo "   aws configure"
    echo ""
    echo "3. Create AppSync API and DynamoDB tables:"
    echo "   See DYNAMODB_SETUP.md for instructions"
    echo ""
    echo "4. Install dependencies:"
    echo "   npm install"
    echo ""
    echo "📖 Read COMPLETE_SETUP_GUIDE.md for detailed instructions"
fi
echo ""
echo "=========================================================================="
echo "Need help? Check these guides:"
echo "  📄 DIAGNOSIS_SUMMARY.md - Overview of findings"
echo "  📄 COMPLETE_SETUP_GUIDE.md - Fix 'no data' issue"
echo "  📄 VENUE_SETUP_COMPLETE_GUIDE.md - Add new venues"
echo "  📄 RPI_CONNECTION_GUIDE.md - Connect Raspberry Pi"
echo "=========================================================================="
