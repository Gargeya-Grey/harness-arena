// The process watch: no process an agent call starts may outlive the call. The workdir
// guard and the evidence ledger only see what changes while they watch; a process the
// agent leaves running could change the run store, or the ledger, later.
//
// On Windows every guarded call gets a Job Object, held by a small PowerShell helper. The
// runner puts each harness process it spawns into the job (lab/adapters/process.mjs), and
// every process that harness starts is then in the job too, however it detaches. After
// the call the runner ends the whole job. The run halts when a process of the call
// survives that, when the harness had started a child before it was in the job, or when
// the helper stopped (an agent can end it; the job then ends all its processes anyway).
// Elsewhere the runner lists processes a few times a second and ends every new process
// that descends from it; a fast double fork can escape that list.
//
// It is a tripwire, not an OS sandbox: a process started through a system service (Task
// Scheduler, WMI, a COM server) is not in the job. See README "Agent tasks".

import { spawn } from 'node:child_process';
import { watchSpawns } from '../adapters/process.mjs';

const ANSWER_TIMEOUT_MS = 15000;

const JOB_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class LabJob {
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] public static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool QueryInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint length, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool TerminateJobObject(IntPtr job, uint exitCode);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
  [DllImport("kernel32.dll", SetLastError = true)] public static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
  public static IntPtr Create() {
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw new Exception("CreateJobObject " + Marshal.GetLastWin32Error());
    // JOBOBJECT_EXTENDED_LIMIT_INFORMATION; LimitFlags = KILL_ON_JOB_CLOSE, so the job ends
    // all its processes when this helper's handle closes, even when the helper is killed.
    int size = IntPtr.Size == 8 ? 144 : 112;
    IntPtr info = Marshal.AllocHGlobal(size);
    for (int i = 0; i < size; i++) Marshal.WriteByte(info, i, 0);
    Marshal.WriteInt32(info, IntPtr.Size == 8 ? 16 : 16, 0x2000);
    if (!SetInformationJobObject(job, 9, info, (uint)size)) throw new Exception("SetInformationJobObject " + Marshal.GetLastWin32Error());
    Marshal.FreeHGlobal(info);
    return job;
  }
  public static string Assign(IntPtr job, uint pid) {
    IntPtr process = OpenProcess(0x0100 | 0x0001 | 0x1000, false, pid);
    if (process == IntPtr.Zero) return "fail OpenProcess " + Marshal.GetLastWin32Error();
    bool ok = AssignProcessToJobObject(job, process);
    int error = Marshal.GetLastWin32Error();
    CloseHandle(process);
    return ok ? "ok" : "fail AssignProcessToJobObject " + error;
  }
  public static bool InJob(IntPtr job, uint pid) {
    IntPtr process = OpenProcess(0x1000, false, pid);
    if (process == IntPtr.Zero) return true;
    bool result;
    IsProcessInJob(process, job, out result);
    CloseHandle(process);
    return result;
  }
  public static ulong[] Pids(IntPtr job) {
    int max = 4096;
    int size = 8 + IntPtr.Size * max;
    IntPtr info = Marshal.AllocHGlobal(size);
    Marshal.WriteInt32(info, 0, max);
    Marshal.WriteInt32(info, 4, 0);
    if (!QueryInformationJobObject(job, 3, info, (uint)size, IntPtr.Zero)) { Marshal.FreeHGlobal(info); throw new Exception("QueryInformationJobObject " + Marshal.GetLastWin32Error()); }
    int count = Marshal.ReadInt32(info, 4);
    ulong[] pids = new ulong[count];
    for (int i = 0; i < count; i++) pids[i] = (ulong)Marshal.ReadIntPtr(info, 8 + i * IntPtr.Size).ToInt64();
    Marshal.FreeHGlobal(info);
    return pids;
  }
}
'@
$job = [LabJob]::Create()
[Console]::Out.WriteLine('ready')
[Console]::Out.Flush()
while ($null -ne ($request = [Console]::In.ReadLine())) {
  $answer = 'fail unknown request'
  try {
    $parts = $request.Split(' ')
    if ($parts[0] -eq 'assign') {
      $id = [uint32]$parts[1]
      $answer = [LabJob]::Assign($job, $id)
      if ($answer -eq 'ok') {
        # A child the harness started before it was in the job is outside it. Windows
        # itself starts System32\conhost.exe for every console program; that one is not.
        $console = Join-Path $env:SystemRoot 'System32\conhost.exe'
        $outside = @(Get-CimInstance -ClassName Win32_Process -Filter "ParentProcessId = $id" | Where-Object { $_.ExecutablePath -ne $console -and -not [LabJob]::InJob($job, [uint32]$_.ProcessId) } | ForEach-Object { "$($_.Name):$($_.ProcessId)" })
        if ($outside.Count) { $answer = 'escaped ' + ($outside -join ',') }
      }
    } elseif ($parts[0] -eq 'list') {
      $names = foreach ($p in [LabJob]::Pids($job)) { $n = (Get-Process -Id $p -ErrorAction SilentlyContinue).ProcessName; "$($n):$p" }
      $answer = 'pids ' + (@($names) -join ',')
    } elseif ($parts[0] -eq 'end') {
      [void][LabJob]::TerminateJobObject($job, 1)
      $answer = 'ok'
    }
  } catch {
    $answer = 'fail ' + ($_.Exception.Message -replace '[\r\n]+', ' ')
  }
  [Console]::Out.WriteLine($answer)
  [Console]::Out.Flush()
}
`;

/** A helper process that answers one line per request line. */
function lineHelper(command, args) {
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let buffer = '';
  let stderr = '';
  const queue = [];
  let dead = null;
  const fail = (message) => {
    dead = dead || message;
    for (const item of queue.splice(0)) {
      clearTimeout(item.timer);
      item.reject(new Error(dead));
    }
  };
  child.on('error', (error) => fail(`the process watch could not start (${error.message})`));
  child.on('exit', () => fail(`the process watch stopped${stderr.trim() ? ` (${stderr.trim().split('\n')[0].slice(0, 200)})` : ''}`));
  child.stdin.on('error', () => fail('the process watch stopped'));
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) {
      const item = queue.shift();
      if (!item) continue;
      clearTimeout(item.timer);
      item.resolve(line);
    }
  });
  const wait = () =>
    new Promise((resolve, reject) => {
      if (dead) return reject(new Error(dead));
      queue.push({ resolve, reject, timer: setTimeout(() => fail('the process watch did not answer'), ANSWER_TIMEOUT_MS) });
    });
  return {
    pid: child.pid,
    ready: wait(),
    ask(line) {
      if (dead) return Promise.reject(new Error(dead));
      const answer = wait();
      child.stdin.write(`${line}\n`);
      return answer;
    },
    get dead() {
      return dead;
    },
    close() {
      dead = dead || 'closed';
      try {
        child.stdin.end();
      } catch {
        // Already gone.
      }
    },
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const parsePids = (answer) => (answer.startsWith('pids ') ? answer.slice(5).split(',').filter(Boolean) : null);

/** The Windows watch: one Job Object for the call. */
export async function jobWatch({ settleMs = 300 } = {}) {
  const helper = lineHelper('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(JOB_SCRIPT, 'utf16le').toString('base64')]);
  const ready = await helper.ready.catch((error) => error.message);
  if (ready !== 'ready') {
    helper.close();
    throw new Error(String(ready));
  }
  let failure = null;
  // Assignments still in flight when the call ends: finish() waits for them, so a late
  // failure is never missed.
  const pending = new Set();
  return {
    assign(pid) {
      const work = (async () => {
        const answer = await helper.ask(`assign ${pid}`).catch((error) => `fail ${error.message}`);
        if (answer === 'ok') return;
        failure = failure || (answer.startsWith('escaped ') ? `the harness started a process before the job held it (${answer.slice(8)})` : `a harness process could not be put in the job (${answer.slice(5)})`);
        throw new Error(failure);
      })();
      pending.add(work);
      work.catch(() => {}).finally(() => pending.delete(work));
      return work;
    },
    async finish() {
      try {
        await Promise.allSettled([...pending]);
        if (failure) return { ended: [], survivors: [], error: failure };
        const left = parsePids(await helper.ask('list'));
        if (!left) throw new Error('the process watch could not list the job');
        if (left.length) {
          await helper.ask('end');
          await sleep(settleMs);
        }
        const survivors = left.length ? parsePids(await helper.ask('list')) : [];
        if (!survivors) throw new Error('the process watch could not list the job');
        return { ended: left, survivors, error: null };
      } catch (error) {
        return { ended: [], survivors: [], error: error.message };
      } finally {
        helper.close();
      }
    },
  };
}

/** One process list from ps; `spawned` learns the pid of that ps. */
function psList(spawned) {
  return new Promise((resolve, reject) => {
    const child = spawn('ps', ['-A', '-o', 'pid=,ppid=,lstart=,comm='], { stdio: ['ignore', 'pipe', 'ignore'] });
    if (child.pid) spawned(child.pid);
    let out = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      out += chunk;
    });
    child.on('error', (error) => reject(new Error(`the process watch could not list processes (${error.message})`)));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ps exited with ${code}`));
      resolve(out.split('\n').map((line) => line.trim().split(/\s+/)).filter((parts) => parts.length >= 7).map((parts) => ({ pid: Number(parts[0]), ppid: Number(parts[1]), key: `${parts[0]}|${parts.slice(2, 7).join(' ')}`, name: parts.slice(7).join(' ') })));
    });
  });
}

