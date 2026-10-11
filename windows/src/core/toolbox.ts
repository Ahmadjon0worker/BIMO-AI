/** Manual tools and optional AI proposals share readiness, never execution. */
export interface ToolboxTransport { status(): Promise<unknown>; call(name: string, args: Record<string, unknown>): Promise<unknown> }
export type TerminalShell = "cmd" | "powershell";
export type ToolboxDomain = "terminal" | "github" | "desktop";
export const GITHUB_OPERATIONS = ["status", "repos", "issues", "pulls", "view", "create_issue", "create_pr"] as const;
export type GithubOperation = typeof GITHUB_OPERATIONS[number];
export const DESKTOP_KEYS = ["TAB", "SHIFT+TAB", "ENTER", "ESC", "LEFT", "RIGHT", "UP", "DOWN", "HOME", "END", "PAGEUP", "PAGEDOWN", "BACKSPACE", "DELETE", "CTRL+A", "CTRL+C", "CTRL+V", "CTRL+S", "CTRL+Z", "CTRL+Y", "CTRL+F"] as const;
export interface ToolboxStatus { ok: true; workspace_root: string; terminal: { cmd: boolean; powershell: boolean; python: boolean };
  github: { installed: boolean; authenticated: boolean; user?: string }; features: string[]; desktop?: { supported: boolean; active: boolean } }
export interface TerminalInput { shell: TerminalShell; script: string; cwd?: string; timeout_seconds: number }
export interface GithubInput { operation: GithubOperation; repo?: string; title?: string; body?: string; head?: string; base?: string }
export interface ToolOutput { stdout: string; stderr: string; exit_code: number | null; timed_out: boolean; output_truncated: boolean;
  shell?: TerminalShell; cwd?: string; operation?: GithubOperation; duration_ms?: number; url?: string; mutation_attempted?: boolean; outcome_unknown?: boolean }
export interface ToolPlan { domain: ToolboxDomain; task: string; provider: string | null; model: string | null; proposal: { summary: string;
  steps: { title: string; description: string; script?: string; operation?: GithubOperation; arguments?: Record<string, unknown> }[] }; execution_performed: false }
