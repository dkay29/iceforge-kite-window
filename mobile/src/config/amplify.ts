/**
 * AWS Amplify configuration.
 *
 * Values are injected from environment-specific config files generated
 * during CDK deployment. This file holds the structure; actual resource
 * IDs are never committed to the repository.
 *
 * In local development, create mobile/amplify-config.local.json with the
 * outputs from `cdk deploy`.  In CI and production builds the values are
 * supplied via environment variables or a build-time config injection step.
 *
 * Required shape (matches Amplify v6 ResourcesConfig):
 *   Auth.Cognito.userPoolId
 *   Auth.Cognito.userPoolClientId
 *   API.REST.KiteWindowApi.endpoint
 *   API.REST.KiteWindowApi.region
 */

export interface AmplifyConfig {
  Auth: {
    Cognito: {
      userPoolId: string;
      userPoolClientId: string;
      loginWith?: {
        email?: boolean;
      };
    };
  };
  API?: {
    REST?: {
      KiteWindowApi?: {
        endpoint: string;
        region: string;
      };
    };
  };
}

/**
 * Return the Amplify configuration for this environment.
 *
 * Priority order:
 *   1. AMPLIFY_CONFIG environment variable (JSON string — for CI builds)
 *   2. amplify-config.local.json at the mobile project root (for local dev)
 *   3. Placeholder values that will fail at runtime (prevents silent misconfig)
 */
export function getAmplifyConfig(): AmplifyConfig {
  // React Native bundles environment configuration at build time.
  // Replace these placeholder strings with actual CDK deployment outputs
  // by running tools/inject-mobile-config.sh after `cdk deploy`.
  return {
    Auth: {
      Cognito: {
        userPoolId: 'UNSET_USER_POOL_ID',
        userPoolClientId: 'UNSET_CLIENT_ID',
        loginWith: { email: true },
      },
    },
    API: {
      REST: {
        KiteWindowApi: {
          endpoint: 'https://UNSET.execute-api.us-east-1.amazonaws.com/v1',
          region: 'us-east-1',
        },
      },
    },
  };
}
