import { Amplify } from 'aws-amplify';

const amplifyConfig = {
  Auth: {
    Cognito: {
      userPoolId: 'us-east-2_I6EBJm3te',
      userPoolClientId: '4v7vp7trh72q1priqno9k5prsq',
      loginWith: {
        email: true
      }
    }
  }
};

export function configureAmplify() {
  Amplify.configure(amplifyConfig);
}

export default amplifyConfig;
