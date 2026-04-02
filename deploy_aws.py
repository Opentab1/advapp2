#!/usr/bin/env python3
"""
VenueScope — AWS Deployment Script
Run this in AWS CloudShell (us-east-2).

What it does:
  1. Creates BartenderProfiles DynamoDB table
  2. Updates AppSync schema
  3. Creates/verifies AppSync IAM role for DynamoDB
  4. Creates AppSync data sources (VenueScopeJobs + BartenderProfiles)
  5. Creates resolvers for all VenueScope queries
  6. Verifies the Blind Goat Cognito user has correct venueId
"""
import boto3, json, time, sys

REGION      = "us-east-2"
API_ID      = "ui76r6g3a5a6rdqts6cse76gey"
ACCOUNT_ID  = "501149494023"
USER_POOL   = "us-east-2_sMY1wYEF9"

session    = boto3.Session(region_name=REGION)
ddb        = session.client("dynamodb")
appsync    = session.client("appsync")
iam        = session.client("iam")
cognito    = session.client("cognito-idp")

OK   = "  ✓"
SKIP = "  →"
ERR  = "  ✗"

# ── Helpers ───────────────────────────────────────────────────────────────────

def section(title):
    print(f"\n{'─'*55}")
    print(f"  {title}")
    print(f"{'─'*55}")

def wait_schema_active(api_id, timeout=60):
    for _ in range(timeout):
        r = appsync.get_schema_creation_status(apiId=api_id)
        status = r["status"]
        if status == "SUCCESS":
            return True
        if status == "FAILED":
            print(f"{ERR} Schema update FAILED: {r.get('details','')}")
            return False
        time.sleep(1)
    print(f"{ERR} Schema update timed out")
    return False

# ── 1. DynamoDB: BartenderProfiles ───────────────────────────────────────────

section("1. DynamoDB — BartenderProfiles table")

try:
    ddb.describe_table(TableName="BartenderProfiles")
    print(f"{SKIP} BartenderProfiles table already exists — skipping")
except ddb.exceptions.ResourceNotFoundException:
    print("  Creating BartenderProfiles table...")
    ddb.create_table(
        TableName="BartenderProfiles",
        AttributeDefinitions=[
            {"AttributeName": "venueId",      "AttributeType": "S"},
            {"AttributeName": "bartenderId",  "AttributeType": "S"},
        ],
        KeySchema=[
            {"AttributeName": "venueId",     "KeyType": "HASH"},
            {"AttributeName": "bartenderId", "KeyType": "RANGE"},
        ],
        BillingMode="PAY_PER_REQUEST",
        Tags=[
            {"Key": "Project", "Value": "VenueScope"},
            {"Key": "ManagedBy", "Value": "deploy_aws.py"},
        ],
    )
    # Wait for ACTIVE
    for _ in range(30):
        r = ddb.describe_table(TableName="BartenderProfiles")
        if r["Table"]["TableStatus"] == "ACTIVE":
            break
        time.sleep(2)
    print(f"{OK} BartenderProfiles table created (PAY_PER_REQUEST)")

# Also verify VenueScopeJobs exists
try:
    ddb.describe_table(TableName="VenueScopeJobs")
    print(f"{OK} VenueScopeJobs table exists")
except ddb.exceptions.ResourceNotFoundException:
    print("  Creating VenueScopeJobs table...")
    ddb.create_table(
        TableName="VenueScopeJobs",
        AttributeDefinitions=[
            {"AttributeName": "venueId", "AttributeType": "S"},
            {"AttributeName": "jobId",   "AttributeType": "S"},
        ],
        KeySchema=[
            {"AttributeName": "venueId", "KeyType": "HASH"},
            {"AttributeName": "jobId",   "KeyType": "RANGE"},
        ],
        BillingMode="PAY_PER_REQUEST",
    )
    for _ in range(30):
        r = ddb.describe_table(TableName="VenueScopeJobs")
        if r["Table"]["TableStatus"] == "ACTIVE":
            break
        time.sleep(2)
    print(f"{OK} VenueScopeJobs table created")

