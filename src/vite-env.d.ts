/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_COGNITO_USER_POOL_ID: string;
  readonly VITE_COGNITO_CLIENT_ID: string;
  readonly VITE_COGNITO_IDENTITY_POOL_ID?: string;
  readonly VITE_AWS_REGION: string;
  readonly VITE_IOT_ENDPOINT?: string;
  readonly VITE_APPSYNC_GRAPHQL_ENDPOINT?: string;
  readonly VITE_APPSYNC_AUTH_MODE?: string;
  readonly VITE_APPSYNC_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
