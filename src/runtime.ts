/** Shared Node.js adapters used by both plugin entry points. */

import type { ConfigEnv } from "./config";
import type { Clock, EnvSource, FsSource, HomeDirProvider } from "./quota/auth-reader";
import type { HttpTransport } from "./quota/types";

export function makeFsSource(): FsSource {
  return {
    async readFile(path: string): Promise<string | null> {
      try {
        const { readFile } = await import("node:fs/promises");
        return await readFile(path, "utf-8");
      } catch (error) {
        const fileError = error as NodeJS.ErrnoException;
        if (fileError.code === "ENOENT") return null;
        throw error;
      }
    },
  };
}

export function makeEnvSource(): EnvSource & ConfigEnv {
  return { get: (key: string) => process.env[key] };
}

export function makeHomeDirProvider(): HomeDirProvider {
  return { home: () => process.env.HOME ?? process.env.USERPROFILE ?? "" };
}

export function makeClock(): Clock {
  return { now: () => Date.now() };
}

export function makeHttpTransport(): HttpTransport {
  return {
    async fetch(
      url: string,
      options: { method: string; headers: Record<string, string>; signal: AbortSignal },
    ) {
      const response = await globalThis.fetch(url, options);
      return {
        ok: response.ok,
        status: response.status,
        json: () => response.json(),
        text: () => response.text(),
      };
    },
  };
}