# ── 2. IAM Role for AppSync → DynamoDB ───────────────────────────────────────

section("2. IAM — AppSync DynamoDB service role")

ROLE_NAME   = "AppSyncVenueScopeDynamoDBRole"
POLICY_NAME = "AppSyncVenueScopeDynamoDB"

trust_policy = json.dumps({
    "Version": "2012-10-17",
    "Statement": [{
        "Effect": "Allow",
        "Principal": {"Service": "appsync.amazonaws.com"},
        "Action": "sts:AssumeRole"
    }]
})

ddb_policy = json.dumps({
    "Version": "2012-10-17",
    "Statement": [{
        "Effect": "Allow",
        "Action": [
            "dynamodb:GetItem",
            "dynamodb:PutItem",
            "dynamodb:DeleteItem",
            "dynamodb:UpdateItem",
            "dynamodb:Query",
            "dynamodb:Scan",
            "dynamodb:BatchGetItem",
            "dynamodb:BatchWriteItem"
        ],
        "Resource": [
            f"arn:aws:dynamodb:{REGION}:{ACCOUNT_ID}:table/VenueScopeJobs",
            f"arn:aws:dynamodb:{REGION}:{ACCOUNT_ID}:table/VenueScopeJobs/*",
            f"arn:aws:dynamodb:{REGION}:{ACCOUNT_ID}:table/BartenderProfiles",
            f"arn:aws:dynamodb:{REGION}:{ACCOUNT_ID}:table/BartenderProfiles/*",
            f"arn:aws:dynamodb:{REGION}:{ACCOUNT_ID}:table/SensorData",
            f"arn:aws:dynamodb:{REGION}:{ACCOUNT_ID}:table/SensorData/*",
            f"arn:aws:dynamodb:{REGION}:{ACCOUNT_ID}:table/Locations",
            f"arn:aws:dynamodb:{REGION}:{ACCOUNT_ID}:table/Locations/*",
            f"arn:aws:dynamodb:{REGION}:{ACCOUNT_ID}:table/OccupancyMetrics",
            f"arn:aws:dynamodb:{REGION}:{ACCOUNT_ID}:table/OccupancyMetrics/*",
            f"arn:aws:dynamodb:{REGION}:{ACCOUNT_ID}:table/VenueConfig",
            f"arn:aws:dynamodb:{REGION}:{ACCOUNT_ID}:table/VenueConfig/*",
            f"arn:aws:dynamodb:{REGION}:{ACCOUNT_ID}:table/UserSettings",
            f"arn:aws:dynamodb:{REGION}:{ACCOUNT_ID}:table/UserSettings/*",
        ]
    }]
})

try:
    role = iam.get_role(RoleName=ROLE_NAME)
    role_arn = role["Role"]["Arn"]
    print(f"{SKIP} Role {ROLE_NAME} already exists")
except iam.exceptions.NoSuchEntityException:
    role = iam.create_role(
        RoleName=ROLE_NAME,
        AssumeRolePolicyDocument=trust_policy,
        Description="AppSync service role for VenueScope DynamoDB access",
    )
    role_arn = role["Role"]["Arn"]
    iam.put_role_policy(
        RoleName=ROLE_NAME,
        PolicyName=POLICY_NAME,
        PolicyDocument=ddb_policy,
    )
    time.sleep(10)  # IAM propagation
    print(f"{OK} Created role {ROLE_NAME}")

print(f"{OK} Role ARN: {role_arn}")

# ── 3. AppSync Schema Update ──────────────────────────────────────────────────

section("3. AppSync — Schema update")

