import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

// These stand in for gcloud and curl and sit first on PATH, so the real gcloud is never reached.
const GCLOUD_STUB = `#!/bin/sh
echo "gcloud $*" >> "$STUB_LOG"
case "$*" in
  *--lifecycle-file=*)
    all="$*"
    file=\${all#*--lifecycle-file=}
    file=\${file%% *}
    echo "lifecycle $(cat "$file")" >> "$STUB_LOG"
    ;;
  *"versions add"*) echo "stdin $(cat)" >> "$STUB_LOG" ;;
esac
case "$*" in
  "secrets describe "*) name=$3; case " $STUB_SECRETS " in *" $name "*) exit 0 ;; *) exit 1 ;; esac ;;
  "iam service-accounts describe "*) [ "$STUB_SA_EXISTS" = "1" ] ;;
  "storage buckets describe "*) [ "$STUB_BUCKET_EXISTS" = "1" ] ;;
  "projects describe "*) echo 123456789 ;;
  "run services describe "*) echo https://mock-call-abc.a.run.app ;;
esac
`;
const CURL_STUB = `#!/bin/sh
echo "curl $*" >> "$STUB_LOG"
printf '%s' "\${STUB_HTTP_CODE:-200}"
`;

interface Scenario {
  args?: string[];
  retentionDays?: number | null;
  env?: Record<string, string>;
  existingSecrets?: string[];
  serviceAccountExists?: boolean;
  bucketExists?: boolean;
  httpCode?: string;
}

interface Outcome {
  code: number;
  stdout: string;
  stderr: string;
  calls: string[];
}

const SECRET_NAMES = ["anthropic-key", "elevenlabs-key", "access-code"];
const SECRET_ENV = {
  ANTHROPIC_API_KEY: "sk-ant-TESTVALUE",
  ELEVENLABS_API_KEY: "el-TESTVALUE",
  ACCESS_CODE: "code-TESTVALUE",
};

async function deploy(scenario: Scenario = {}): Promise<Outcome> {
  const dir = await mkdtemp(join(tmpdir(), "mock-call-deploy-"));
  dirs.push(dir);
  const log = join(dir, "calls.log");
  await writeFile(log, "");
  for (const [name, body] of [
    ["gcloud", GCLOUD_STUB],
    ["curl", CURL_STUB],
  ] as const) {
    await writeFile(join(dir, name), body);
    await chmod(join(dir, name), 0o755);
  }
  const retention = "retentionDays" in scenario ? scenario.retentionDays : null;
  const pilot = join(dir, "pilot.json");
  await writeFile(pilot, JSON.stringify({ gaps: { retentionDays: retention }, settings: {} }));

  const env = {
    PATH: [dir, dirname(process.execPath), "/usr/bin", "/bin"].join(":"),
    HOME: dir,
    TMPDIR: dir,
    PILOT_CONFIG: pilot,
    RETRY_DELAY: "0",
    STUB_LOG: log,
    STUB_SECRETS: (scenario.existingSecrets ?? []).join(" "),
    STUB_SA_EXISTS: scenario.serviceAccountExists ? "1" : "0",
    STUB_BUCKET_EXISTS: scenario.bucketExists ? "1" : "0",
    STUB_HTTP_CODE: scenario.httpCode ?? "200",
    ...(scenario.env ?? SECRET_ENV),
  };
  const args = scenario.args ?? ["my-project", "us-central1", "demo"];
  let result: { code: number; stdout: string; stderr: string };
  try {
    const ok = await run("/bin/bash", ["deploy/deploy.sh", ...args], { env });
    result = { code: 0, ...ok };
  } catch (error) {
    const failed = error as { code: number; stdout: string; stderr: string };
    result = { code: failed.code, stdout: failed.stdout, stderr: failed.stderr };
  }
  const calls = (await readFile(log, "utf8")).split("\n").filter((line) => line !== "");
  return { ...result, calls };
}

const gcloudCalls = (o: Outcome) => o.calls.filter((c) => c.startsWith("gcloud "));
const find = (o: Outcome, text: string) => o.calls.filter((c) => c.includes(text));