export interface DesktopWindow { hwnd: string; title: string; process: string; pid: number; width: number; height: number }
export interface DesktopObservation { session_id: string; state_hash: string; window: DesktopWindow; capture: { mime: "image/png"; base64: string }; editor_text?: string; uia_text?: string }
export interface DesktopAction { action: "click" | "type" | "keypress" | "scroll"; x?: number; y?: number; text?: string; key?: string; amount?: number }
const invalid = () => new Error("Invalid toolbox response.");
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid(); return value as Record<string, unknown>; }
function string(value: unknown, max = 2000, empty = true): string {
  if (typeof value !== "string" || value.length > max || value.includes("\0") || !empty && !value) throw invalid();
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) { const low = value.charCodeAt(++index); if (!(low >= 0xdc00 && low <= 0xdfff)) throw invalid(); }
    else if (code >= 0xdc00 && code <= 0xdfff) throw invalid();
  }
  return value;
}
function boolean(value: unknown): boolean { if (typeof value !== "boolean") throw invalid(); return value; }
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number { if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) throw invalid(); return Number(value); }
function enumValue<T extends string>(value: unknown, values: readonly T[]): T { if (typeof value !== "string" || !values.includes(value as T)) throw invalid(); return value as T; }
const sessionID = (value: unknown) => { const id = string(value, 128, false); if (!/^[A-Za-z0-9_-]+$/.test(id)) throw invalid(); return id; };
export function parseToolboxStatus(value: unknown): ToolboxStatus {
  const data = record(value), terminal = record(data.terminal), github = record(data.github);
  if (data.ok !== true || !Array.isArray(data.features) || data.features.length > 50) throw invalid();
  return { ok: true, workspace_root: string(data.workspace_root, 4096, false), terminal: { cmd: boolean(terminal.cmd), powershell: boolean(terminal.powershell), python: boolean(terminal.python) },
    github: { installed: boolean(github.installed), authenticated: boolean(github.authenticated), ...(github.user == null ? {} : { user: string(github.user, 100) }) },
    features: data.features.map(feature => string(feature, 80, false)), ...(data.desktop == null ? {} : { desktop: (() => { const desktop = record(data.desktop); return { supported: boolean(desktop.supported), active: boolean(desktop.active) }; })() }) };
}
export function parseToolOutput(value: unknown, kind: "terminal" | "github", expected: TerminalShell | GithubOperation): ToolOutput {
  const data = record(value); if (data.ok !== true) throw invalid();
  const result: ToolOutput = { stdout: string(data.stdout, 524288), stderr: string(data.stderr, 524288), exit_code: data.exit_code == null ? null : integer(data.exit_code, -2147483648, 2147483647),
    timed_out: boolean(data.timed_out), output_truncated: boolean(data.output_truncated) };
  if (kind === "terminal") {
    if (data.execution_boundary !== "current_user" || data.shell !== expected) throw invalid();
    result.shell = enumValue(data.shell, ["cmd", "powershell"] as const); result.cwd = string(data.cwd, 4096); result.duration_ms = integer(data.duration_ms, 0, 86400000);
  } else {
    if (data.operation !== expected) throw invalid(); result.operation = enumValue(data.operation, GITHUB_OPERATIONS);
    if (data.mutation_attempted != null) result.mutation_attempted = boolean(data.mutation_attempted);
    if (data.outcome_unknown != null) result.outcome_unknown = boolean(data.outcome_unknown);
    if (data.url != null) { const url = string(data.url, 2000); if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:issues|pull)\/\d+$/.test(url)) throw invalid(); result.url = url; }
  }
  return result;
}
export function parseToolPlan(value: unknown, domain: ToolboxDomain): ToolPlan {
  const data = record(value), proposal = record(data.proposal);
  if (data.ok !== true || data.domain !== domain || data.execution_performed !== false || !Array.isArray(proposal.steps) || !proposal.steps.length || proposal.steps.length > 12) throw invalid();
  return { domain, task: string(data.task, 4000), provider: data.provider == null ? null : string(data.provider, 100), model: data.model == null ? null : string(data.model, 200), execution_performed: false,
    proposal: { summary: string(proposal.summary, 2000), steps: proposal.steps.map(value => { const step = record(value);
      return { title: string(step.title, 200), description: string(step.description, 2000), ...(step.script == null ? {} : { script: string(step.script, 10000) }),
        ...(step.operation == null ? {} : { operation: enumValue(step.operation, GITHUB_OPERATIONS) }), ...(step.arguments == null ? {} : { arguments: record(step.arguments) }) };
    }) } };
}
export function parseDesktopWindow(value: unknown): DesktopWindow {
  const data = record(value), hwnd = string(data.hwnd, 24, false); if (!/^[1-9]\d*$/.test(hwnd)) throw invalid();
  return { hwnd, title: string(data.title, 1000), process: string(data.process, 260), pid: integer(data.pid, 1), width: integer(data.width, 1, 32768), height: integer(data.height, 1, 32768) };
}
export function parseDesktopWindows(value: unknown): DesktopWindow[] {
  const data = record(value); if (!Array.isArray(data.windows) || data.windows.length > 60) throw invalid();
  const seen = new Set<string>(); return data.windows.map(value => { const window = parseDesktopWindow(value); if (seen.has(window.hwnd)) throw invalid(); seen.add(window.hwnd); return window; });
}
export function parseDesktopObservation(value: unknown, session: string): DesktopObservation {
  const data = record(value), capture = record(data.capture); if (sessionID(data.session_id) !== session || capture.mime !== "image/png") throw invalid();
  const base64 = string(capture.base64, 1024000, false), state_hash = string(data.state_hash, 64, false);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 || !/^[a-f0-9]{64}$/.test(state_hash)) throw invalid();
  const uia = data.uia == null ? null : record(data.uia);
  return { session_id: session, state_hash, window: parseDesktopWindow(data.window), capture: { mime: "image/png", base64 },
    ...(data.editor_text == null ? {} : { editor_text: string(data.editor_text, 16000) }),
    ...(uia == null && data.uia_text == null ? {} : { uia_text: string(uia ? uia.text : data.uia_text, 8000) }) };
}
export function validateTerminal(input: TerminalInput): TerminalInput {
  enumValue(input.shell, ["cmd", "powershell"]); string(input.script, 10000, false); integer(input.timeout_seconds, 1, 60);
  if (!input.script.trim()) throw new Error("Enter a command to run.");
  if (input.cwd) { string(input.cwd, 512); if (/^(?:[A-Za-z]:|[\\/])/.test(input.cwd) || input.cwd.includes(":") || input.cwd.split(/[\\/]/).includes("..")) throw new Error("Use a folder inside the local workspace."); }
  return { shell: input.shell, script: input.script, timeout_seconds: input.timeout_seconds, ...(input.cwd ? { cwd: input.cwd } : {}) };
}
export function validateGithub(input: GithubInput): GithubInput {
  enumValue(input.operation, GITHUB_OPERATIONS);
  if (input.operation !== "status" && input.operation !== "repos" && !input.repo || input.repo && !/^[A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(input.repo)) throw new Error("Enter a GitHub repository as owner/name.");
  if (["create_issue", "create_pr"].includes(input.operation) && (!input.title?.trim() || input.title.length > 256)) throw new Error("Enter a GitHub title of at most 256 characters.");
  if (input.title != null) { string(input.title, 256); if (/[\r\n]/.test(input.title)) throw new Error("Enter a GitHub title of at most 256 characters."); }
  if (input.body != null) string(input.body, 20000);
  if (input.operation === "create_pr" && (!input.head?.trim() || !input.base?.trim())) throw new Error("Enter the head and base branches for the pull request.");
  for (const [branch, forkHead] of [[input.head, true], [input.base, false]] as const) if (branch != null) {
    const pieces = forkHead ? branch.split(":") : [branch];
    if (branch.length > 256 || pieces.length > 2 || pieces.some(part => !/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(part) || part.includes("..") || part.includes("//"))) throw new Error("Enter the head and base branches for the pull request.");
  }
  return { ...input };
}

export class ToolboxController {
  snapshot: { status: ToolboxStatus | null; pending: string | null; checking: boolean; error: string; unknownEffect: boolean;
    uncertainOperation: GithubOperation | null; uncertainRepo: string | null;
    output: ToolOutput | null; outputKind: "terminal" | "github" | null; plan: ToolPlan | null; windows: DesktopWindow[];
    session: { id: string; hwnd: string } | null; observation: DesktopObservation | null; desktopResult: string } = {
      status: null, pending: null, checking: false, error: "", unknownEffect: false, uncertainOperation: null, uncertainRepo: null, output: null, outputKind: null, plan: null, windows: [], session: null, observation: null, desktopResult: "",
    };
  private transport: ToolboxTransport;
  private changed: () => void;
  private generation = 0;
  private statusFlight: Promise<void> | null = null;
  private visible = false;
  private pendingEffect = false;
  private effectContext: { name: string; args: Record<string, unknown> } | null = null;
  private githubUnknown = new Map<string, { operation: GithubOperation; repo: string | null }>();
  private shownUnknown: string | null = null;
  private genericUnknown = false;
  constructor(transport: ToolboxTransport, changed: () => void = () => {}) { this.transport = transport; this.changed = changed; }
  setVisible(visible: boolean): void { this.visible = visible; if (!visible) this.invalidate(); }
  invalidate(): void {
    ++this.generation;
    if (this.snapshot.pending && this.pendingEffect && this.effectContext) this.markUnknown(this.effectContext.name, this.effectContext.args);
    const session = this.snapshot.session; if (session) void this.transport.call("desktop_finish", { session_id: session.id }).catch(() => {});
    this.snapshot.pending = null; this.snapshot.plan = null; this.snapshot.observation = null; this.snapshot.session = null; this.snapshot.windows = []; this.changed();
  }
  clearPlan(): void { ++this.generation; this.snapshot.plan = null; if (this.snapshot.pending === "ai_plan") this.snapshot.pending = null; this.changed(); }
  private githubSignature(args: Record<string, unknown>): string { return JSON.stringify([args.operation, args.repo ?? "", args.title ?? "", args.body ?? "", args.head ?? "", args.base ?? ""]); }
  private updateUncertainty(): void {
    if (!this.shownUnknown || !this.githubUnknown.has(this.shownUnknown)) this.shownUnknown = [...this.githubUnknown.keys()].at(-1) || null;
    const shown = this.shownUnknown ? this.githubUnknown.get(this.shownUnknown) : null;
    this.snapshot.unknownEffect = this.genericUnknown || this.githubUnknown.size > 0;
    this.snapshot.uncertainOperation = shown?.operation || null; this.snapshot.uncertainRepo = shown?.repo || null;
  }
  private markUnknown(name: string, args: Record<string, unknown>): void {
    if (name === "github_action" && ["create_issue", "create_pr"].includes(String(args.operation))) {
      const signature = this.githubSignature(args); this.githubUnknown.set(signature, { operation: args.operation as GithubOperation, repo: typeof args.repo === "string" ? args.repo : null }); this.shownUnknown = signature;
    } else this.genericUnknown = true;
    this.updateUncertainty();
  }
  acknowledgeUnknown(): void {
    if (this.snapshot.pending) return;
    if (this.shownUnknown) this.githubUnknown.delete(this.shownUnknown); else this.genericUnknown = false;
    this.shownUnknown = null; this.updateUncertainty(); this.snapshot.error = ""; this.changed();
  }
  refresh(): Promise<void> {
    if (this.statusFlight) return this.statusFlight;
    const generation = this.generation; this.snapshot.checking = true; this.changed();
    const flight = (async () => {
      try { const status = parseToolboxStatus(await this.transport.status()); if (generation === this.generation) this.snapshot.status = status; }
      catch (error) { if (generation === this.generation) { this.snapshot.status = null; this.snapshot.error = error instanceof Error ? error.message : String(error); } }
      finally { this.snapshot.checking = false; this.changed(); }
    })(); this.statusFlight = flight; void flight.finally(() => { if (this.statusFlight === flight) this.statusFlight = null; }); return flight;
  }
  private async request(name: string, args: Record<string, unknown>, parse: (raw: unknown) => void, effect = false): Promise<boolean> {
    if (this.snapshot.pending || !this.snapshot.status?.ok || !this.visible) return false;
    const mutation = name === "github_action" && ["create_issue", "create_pr"].includes(String(args.operation));
    const signature = mutation ? this.githubSignature(args) : null;
    if (signature && (this.githubUnknown.has(signature) || this.githubUnknown.size >= 32)) {
      if (this.githubUnknown.has(signature)) this.shownUnknown = signature;
      this.updateUncertainty(); this.error("The action result is uncertain. Check its result before running another action."); return false;
    }
    const generation = ++this.generation; this.pendingEffect = effect; this.effectContext = effect ? { name, args } : null; this.snapshot.pending = name; this.snapshot.error = ""; this.changed();
    try {
      const raw = await this.transport.call(name, args);
      if (generation !== this.generation || !this.visible) {
        if (name === "desktop_start") { try { const data = record(raw); void this.transport.call("desktop_finish", { session_id: sessionID(data.session_id) }).catch(() => {}); } catch {} }
        return false;
      }
      parse(raw); this.updateUncertainty(); return true;
    } catch (error) {
      if (generation === this.generation) { this.snapshot.error = error instanceof Error ? error.message : String(error); if (effect) this.markUnknown(name, args); }
      return false;
    } finally { if (generation === this.generation) this.snapshot.pending = null; this.changed(); }
  }
  error(error: unknown): void { this.snapshot.error = error instanceof Error ? error.message : String(error); this.changed(); }
  async terminal(input: TerminalInput): Promise<void> {
    try { const args = validateTerminal(input); await this.request("terminal_run", { ...args }, raw => { this.snapshot.output = parseToolOutput(raw, "terminal", args.shell); this.snapshot.outputKind = "terminal"; }, true); }
    catch (error) { this.error(error); }
  }
  async github(input: GithubInput): Promise<void> {
    try { const args = validateGithub(input); await this.request("github_action", { ...args }, raw => {
      this.snapshot.output = parseToolOutput(raw, "github", args.operation); this.snapshot.outputKind = "github";
      if (this.snapshot.output.outcome_unknown) this.markUnknown("github_action", { ...args });
    }, ["create_issue", "create_pr"].includes(args.operation)); }
    catch (error) { this.error(error); }
  }
  async plan(domain: ToolboxDomain, task: string, shell?: TerminalShell): Promise<void> {
    try { if (!task.trim()) throw new Error("Enter a task for the AI proposal."); string(task, 4000);
      this.snapshot.plan = null; await this.request("ai_plan", { domain, task, ...(shell ? { shell } : {}) }, raw => { this.snapshot.plan = parseToolPlan(raw, domain); }); }
    catch (error) { this.error(error); }
  }
  async windows(): Promise<void> { await this.request("desktop_windows", {}, raw => { this.snapshot.windows = parseDesktopWindows(raw); }); }
  async start(hwnd: string): Promise<void> {
    if (this.snapshot.session || !this.snapshot.windows.some(window => window.hwnd === hwnd)) return;
    const done = await this.request("desktop_start", { hwnd }, raw => {
      const data = record(raw); const id = sessionID(data.session_id);
      if (data.window != null && parseDesktopWindow(data.window).hwnd !== hwnd) throw invalid();
      this.snapshot.session = { id, hwnd }; this.snapshot.observation = null;
    });
    if (done) await this.observe();
  }
  async observe(): Promise<void> {
    const session = this.snapshot.session; if (!session) return;
    this.snapshot.observation = null;
    await this.request("desktop_observe", { session_id: session.id }, raw => {
      const result = parseDesktopObservation(raw, session.id); if (result.window.hwnd !== session.hwnd) throw invalid(); this.snapshot.observation = result;
    });
  }
  async action(input: DesktopAction): Promise<void> {
    const observation = this.snapshot.observation, session = this.snapshot.session;
    if (!observation || !session || observation.session_id !== session.id || this.snapshot.pending) return;
    try {
      enumValue(input.action, ["click", "type", "keypress", "scroll"]);
      if (input.action === "click" || input.action === "scroll") { integer(input.x, 0, observation.window.width - 1); integer(input.y, 0, observation.window.height - 1); }
      if (input.action === "type") string(input.text, 2000, false);
      if (input.action === "keypress") enumValue(input.key, DESKTOP_KEYS);
      if (input.action === "scroll") { integer(input.amount, -10, 10); if (input.amount === 0) throw invalid(); }
      this.snapshot.observation = null;
      const done = await this.request("desktop_action", { ...input, session_id: session.id, expected_state_hash: observation.state_hash }, raw => {
        const data = record(raw); if (data.executed !== true || data.session_id !== session.id || data.action !== input.action || data.observe_required !== true || data.verified_task_success !== false) throw invalid();
        this.snapshot.desktopResult = JSON.stringify(data, null, 2).slice(0, 8000);
      }, true);
      if (done && this.visible && this.snapshot.session?.id === session.id) await this.observe();
    } catch (error) { this.error(error); }
  }
  async finish(): Promise<void> {
    const session = this.snapshot.session; if (!session) return;
    this.snapshot.observation = null;
    const done = await this.request("desktop_finish", { session_id: session.id }, raw => { const data = record(raw); if (data.finished !== true || data.executed !== false || data.verified_task_success !== false) throw invalid(); });
    if (done) { this.snapshot.session = null; this.snapshot.observation = null; this.changed(); }
  }
}