SCHEMA = r"""
type SensorData {
  venueId: ID!
  timestamp: String!
  decibels: Float
  light: Float
  indoorTemp: Float
  outdoorTemp: Float
  humidity: Float
  currentSong: String
  albumArt: String
  artist: String
  occupancy: OccupancyData
  sensors: SensorValues
  spotify: SpotifyInfo
}
type SensorValues {
  sound_level: Float
  peak_db: Float
  light_level: Float
  indoor_temperature: Float
  humidity: Float
}
type SpotifyInfo {
  current_song: String
  artist: String
  album_art: String
}
type DeviceBreakdown {
  phone: Int
  watch: Int
  tablet: Int
  computer: Int
  headphones: Int
  beacon: Int
  other: Int
  unknown: Int
}
type OccupancyData {
  current: Int
  entries: Int
  exits: Int
  capacity: Int
  total_devices: Int
  device_breakdown: DeviceBreakdown
  avg_stay_minutes: Float
  longest_current_minutes: Float
  total_visits_tracked: Int
}
type SensorDataConnection {
  items: [SensorData]
  nextToken: String
}
type Location {
  locationId: ID!
  venueId: ID!
  displayName: String
  locationName: String
  address: String
  timezone: String
  deviceId: String
  mqttTopic: String
}
type LocationConnection {
  items: [Location]
  nextToken: String
}
type OccupancyMetrics {
  venueId: ID!
  current: Int
  todayEntries: Int
  todayExits: Int
  peakOccupancy: Int
  peakTime: String
  sevenDayAvg: Float
  fourteenDayAvg: Float
  thirtyDayAvg: Float
}
type VenueConfig {
  venueId: ID!
  locationId: ID!
  displayName: String
  locationName: String
  mqttTopic: String
  iotEndpoint: String
  devices: [Device]
}
type Device {
  deviceId: ID!
  locationId: String!
  thingArn: String
  certificateArn: String
  status: String
  createdAt: String
  archivedAt: String
  thingDetails: ThingDetails
}
type ThingDetails {
  version: Int
  defaultClientId: String
  attributes: AWSJSON
}
type DeviceList {
  success: Boolean!
  venueId: ID!
  deviceCount: Int!
  devices: [Device]
}
type CreateVenueResponse {
  success: Boolean!
  message: String
  venueId: ID
  ownerEmail: String
}
type CreateUserResponse {
  success: Boolean!
  message: String
  username: String
}
type UpdateUserPermissionsResponse {
  success: Boolean!
  message: String
  username: String
}
type ResetPasswordResponse {
  success: Boolean!
  message: String
  username: String
}
type GenerateRPiConfigResponse {
  success: Boolean!
  config: AWSJSON
  certificates: AWSJSON
  files: AWSJSON
  instructions: String
}
type ProvisionDeviceResponse {
  success: Boolean!
  message: String
  device: AWSJSON
}
type ArchiveDeviceResponse {
  success: Boolean!
  message: String
  device: AWSJSON
}
type BartenderProfile {
  venueId: ID!
  bartenderId: String!
  name: String
  displayName: String
  totalShifts: Int
  totalDrinks: Int
  totalHours: Float
  avgDrinksPerHour: Float
  peakDrinksPerHour: Float
  theftFlags: Int
  lastSeen: String
  shiftHistory: String
  avgIdlePct: Float
  tableVisits: Int
  createdAt: String
  updatedAt: String
}
type BartenderProfileConnection {
  items: [BartenderProfile]
  nextToken: String
}
type VenueScopeJob {
  venueId: ID!
  jobId: String!
  clipLabel: String
  analysisMode: String
  activeModes: String
  totalDrinks: Int
  drinksPerHour: Float
  topBartender: String
  confidenceScore: Int
  confidenceLabel: String
  confidenceColor: String
  hasTheftFlag: Boolean
  unrungDrinks: Int
  cameraLabel: String
  createdAt: Float
  finishedAt: Float
  status: String
  s3ClipKey: String
  summaryS3Key: String
  progressPct: Float
  statusMsg: String
  updatedAt: Float
  cameraAngle: String
  reviewCount: Int
  bottleCount: Int
  peakBottleCount: Int
  pourCount: Int
  totalPouredOz: Float
  overPours: Int
  walkOutAlerts: Int
  unknownBottleAlerts: Int
  parLowEvents: Int
  totalEntries: Int
  totalExits: Int
  peakOccupancy: Int
  totalTurns: Int
  avgResponseSec: Float
  avgDwellMin: Float
  uniqueStaff: Int
  peakHeadcount: Int
  avgIdlePct: Float
  isLive: Boolean
  roomLabel: String
  bartenderBreakdown: String
  elapsedSec: Float
  posProvider: String
  posRevenue: Float
  posItemCount: Int
  posCameraCount: Int
  posVariancePct: Float
  posVarianceDrinks: Int
  posLostRevenue: Float
  tableVisitsByStaff: String
}
type VenueScopeJobConnection {
  items: [VenueScopeJob]
  nextToken: String
}
type Query {
  listVenueScopeJobs(
    venueId: ID!
    limit: Int
    nextToken: String
  ): VenueScopeJobConnection
    @aws_cognito_user_pools
  listBartenderProfiles(
    venueId: ID!
    limit: Int
    nextToken: String
  ): BartenderProfileConnection
    @aws_cognito_user_pools
  getBartenderProfile(
    venueId: ID!
    bartenderId: String!
  ): BartenderProfile
    @aws_cognito_user_pools
  getSensorData(venueId: ID!, timestamp: String!): SensorData
    @aws_cognito_user_pools
  listSensorData(
    venueId: ID!
    startTime: String!
    endTime: String!
    limit: Int
    nextToken: String
  ): SensorDataConnection
    @aws_cognito_user_pools
  listVenueLocations(
    venueId: ID!
    limit: Int
    nextToken: String
  ): LocationConnection
    @aws_cognito_user_pools
  getOccupancyMetrics(venueId: ID!): OccupancyMetrics
    @aws_cognito_user_pools
  getVenueConfig(venueId: ID!, locationId: String!): VenueConfig
    @aws_cognito_user_pools
  listVenueDevices(venueId: ID!): DeviceList
    @aws_cognito_user_pools
}
type Mutation {
  createVenue(
    venueName: String!
    venueId: String!
    locationName: String!
    locationId: String!
    ownerEmail: String!
    ownerName: String!
    tempPassword: String!
  ): CreateVenueResponse
    @aws_cognito_user_pools
  createUser(
    venueId: String!
    venueName: String!
    email: String!
    name: String!
    role: String!
    tempPassword: String!
  ): CreateUserResponse
    @aws_cognito_user_pools
  updateUserPermissions(
    email: String!
    role: String!
  ): UpdateUserPermissionsResponse
    @aws_cognito_user_pools
  resetUserPassword(
    email: String!
    newPassword: String!
  ): ResetPasswordResponse
    @aws_cognito_user_pools
  generateRPiConfig(
    venueId: String!
    venueName: String
    locationId: String!
    locationName: String
    deviceId: String
  ): GenerateRPiConfigResponse
    @aws_cognito_user_pools
  provisionDevice(
    venueId: String!
    locationId: String!
  ): ProvisionDeviceResponse
    @aws_cognito_user_pools
  archiveDevice(
    venueId: String!
    deviceId: String!
  ): ArchiveDeviceResponse
    @aws_cognito_user_pools
}
type Schema {
  query: Query
  mutation: Mutation
}
""".strip()

