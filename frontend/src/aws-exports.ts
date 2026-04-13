// Cognito / Amplify configuration – replace with real values via environment or deployment config
const awsExports = {
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID ?? 'us-east-1_PLACEHOLDER',
      userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID ?? 'PLACEHOLDER_CLIENT_ID',
      loginWith: {
        email: true,
      },
    },
  },
}

export default awsExports
