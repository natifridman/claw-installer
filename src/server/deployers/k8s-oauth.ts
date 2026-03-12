import * as k8s from "@kubernetes/client-node";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import jsYaml from "js-yaml";
import { coreApi } from "../services/k8s.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadOpenshiftYaml(filename: string, vars: Record<string, string>): string {
  let content = readFileSync(join(__dirname, "openshift", filename), "utf-8");
  for (const [key, value] of Object.entries(vars)) {
    content = content.replaceAll(key, value);
  }
  return content;
}

export function oauthProxyContainer(ns: string): k8s.V1Container {
  const yaml = loadOpenshiftYaml("oauth-proxy-container.yaml", {
    __CLIENT_ID__: `system:serviceaccount:${ns}:openclaw-oauth-proxy`,
  });
  return jsYaml.load(yaml) as k8s.V1Container;
}

export function oauthServiceAccount(ns: string): k8s.V1ServiceAccount {
  const yaml = loadOpenshiftYaml("serviceaccount.yaml", {
    __NAMESPACE__: ns,
  });
  return jsYaml.load(yaml) as k8s.V1ServiceAccount;
}

export async function oauthConfigSecret(ns: string): Promise<k8s.V1Secret> {
  // For SA-based OAuth, the client-secret must be a valid SA token.
  // Create a token for the openclaw-oauth-proxy SA.
  let clientSecret: string;
  try {
    const core = coreApi();
    const tokenRequest: k8s.AuthenticationV1TokenRequest = {
      apiVersion: "authentication.k8s.io/v1",
      kind: "TokenRequest",
      spec: { audiences: [], expirationSeconds: 365 * 24 * 3600 }, // 1 year
    };
    const result = await core.createNamespacedServiceAccountToken({
      name: "openclaw-oauth-proxy",
      namespace: ns,
      body: tokenRequest,
    });
    clientSecret = result.status?.token || "";
  } catch {
    // Fallback: use a generated token (requires OAuthClient cluster resource)
    clientSecret = randomBytes(32).toString("base64");
  }

  return {
    apiVersion: "v1",
    kind: "Secret",
    metadata: {
      name: "openclaw-oauth-config",
      namespace: ns,
      labels: { app: "openclaw" },
    },
    stringData: {
      "client-secret": clientSecret,
      cookie_secret: randomBytes(16).toString("hex"),
    },
  };
}