print("  Uploading schema...")
appsync.start_schema_creation(apiId=API_ID, definition=SCHEMA.encode())
if wait_schema_active(API_ID):
    print(f"{OK} Schema updated successfully")
else:
    print(f"{ERR} Schema update failed — check AppSync console")
    sys.exit(1)

# ── 4. AppSync Data Sources ───────────────────────────────────────────────────

section("4. AppSync — Data sources")

def upsert_data_source(name, table_name):
    config = {
        "tableName": table_name,
        "awsRegion": REGION,
        "useCallerCredentials": False,
        "versioned": False,
        "deltaSyncConfig": {},
    }
    try:
        existing = appsync.get_data_source(apiId=API_ID, name=name)
        appsync.update_data_source(
            apiId=API_ID,
            name=name,
            type="AMAZON_DYNAMODB",
            serviceRoleArn=role_arn,
            dynamodbConfig=config,
        )
        print(f"{SKIP} Data source {name} updated (already existed)")
    except appsync.exceptions.NotFoundException:
        appsync.create_data_source(
            apiId=API_ID,
            name=name,
            type="AMAZON_DYNAMODB",
            serviceRoleArn=role_arn,
            dynamodbConfig=config,
        )
        print(f"{OK} Data source {name} created")

upsert_data_source("VenueScopeJobsDS",     "VenueScopeJobs")
upsert_data_source("BartenderProfilesDS",  "BartenderProfiles")
upsert_data_source("SensorDataDS",         "SensorData")
upsert_data_source("LocationsDS",          "Locations")
upsert_data_source("OccupancyMetricsDS",   "OccupancyMetrics")
upsert_data_source("VenueConfigDS",        "VenueConfig")

