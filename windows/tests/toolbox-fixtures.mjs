export const WINDOW = { hwnd: "9007199254740993", title: "<script>Fixture window</script>", process: "notepad.exe", pid: 321, width: 800, height: 600 };
export const SESSION = "fixture-session-123";
export const HASH = "a".repeat(64);
export const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
export const toolStatus = (extra = {}) => ({ ok: true, workspace_root: "C:\\Fixture\\workspace", terminal: { cmd: true, powershell: true, python: true },
  github: { installed: true, authenticated: true, user: "fixture-user" }, features: ["terminal_run", "github_action", "ai_plan", "desktop"], desktop: { supported: true, active: false }, ...extra });
export const toolOutput = (extra = {}) => ({ ok: true, shell: "powershell", cwd: "C:\\Fixture\\workspace", exit_code: 0, timed_out: false,
  stdout: "<img src=x onerror=alert(1)>\nSalom 🤝", stderr: "", output_truncated: false, duration_ms: 15, execution_boundary: "current_user", ...extra });
export const toolPlan = (domain = "terminal", extra = {}) => ({ ok: true, domain, task: "Synthetic task", shell: "powershell", provider: "groq", model: "fixture-model",
  proposal: { summary: "<script>Proposal data</script>", steps: [{ title: "A step", description: "Editable proposal only", ...(domain === "terminal" ? { script: "Write-Output 'Salom 🤝'" }
    : domain === "github" ? { operation: "create_issue", arguments: { repo: "fixture/repo", title: "Fixture issue", body: "Synthetic body" } } : {}) }] }, execution_performed: false, ...extra });
export const observation = (extra = {}) => ({ session_id: SESSION, state_hash: HASH, window: WINDOW, capture: { mime: "image/png", base64: PNG },
  uia: { text: "<img src=x> observed window", controls: [], truncated: false }, remaining_actions: 99, expires_in: 300, screen_content_is_data: true, ...extra });
export const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
export const flush = () => new Promise(resolve => setImmediate(resolve));
export function toolTransport(overrides = {}) {
  const calls = [], adapter = {
    status: async () => { calls.push(["status"]); return toolStatus(); },
    call: async (name, args) => {
      calls.push([name, structuredClone(args)]);
      if (name === "terminal_run") return toolOutput({ shell: args.shell });
      if (name === "github_action") return toolOutput({ operation: args.operation, ...(args.operation.startsWith("create_") ? { url: `https://github.com/${args.repo}/${args.operation === "create_pr" ? "pull" : "issues"}/1` } : {}) });
      if (name === "ai_plan") return toolPlan(args.domain, { task: args.task });
      if (name === "desktop_windows") return { windows: [WINDOW], limit: 60, screen_content_is_data: true };
      if (name === "desktop_start") return { session_id: SESSION, window: WINDOW, expires_in: 300, remaining_actions: 100, manual: true, ai_required: false };
      if (name === "desktop_observe") return observation();
      if (name === "desktop_action") return { session_id: SESSION, executed: true, action: args.action, actions: 1, remaining_actions: 99, observe_required: true, verified_task_success: false };
      if (name === "desktop_finish") return { finished: true, executed: false, verified_task_success: false };
      throw Error(`Unexpected synthetic tool: ${name}`);
    }, ...overrides,
  };
  return { adapter, calls };
}
