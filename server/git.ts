export interface GitResult {
  code: number;
  stdout: string;
}

export async function git(cwd: string, args: string[], timeoutMs = 3_000): Promise<GitResult> {
  const proc = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "ignore", env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  try {
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    return { code, stdout };
  } finally {
    clearTimeout(timer);
  }
}