/** Elsewhere: list processes with ps, keep the new ones that descend from the runner. */
export async function treeWatch({ intervalMs = 250, settleMs = 300, rootPid = process.pid, lister = psList } = {}) {
  // The watch's own ps processes are children of the runner too: never part of the tree.
  const own = new Set();
  const list = () => lister((pid) => own.add(pid)).then((rows) => rows.filter((row) => !own.has(row.pid)));
  const baseline = new Set((await list()).map((row) => row.key));
  const tree = new Map();
  const pids = new Set([rootPid]);
  const absorb = (rows) => {
    for (let grew = true; grew; ) {
      grew = false;
      for (const row of rows) {
        if (baseline.has(row.key) || tree.has(row.key) || !pids.has(row.ppid)) continue;
        tree.set(row.key, row);
        pids.add(row.pid);
        grew = true;
      }
    }
    return rows;
  };
  let failure = null;
  let busy = null;
  const timer = setInterval(() => {
    if (busy || failure) return;
    busy = list()
      .then(absorb)
      .catch((error) => {
        failure = error.message;
      })
      .finally(() => {
        busy = null;
      });
  }, intervalMs);
  timer.unref?.();
  const alive = (rows) => {
    const keys = new Set(rows.map((row) => row.key));
    return [...tree.values()].filter((row) => keys.has(row.key) && row.pid !== process.pid);
  };
  return {
    async assign() {},
    async finish() {
      clearInterval(timer);
      await busy;
      try {
        if (failure) return { ended: [], survivors: [], error: failure };
        let rows = absorb(await list());
        const ended = [];
        for (let round = 0; round < 3 && alive(rows).length; round += 1) {
          for (const row of alive(rows)) {
            try {
              process.kill(row.pid, 'SIGKILL');
            } catch {
              // Gone already.
            }
            ended.push(`${row.name}:${row.pid}`);
          }
          await sleep(settleMs);
          rows = absorb(await list());
        }
        return { ended, survivors: alive(rows).map((row) => `${row.name}:${row.pid}`), error: null };
      } catch (error) {
        return { ended: [], survivors: [], error: error.message };
      }
    },
  };
}

let factory = () => (process.platform === 'win32' ? jobWatch() : treeWatch());

/** Tests only: replace how a watch is made (null restores the real one). */
export function setProcessWatch(make) {
  factory = make || (() => (process.platform === 'win32' ? jobWatch() : treeWatch()));
}

/**
 * Start the watch before a guarded call. Rejects when it cannot start (the runner then
 * makes no call). While it runs, every process lab/adapters/process.mjs spawns joins it.
 * finish() ends what the call left running and reports { ended, survivors, error }.
 */
export async function startProcessWatch() {
  const watch = await factory();
  const stop = watchSpawns((pid) => watch.assign(pid));
  return {
    async finish() {
      stop();
      return watch.finish();
    },
  };
}