# ── 5. AppSync Resolvers ──────────────────────────────────────────────────────

section("5. AppSync — Resolvers")

# VTL request/response templates
QUERY_REQ = """{
  "version": "2017-02-28",
  "operation": "Query",
  "query": {
    "expression": "venueId = :venueId",
    "expressionValues": {
      ":venueId": $util.dynamodb.toDynamoDBJson($ctx.args.venueId)
    }
  },
  "limit": $util.defaultIfNull($ctx.args.limit, 100),
  "scanIndexForward": false,
  "nextToken": $util.toJson($util.defaultIfNullOrEmpty($ctx.args.nextToken, null))
}"""

QUERY_RESP = """{
  "items": $util.toJson($ctx.result.items),
  "nextToken": $util.toJson($ctx.result.nextToken)
}"""

GET_ITEM_REQ_VENUESCOPEJOB = """{
  "version": "2017-02-28",
  "operation": "Query",
  "query": {
    "expression": "venueId = :venueId",
    "expressionValues": {
      ":venueId": $util.dynamodb.toDynamoDBJson($ctx.args.venueId)
    }
  },
  "limit": $util.defaultIfNull($ctx.args.limit, 100),
  "scanIndexForward": false,
  "nextToken": $util.toJson($util.defaultIfNullOrEmpty($ctx.args.nextToken, null))
}"""

GET_BARTENDER_REQ = """{
  "version": "2017-02-28",
  "operation": "GetItem",
  "key": {
    "venueId":     $util.dynamodb.toDynamoDBJson($ctx.args.venueId),
    "bartenderId": $util.dynamodb.toDynamoDBJson($ctx.args.bartenderId)
  }
}"""

GET_ITEM_RESP = "$util.toJson($ctx.result)"

SENSOR_REQ = """{
  "version": "2017-02-28",
  "operation": "GetItem",
  "key": {
    "venueId":   $util.dynamodb.toDynamoDBJson($ctx.args.venueId),
    "timestamp": $util.dynamodb.toDynamoDBJson($ctx.args.timestamp)
  }
}"""

LIST_SENSOR_REQ = """{
  "version": "2017-02-28",
  "operation": "Query",
  "query": {
    "expression": "venueId = :venueId AND #ts BETWEEN :start AND :end",
    "expressionNames": { "#ts": "timestamp" },
    "expressionValues": {
      ":venueId": $util.dynamodb.toDynamoDBJson($ctx.args.venueId),
      ":start":   $util.dynamodb.toDynamoDBJson($ctx.args.startTime),
      ":end":     $util.dynamodb.toDynamoDBJson($ctx.args.endTime)
    }
  },
  "limit": $util.defaultIfNull($ctx.args.limit, 288),
  "nextToken": $util.toJson($util.defaultIfNullOrEmpty($ctx.args.nextToken, null))
}"""

