#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const repositoryRoot = process.cwd();
const outputDirectory = path.join(
  repositoryRoot,
  "generated",
  "defectra-sdk52-lock-candidate",
);
const workspace = fs.mkdtempSync(
  path.join(os.tmpdir(), "defectra-sdk52-lock-"),
);

const expectedSpecifiers = Object.freeze({
  "@expo/vector-icons": "~14.0.4",
  "@react-navigation/native": "^7.0.14",
  "@react-navigation/native-stack": "^7.2.0",
  "expo-asset": "~11.0.5",
  "expo-clipboard": "~7.0.1",
  "expo-file-system": "~18.0.12",
  "expo-location": "~18.0.10",
  "expo-router": "~4.0.22",
});

const rootManifest = {
  name: "Defectra",
  version: "1.0.0",
  private: true,
  license: "UNLICENSED",
  packageManager: "pnpm@10.20.0",
  engines: { node: "22.x" },
  main: "expo-router/entry",
  dependencies: {
    "@aws-sdk/client-s3": "^3.998.0",
    "@aws-sdk/s3-request-presigner": "^3.998.0",
    "@babel/runtime": "^7.26.0",
    "@expo-google-fonts/inter": "^0.4.2",
    "@expo/metro-runtime": "~4.0.1",
    "@expo/vector-icons": expectedSpecifiers["@expo/vector-icons"],
    "@react-native-async-storage/async-storage": "1.23.1",
    "@react-native-community/datetimepicker": "8.2.0",
    "@react-native-community/netinfo": "11.4.1",
    "@react-native-picker/picker": "2.9.0",
    "@react-navigation/native": expectedSpecifiers["@react-navigation/native"],
    "@react-navigation/native-stack":
      expectedSpecifiers["@react-navigation/native-stack"],
    expo: "~52.0.47",
    "expo-font": "~13.0.4",
    "expo-asset": expectedSpecifiers["expo-asset"],
    "expo-auth-session": "6.0.3",
    "expo-clipboard": expectedSpecifiers["expo-clipboard"],
    "expo-constants": "~17.0.8",
    "expo-dev-client": "~5.0.17",
    "expo-document-picker": "13.0.3",
    "expo-file-system": expectedSpecifiers["expo-file-system"],
    "expo-image": "2.0.7",
    "expo-image-picker": "16.0.6",
    "expo-linking": "7.0.5",
    "expo-location": expectedSpecifiers["expo-location"],
    "expo-notifications": "0.29.14",
    "expo-router": expectedSpecifiers["expo-router"],
    "expo-sharing": "13.0.1",
    "expo-speech": "13.0.1",
    "expo-speech-recognition": "^2.1.5",
    "expo-splash-screen": "0.29.24",
    "expo-web-browser": "14.0.2",
    "file-saver": "^2.0.5",
    firebase: "12.5.0",
    "lottie-ios": "^4.5.1",
    "lottie-react-native": "7.1.0",
    "pdf-lib": "^1.17.1",
    react: "18.3.1",
    "react-dom": "18.3.1",
    "react-error-boundary": "4.0.11",
    "react-native": "0.76.9",
    "react-native-gesture-handler": "2.20.2",
    "react-native-maps": "1.18.0",
    "react-native-modal-datetime-picker": "^18.0.0",
    "react-native-safe-area-context": "4.12.0",
    "react-native-screens": "4.4.0",
    "react-native-toast-message": "^2.3.3",
    "react-native-web": "0.19.13",
    "react-native-webview": "13.12.5",
    "react-sketch-canvas": "^6.2.0",
    zod: "^4.1.12",
  },
  devDependencies: {
    "@babel/plugin-transform-runtime": "^7.26.0",
    "@types/file-saver": "^2.0.7",
    "@types/node": "20.14.11",
    "@types/react": "18.3.26",
    "@types/react-dom": "18.3.1",
    "@typescript-eslint/eslint-plugin": "7.18.0",
    "@typescript-eslint/parser": "7.18.0",
    "babel-plugin-module-resolver": "^5.0.2",
    "cross-env": "^7.0.3",
    eslint: "8.57.1",
    "eslint-plugin-react": "7.35.0",
    "eslint-plugin-react-hooks": "4.6.2",
    prettier: "3.3.3",
    typescript: "5.9.3",
  },
  pnpm: {
    onlyBuiltDependencies: ["@firebase/util", "esbuild", "protobufjs"],
  },
};

