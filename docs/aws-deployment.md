# Deploy to AWS

The workflows deploy the **website, chat API, MCP server, product images, and buyer console together** as
one Docker container on AWS Lightsail Containers. Lightsail supplies the HTTPS address automatically.
The first run creates the service; later runs upload a new image and update it. No S3 bucket, CloudFront
distribution, ECR repository, DNS record, or server setup is needed.

## One-time setup

1. In AWS IAM, attach the permissions in [aws-deploy-policy.json](../scripts/aws-deploy-policy.json) to
   your deployment user. An existing user that could only upload to S3 will need these permissions too.
   The policy restricts deployment to Frankfurt (`eu-central-1`).
2. In GitHub, open **Settings → Secrets and variables → Actions** and add these repository secrets:

   | Secret                  | Required                     | Value                                                                           |
   | ----------------------- | ---------------------------- | ------------------------------------------------------------------------------- |
   | `AWS_ACCESS_KEY_ID`     | Yes, unless using OIDC below | Deployment user's access key ID                                                 |
   | `AWS_SECRET_ACCESS_KEY` | Yes, unless using OIDC below | Matching secret access key                                                      |
   | `GEMINI_API_KEY`        | For conversational AI        | Gemini API key; without it the app uses its rules engine                        |
   | `VALIO_API_KEY`         | Optional                     | Enables the supplier estimate flow; prices and stock still use mock data        |
   | `SIGNING_KEY`           | Optional                     | PKCS#8 Ed25519 private key, to keep quote signatures consistent across restarts |

3. Push to `main`, or open **Actions → Deploy production to AWS → Run workflow** on `main`.
4. Open the successful run's **Summary** for your website, console, and MCP URLs.

Existing AWS key secrets can be reused. S3 and CloudFront secrets are no longer read or needed. Existing
S3/CloudFront resources are left untouched and can be removed separately when no longer needed.

The workflow creates `valio-production` in Frankfurt, using a **Small, one-node** container service.
Each configured development branch deploys to its own service, such as `valio-dev-simon`. These are
separate, billable services. Delete unused services in the Lightsail console; pushing again recreates them.
The old development branch list is preserved in `dev-aws.yml`; remove branches there to stop automatic
development deployments.

Optional repository **variables**: `AWS_REGION` (default `eu-central-1`; update the IAM policy to match
if you change it), `GEMINI_MODEL`, and `VALIO_CUSTOMER_ID`.

## What gets deployed

| Path          | Application                                           |
| ------------- | ----------------------------------------------------- |
| `/assistant/` | Website and chat                                      |
| `/app/`       | Buyer console, MCP tokens, approvals and limits       |
| `/mcp`        | MCP endpoint; requires a token created in the console |
| `/health`     | Deployment health check                               |

The deployment sets `PUBLIC_URL` and `ALLOWED_HOSTS` to the actual HTTPS hostname, so product images,
MCP links, and approval links point to the deployed app. Runtime keys are sent directly to AWS; they
are not included in the Docker build or frontend assets. Anonymous MCP access is disabled.

The old standalone `apps/api` shop backend is not deployed: the active Assistant and console use the
gateway's API. The old shop pages are not routed in the current website.

Before uploading, CI runs type checks, regression tests, builds the complete Docker image, and checks
that the container serves the website, console, photos, and health endpoint. A deployment is successful
only after the new version is active and its public health endpoint returns success.

## Demo data and persistence

This deploys the current **demo application**. Mock prices and availability are enabled explicitly.
Orders, chats on the server, and other in-memory state reset when the process restarts. Files under
`DATA_DIR`, including MCP token hashes and sourcing preferences, are not durable on Lightsail Containers;
they also reset when the container is replaced. Recreate connector tokens after redeploying.

The buyer console and its management API currently have no login. Anyone with the deployed URL can
change demo settings and create MCP tokens. This setup is suitable for the existing demo; add
authentication and external persistent storage before using real buyer accounts or orders.

## Optional: use GitHub OIDC instead of access keys

The same workflows support OIDC. Create a GitHub Actions IAM role with the deployment policy, configure
the `token.actions.githubusercontent.com` identity provider, and restrict the role trust to your repo:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
        "StringLike": { "token.actions.githubusercontent.com:sub": "repo:OWNER/REPOSITORY:ref:refs/heads/*" }
      }
    }
  ]
}
```

Replace `ACCOUNT_ID`, `OWNER`, and `REPOSITORY`. Add the role ARN as the GitHub secret `AWS_ROLE_ARN`.
When this is set, the workflow uses short-lived role credentials and ignores the AWS access key secrets.
Narrow the branch trust pattern to `main` if you only deploy production.

## Troubleshooting and rollback

- **Access denied:** attach the deployment policy to the IAM user or OIDC role. If your account requires
  a Lightsail service-linked role to be created by an administrator, have them initialize Lightsail first.
- **Workflow fails before upload:** open the type-check, test, or Docker build step. AWS is not updated.
- **Deployment fails:** open Lightsail → Containers → service → Deployments and Logs. The previous
  active deployment is not reported as success by the workflow.
- **Roll back:** redeploy an earlier version from the Lightsail console, or revert the commit and push.
- **Change size:** edit the existing service capacity in Lightsail. The script preserves existing capacity;
  its Small, one-node setting applies only to initial creation.

AWS references: [container services and HTTPS](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-container-services.html),
[image uploads](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-pushing-container-images.html),
[IAM actions](https://docs.aws.amazon.com/service-authorization/latest/reference/list_lightsail.html),
[current pricing](https://aws.amazon.com/lightsail/pricing/).