LOCATIONS_REQ = """{
  "version": "2017-02-28",
  "operation": "Query",
  "query": {
    "expression": "venueId = :venueId",
    "expressionValues": {
      ":venueId": $util.dynamodb.toDynamoDBJson($ctx.args.venueId)
    }
  },
  "limit": $util.defaultIfNull($ctx.args.limit, 50),
  "nextToken": $util.toJson($util.defaultIfNullOrEmpty($ctx.args.nextToken, null))
}"""

OCCUPANCY_REQ = """{
  "version": "2017-02-28",
  "operation": "GetItem",
  "key": {
    "venueId": $util.dynamodb.toDynamoDBJson($ctx.args.venueId)
  }
}"""

VENUE_CONFIG_REQ = """{
  "version": "2017-02-28",
  "operation": "GetItem",
  "key": {
    "venueId":    $util.dynamodb.toDynamoDBJson($ctx.args.venueId),
    "locationId": $util.dynamodb.toDynamoDBJson($ctx.args.locationId)
  }
}"""

resolvers = [
    # (typeName, fieldName, dataSourceName, requestTemplate, responseTemplate)
    ("Query", "listVenueScopeJobs",    "VenueScopeJobsDS",    QUERY_REQ,           QUERY_RESP),
    ("Query", "listBartenderProfiles", "BartenderProfilesDS", QUERY_REQ,           QUERY_RESP),
    ("Query", "getBartenderProfile",   "BartenderProfilesDS", GET_BARTENDER_REQ,   GET_ITEM_RESP),
    ("Query", "getSensorData",         "SensorDataDS",        SENSOR_REQ,          GET_ITEM_RESP),
    ("Query", "listSensorData",        "SensorDataDS",        LIST_SENSOR_REQ,     QUERY_RESP),
    ("Query", "listVenueLocations",    "LocationsDS",         LOCATIONS_REQ,       QUERY_RESP),
    ("Query", "getOccupancyMetrics",   "OccupancyMetricsDS",  OCCUPANCY_REQ,       GET_ITEM_RESP),
    ("Query", "getVenueConfig",        "VenueConfigDS",       VENUE_CONFIG_REQ,    GET_ITEM_RESP),
]

for type_name, field_name, ds_name, req_tmpl, resp_tmpl in resolvers:
    try:
        appsync.get_resolver(apiId=API_ID, typeName=type_name, fieldName=field_name)
        appsync.update_resolver(
            apiId=API_ID,
            typeName=type_name,
            fieldName=field_name,
            dataSourceName=ds_name,
            requestMappingTemplate=req_tmpl,
            responseMappingTemplate=resp_tmpl,
        )
        print(f"{SKIP} Resolver {field_name} updated")
    except appsync.exceptions.NotFoundException:
        appsync.create_resolver(
            apiId=API_ID,
            typeName=type_name,
            fieldName=field_name,
            dataSourceName=ds_name,
            requestMappingTemplate=req_tmpl,
            responseMappingTemplate=resp_tmpl,
        )
        print(f"{OK} Resolver {field_name} created")

# ── 6. Verify / fix Cognito user venueId ─────────────────────────────────────

section("6. Cognito — Verify Blind Goat user")