const apiManifest = {
  name: "api",
  version: "1.2.0",
  private: true,
  type: "module",
  description: "Serverless API for Defectra (mail, AI, cron, etc.)",
  dependencies: {
    "@aws-sdk/client-s3": "^3.998.0",
    "@aws-sdk/s3-request-presigner": "^3.998.0",
    "@google-cloud/vision": "^5.1.0",
    "@qdrant/js-client-rest": "^1.14.0",
    dotenv: "^16.5.0",
    "firebase-admin": "^13.4.0",
    openai: "^4.100.0",
    resend: "^3.2.0",
    zod: "^3.23.8",
  },
  devDependencies: {
    "@types/node": "^20.17.50",
    "@vercel/node": "^3.2.20",
    tsx: "^4.20.6",
    typescript: "5.9.3",
  },
  engines: { node: "22.x" },
};

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function run(command, args) {
  const executable =
    process.platform === "win32" && command === "pnpm" ? "pnpm.cmd" : command;
  const result = spawnSync(executable, args, {
    cwd: workspace,
    env: {
      ...process.env,
      CI: "1",
      EXPO_NO_TELEMETRY: "1",
      npm_config_audit: "false",
      npm_config_fund: "false",
    },
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.signal) {
    throw new Error(`${command} terminated by signal ${result.signal}.`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}.`);
  }
}

function yamlDependencyKey(name) {
  return name.startsWith("@") ? `'${name}'` : name;
}

try {
  writeJson(path.join(workspace, "package.json"), rootManifest);
  writeJson(path.join(workspace, "api", "package.json"), apiManifest);
  fs.writeFileSync(
    path.join(workspace, "pnpm-workspace.yaml"),
    'packages:\n  - "."\n  - "api"\n',
    "utf8",
  );
  fs.writeFileSync(
    path.join(workspace, ".npmrc"),
    "frozen-lockfile=true\nshared-workspace-lockfile=true\nlink-workspace-packages=true\n",
    "utf8",
  );

  run("pnpm", [
    "install",
    "--lockfile-only",
    "--no-frozen-lockfile",
    "--ignore-scripts",
  ]);
  run("pnpm", ["install", "--frozen-lockfile", "--ignore-scripts"]);

  const lockPath = path.join(workspace, "pnpm-lock.yaml");
  const lockBytes = fs.readFileSync(lockPath);
  const lockSource = lockBytes.toString("utf8").replace(/\r\n?/gu, "\n");
  const errors = [];
  const importerMatch = lockSource.match(
    /^importers:\s*\n([\s\S]*?)(?=^packages:\s*$)/mu,
  );
  const importers = importerMatch?.[1] ?? "";
  const apiBoundary = importers.search(/^  api:\s*$/mu);
  const rootImporter = apiBoundary >= 0 ? importers.slice(0, apiBoundary) : "";
  const apiImporter = apiBoundary >= 0 ? importers.slice(apiBoundary) : "";

  if (!/^  \.:\s*$/mu.test(rootImporter)) {
    errors.push("root importer is missing");
  }
  if (!/^  api:\s*$/mu.test(apiImporter)) {
    errors.push("api importer is missing");
  }

  for (const [name, specifier] of Object.entries(expectedSpecifiers)) {
    const expectedEntry = `      ${yamlDependencyKey(
      name,
    )}:\n        specifier: ${specifier}\n`;
    if (!rootImporter.includes(expectedEntry)) {
      errors.push(`${name} importer specifier is not ${specifier}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Generated lock validation failed:\n- ${errors.join("\n- ")}`);
  }

  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(outputDirectory, { recursive: true });
  fs.copyFileSync(lockPath, path.join(outputDirectory, "pnpm-lock.yaml"));
  writeJson(
    path.join(outputDirectory, "expected-root-specifiers.json"),
    expectedSpecifiers,
  );

  const receipt = {
    schemaVersion: "defectra-sdk52-lock-candidate-v1",
    sourceRepository: "EVAVO-STUDIO/defectra",
    sourceBranch: "main",
    packageManifestSha: "8593243e6f73d54934fc87405bcb823318ce5d18",
    apiManifestSha: "184df1ba9979e9438853b1489d1fe4a6c175d7b6",
    workspaceManifestSha: "32e69d11be3d57c5ea2a835949462234a9b6c865",
    npmrcSha: "d6c62115e025530628275b3c79d6ef75e594e7ea",
    nodeVersion: process.version,
    pnpmVersion: "10.20.0",
    rootAndApiImportersPresent: true,
    frozenInstallPassed: true,
    scriptsExecutedDuringInstall: false,
    lockBytes: lockBytes.length,
    lockSha256: crypto.createHash("sha256").update(lockBytes).digest("hex"),
    expectedRootSpecifiers: expectedSpecifiers,
    releaseEvidence: false,
  };
  writeJson(path.join(outputDirectory, "receipt.json"), receipt);

  console.log(
    `Generated verified Defectra SDK 52 lock candidate ${receipt.lockSha256} (${receipt.lockBytes} bytes).`,
  );
} finally {
  fs.rmSync(workspace, { recursive: true, force: true });
}
