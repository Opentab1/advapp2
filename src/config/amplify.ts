import { Amplify } from 'aws-amplify';

const amplifyConfig = {
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID || 'us-east-1_example',
      userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID || 'example-client-id',
      identityPoolId: import.meta.env.VITE_COGNITO_IDENTITY_POOL_ID,
      loginWith: {
        oauth: {
          domain: 'your-domain.auth.us-east-1.amazoncognito.com',
          scopes: ['email', 'openid', 'profile'],
          redirectSignIn: ['http://localhost:5173/', 'https://your-app.amplifyapp.com/'],
          redirectSignOut: ['http://localhost:5173/', 'https://your-app.amplifyapp.com/'],
          responseType: 'code' as const
        },
        email: true
      }
    }
  }
};

export function configureAmplify() {
  Amplify.configure(amplifyConfig);
}

export default amplifyConfig;