print("  Searching for users with custom:venueId = theblindgoat...")
try:
    resp = cognito.list_users(
        UserPoolId=USER_POOL,
        Filter='username ^= "theblindgoat"',
        Limit=10,
    )
    users = resp.get("Users", [])

    if not users:
        # Try by email attribute
        resp2 = cognito.list_users(
            UserPoolId=USER_POOL,
            Limit=60,
        )
        users = [u for u in resp2.get("Users", [])
                 if any(a["Name"] == "custom:venueId" and a["Value"] == "theblindgoat"
                        for a in u.get("Attributes", []))]

    if not users:
        print(f"  No users found with venueId=theblindgoat")
        print("  Listing all users to help you identify the right account:")
        resp3 = cognito.list_users(UserPoolId=USER_POOL, Limit=20)
        for u in resp3.get("Users", []):
            email = next((a["Value"] for a in u["Attributes"] if a["Name"] == "email"), "?")
            vid   = next((a["Value"] for a in u["Attributes"] if a["Name"] == "custom:venueId"), "NOT SET")
            print(f"    {u['Username']:30s}  email={email:40s}  venueId={vid}")
    else:
        for u in users:
            email = next((a["Value"] for a in u["Attributes"] if a["Name"] == "email"), "?")
            vid   = next((a["Value"] for a in u["Attributes"] if a["Name"] == "custom:venueId"), "NOT SET")
            status = u["UserStatus"]
            print(f"{OK} Found: {u['Username']}  email={email}  venueId={vid}  status={status}")
            if vid != "theblindgoat":
                print(f"  ⚠  venueId is '{vid}', not 'theblindgoat' — fixing...")
                cognito.admin_update_user_attributes(
                    UserPoolId=USER_POOL,
                    Username=u["Username"],
                    UserAttributes=[{"Name": "custom:venueId", "Value": "theblindgoat"}],
                )
                print(f"{OK} Fixed: custom:venueId set to 'theblindgoat'")

except Exception as e:
    print(f"  Cognito check failed (non-fatal): {e}")
    print("  → Manually verify in Cognito console that the Blind Goat login has custom:venueId = theblindgoat")

# ── 7. Grant venuescope-writer DynamoDB Query permission ─────────────────────

section("7. IAM — Grant venuescope-writer Query permission")

WRITER_POLICY = json.dumps({
    "Version": "2012-10-17",
    "Statement": [
        {
            "Sid": "VenueScopeWriterCore",
            "Effect": "Allow",
            "Action": [
                "dynamodb:PutItem",
                "dynamodb:UpdateItem",
                "dynamodb:GetItem",
                "dynamodb:Query",
            ],
            "Resource": [
                f"arn:aws:dynamodb:{REGION}:{ACCOUNT_ID}:table/VenueScopeJobs",
                f"arn:aws:dynamodb:{REGION}:{ACCOUNT_ID}:table/VenueScopeJobs/*",
                f"arn:aws:dynamodb:{REGION}:{ACCOUNT_ID}:table/BartenderProfiles",
                f"arn:aws:dynamodb:{REGION}:{ACCOUNT_ID}:table/BartenderProfiles/*",
            ]
        }
    ]
})

try:
    # Find venuescope-writer user's inline policies
    existing = iam.list_user_policies(UserName="venuescope-writer")
    iam.put_user_policy(
        UserName="venuescope-writer",
        PolicyName="VenueScopeWriterPolicy",
        PolicyDocument=WRITER_POLICY,
    )
    print(f"{OK} Updated venuescope-writer policy (added Query + BartenderProfiles)")
except Exception as e:
    print(f"  Could not update venuescope-writer policy: {e}")
    print(f"  → Manually add dynamodb:Query to venuescope-writer in IAM console")

# ── Done ──────────────────────────────────────────────────────────────────────

section("DEPLOYMENT COMPLETE")
print(f"""
  AppSync API:     {API_ID}
  Region:          {REGION}

  Tables created/verified:
    ✓ VenueScopeJobs
    ✓ BartenderProfiles

  AppSync resolvers active:
    ✓ listVenueScopeJobs
    ✓ listBartenderProfiles
    ✓ getBartenderProfile
    ✓ getSensorData / listSensorData
    ✓ listVenueLocations
    ✓ getOccupancyMetrics
    ✓ getVenueConfig

  Next steps:
    1. Deploy React app → Amplify: git push origin main
    2. Set env vars on DO server:
         SQUARE_ACCESS_TOKEN=<your_token>
         SQUARE_LOCATION_ID=<your_location>
    3. Log into the Blind Goat dashboard and check VenueScope tab
""")