describe("deploy.sh", () => {
  it("passes bash's syntax check", async () => {
    await expect(run("/bin/bash", ["-n", "deploy/deploy.sh"])).resolves.toBeDefined();
  });

  it("deploys the service with the specified flags and prints its URL", async () => {
    const o = await deploy({ retentionDays: 30 });
    expect(o.code).toBe(0);
    expect(o.stdout).toContain("deployed: https://mock-call-abc.a.run.app");

    const [deployCall] = find(o, "run deploy");
    expect(deployCall).toContain("mock-call --source . --region us-central1");
    expect(deployCall).toContain(
      "--service-account mock-call-run@my-project.iam.gserviceaccount.com",
    );
    expect(deployCall).toContain("--allow-unauthenticated");
    expect(deployCall).toContain("--concurrency 40");
    expect(deployCall).toContain("--max-instances 5");
    expect(deployCall).toContain(
      "--set-env-vars MODE=demo,STORAGE=gcs,BUCKET=my-project-mock-call-sessions,STT=scribe,PICKER=claude,SCRIBE_MODEL=scribe_v1",
    );
    expect(deployCall).toContain(
      "--set-secrets ANTHROPIC_API_KEY=anthropic-key:latest,ELEVENLABS_API_KEY=elevenlabs-key:latest,ACCESS_CODE=access-code:latest",
    );
    expect(deployCall).not.toContain("PUBLIC_URL");
  });

  it("enables the five APIs", async () => {
    const o = await deploy({ retentionDays: 30 });
    const [enable] = find(o, "services enable");
    for (const api of [
      "run",
      "cloudbuild",
      "artifactregistry",
      "secretmanager",
      "iamcredentials",
    ]) {
      expect(enable).toContain(`${api}.googleapis.com`);
    }
  });

  it("creates a private bucket in the region and gives the service account object access", async () => {
    const o = await deploy({ retentionDays: 30 });
    const [create] = find(o, "storage buckets create");
    expect(create).toContain("gs://my-project-mock-call-sessions");
    expect(create).toContain("--location us-central1");
    expect(create).toContain("--uniform-bucket-level-access");
    expect(create).toContain("--public-access-prevention");
    const [grant] = find(o, "storage buckets add-iam-policy-binding");
    expect(grant).toContain("serviceAccount:mock-call-run@my-project.iam.gserviceaccount.com");
    expect(grant).toContain("roles/storage.objectUser");
  });

  it("applies a deletion rule for the configured retention", async () => {
    const o = await deploy({ retentionDays: 45 });
    expect(find(o, "storage buckets update")[0]).toContain("gs://my-project-mock-call-sessions");
    expect(find(o, "lifecycle ")).toEqual([
      'lifecycle {"rule":[{"action":{"type":"Delete"},"condition":{"age":45}}]}',
    ]);
  });

  it("with MODE=live and no retention, exits 1 before any gcloud call", async () => {
    const o = await deploy({ args: ["my-project", "us-central1", "live"], retentionDays: null });
    expect(o.code).toBe(1);
    expect(o.stderr).toContain("gaps.retentionDays");
    expect(gcloudCalls(o)).toEqual([]);
  });

  it("with MODE=live and retention set, deploys with MODE=live", async () => {
    const o = await deploy({ args: ["my-project", "us-central1", "live"], retentionDays: 30 });
    expect(o.code).toBe(0);
    expect(find(o, "run deploy")[0]).toContain("MODE=live,");
  });

  it("with MODE=demo and no retention, warns and sets no rule", async () => {
    const o = await deploy({ retentionDays: null });
    expect(o.code).toBe(0);
    expect(o.stderr).toContain("gaps.retentionDays is null");
    expect(find(o, "lifecycle")).toEqual([]);
    expect(find(o, "storage buckets update")).toEqual([]);
    expect(find(o, "run deploy")).toHaveLength(1);
  });

  it.each([0, 7.5, "30", -3])("refuses retentionDays %j", async (value) => {
    const o = await deploy({ retentionDays: value as number });
    expect(o.code).toBe(1);
    expect(gcloudCalls(o)).toEqual([]);
  });

  it("exits 1 naming a key that is unset and has no stored secret, and creates nothing", async () => {
    const o = await deploy({
      retentionDays: 30,
      env: { ANTHROPIC_API_KEY: "sk-ant-TESTVALUE", ACCESS_CODE: "code-TESTVALUE" },
      existingSecrets: ["anthropic-key", "access-code"],
    });
    expect(o.code).toBe(1);
    expect(o.stderr).toContain("ELEVENLABS_API_KEY");
    expect(o.stderr).not.toContain("ANTHROPIC_API_KEY");
    expect(find(o, "secrets create")).toEqual([]);
    expect(find(o, "secrets versions add")).toEqual([]);
    expect(find(o, "run deploy")).toEqual([]);
  });

  it("accepts an unset key when its secret already exists, without adding a version", async () => {
    const o = await deploy({ retentionDays: 30, env: {}, existingSecrets: SECRET_NAMES });
    expect(o.code).toBe(0);
    expect(find(o, "secrets create")).toEqual([]);
    expect(find(o, "secrets versions add")).toEqual([]);
  });

  it("creates missing secrets and adds each value as a version over stdin, not argv", async () => {
    const o = await deploy({ retentionDays: 30 });
    expect(find(o, "secrets create").map((c) => c.split(" ")[3])).toEqual(SECRET_NAMES);
    expect(find(o, "secrets versions add")).toHaveLength(3);
    expect(find(o, "stdin ")).toEqual([
      "stdin sk-ant-TESTVALUE",
      "stdin el-TESTVALUE",
      "stdin code-TESTVALUE",
    ]);
    for (const call of gcloudCalls(o)) expect(call).not.toContain("TESTVALUE");
  });

  it("adds a new version to a secret that exists when its key is set", async () => {
    const o = await deploy({ retentionDays: 30, existingSecrets: SECRET_NAMES });
    expect(find(o, "secrets create")).toEqual([]);
    expect(find(o, "secrets versions add")).toHaveLength(3);
  });

  it("creates the service account when missing and binds its roles", async () => {
    const o = await deploy({ retentionDays: 30 });
    expect(find(o, "iam service-accounts create")[0]).toContain("mock-call-run");
    const self = find(o, "iam service-accounts add-iam-policy-binding")[0];
    expect(self).toContain("mock-call-run@my-project.iam.gserviceaccount.com");
    expect(self).toContain("roles/iam.serviceAccountTokenCreator");
    const accessors = find(o, "secrets add-iam-policy-binding");
    expect(accessors.map((c) => c.split(" ")[3])).toEqual(SECRET_NAMES);
    for (const call of accessors) expect(call).toContain("roles/secretmanager.secretAccessor");
  });

  it("skips creating what already exists", async () => {
    const o = await deploy({
      retentionDays: 30,
      serviceAccountExists: true,
      bucketExists: true,
    });
    expect(o.code, o.stderr).toBe(0);
    expect(find(o, "iam service-accounts create")).toEqual([]);
    expect(find(o, "storage buckets create")).toEqual([]);
  });

  it("grants roles/run.builder to the default compute service account", async () => {
    const o = await deploy({ retentionDays: 30 });
    const [grant] = find(o, "projects add-iam-policy-binding");
    expect(grant).toContain("serviceAccount:123456789-compute@developer.gserviceaccount.com");
    expect(grant).toContain("roles/run.builder");
  });

  it("never deletes anything", async () => {
    const o = await deploy({ retentionDays: 30 });
    for (const call of gcloudCalls(o)) expect(call).not.toMatch(/\b(delete|remove|destroy)\b/);
  });

  it("checks /healthz without credentials", async () => {
    const o = await deploy({ retentionDays: 30 });
    const [check] = find(o, "curl ");
    expect(check).toContain("https://mock-call-abc.a.run.app/healthz");
    expect(check).not.toMatch(/authorization|identity-token|-H /i);
  });

  it("exits 1 and names the organization policy when /healthz answers 403", async () => {
    const o = await deploy({ retentionDays: 30, httpCode: "403" });
    expect(o.code).toBe(1);
    expect(o.stderr).toContain("iam.allowedPolicyMemberDomains");
    expect(find(o, "run deploy")).toHaveLength(1);
  });

  it("exits 1 when /healthz answers anything but 200", async () => {
    const o = await deploy({ retentionDays: 30, httpCode: "500" });
    expect(o.code).toBe(1);
    expect(o.stderr).toContain("500");
  });

  it.each([
    ["no arguments", []],
    ["two arguments", ["my-project", "us-central1"]],
    ["an unknown mode", ["my-project", "us-central1", "staging"]],
    ["a project id with shell characters", ["p; rm -rf", "us-central1", "demo"]],
    ["a bad region", ["my-project", "nowhere", "demo"]],
  ])("exits 2 with usage for %s, calling nothing", async (_name, args) => {
    const o = await deploy({ args, retentionDays: 30 });
    expect(o.code).toBe(2);
    expect(o.stderr).toContain("usage");
    expect(o.calls).toEqual([]);
  });
});
