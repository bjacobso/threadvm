#!/usr/bin/env node

import {
  HarnessConfigError,
  resolveHarnessConfig
} from "@threadvm/shared/config";
import { resolve } from "node:path";

const usage = `Usage:
  threadvm web [--config <path>]
  threadvm dev [--config <path>]
  threadvm config check [--config <path>]

Config discovery order:
  1. --config <path>
  2. HARNESS_CONFIG
  3. harness.yaml or harness.yml in the current directory`;

interface ParsedArguments {
  readonly command: "web" | "dev" | "config-check" | "help";
  readonly configPath?: string;
}

const argumentError = (message: string): never => {
  console.error(message);
  console.error(`\n${usage}`);
  process.exit(2);
};

const parseArguments = (args: ReadonlyArray<string>): ParsedArguments => {
  const positionals: Array<string> = [];
  let configPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--help" || argument === "-h") {
      return { command: "help" };
    }
    if (argument === "--config") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        return argumentError("--config requires a path");
      }
      configPath = value;
      index += 1;
      continue;
    }
    if (argument?.startsWith("--config=")) {
      const value = argument.slice("--config=".length);
      if (!value) {
        return argumentError("--config requires a path");
      }
      configPath = value;
      continue;
    }
    if (argument?.startsWith("-")) {
      return argumentError(`Unknown option: ${argument}`);
    }
    if (argument) {
      positionals.push(argument);
    }
  }

  if (positionals.length === 0) {
    return { command: "web", configPath };
  }
  if (positionals.length === 1 && positionals[0] === "web") {
    return { command: "web", configPath };
  }
  if (positionals.length === 1 && positionals[0] === "dev") {
    return { command: "dev", configPath };
  }
  if (
    positionals.length === 2 &&
    positionals[0] === "config" &&
    positionals[1] === "check"
  ) {
    return { command: "config-check", configPath };
  }

  return argumentError(`Unknown command: ${positionals.join(" ")}`);
};

const resolveConfig = async (configPath: string | undefined) => {
  const cwd = process.cwd();
  try {
    return await resolveHarnessConfig({
      cwd,
      explicitPath: configPath,
      environmentPath: process.env.HARNESS_CONFIG
    });
  } catch (cause) {
    if (cause instanceof HarnessConfigError) {
      console.error(cause.message);
      process.exit(1);
    }
    throw cause;
  }
};

const parsed = parseArguments(process.argv.slice(2));

if (parsed.command === "help") {
  console.log(usage);
  process.exit(0);
}

const resolvedConfig = await resolveConfig(parsed.configPath);

if (parsed.command === "config-check") {
  if (!resolvedConfig) {
    console.error(
      `No Harness config found in ${process.cwd()}. Expected harness.yaml or harness.yml.`
    );
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        path: resolvedConfig.path,
        directory: resolvedConfig.directory,
        source: resolvedConfig.source,
        resolvedPaths: {
          bootstrapConfig: resolve(
            resolvedConfig.directory,
            resolvedConfig.config.base.bootstrap.config
          )
        },
        config: resolvedConfig.config
      },
      null,
      2
    )
  );
  process.exit(0);
}

process.env.THREADVM_PROJECT_DIR = process.cwd();
if (resolvedConfig) {
  process.env.HARNESS_CONFIG = resolvedConfig.path;
}

await import("@threadvm/server");
