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
export interface DesktopTarget { id: string; label: string; type: string; enabled: boolean; rect: [number, number, number, number]; center: { x: number; y: number } }
export interface DesktopObservation { session_id: string; state_hash: string; window: DesktopWindow; capture: { mime: "image/png"; base64: string }; editor_text?: string; uia_text?: string; targets: DesktopTarget[] }
export interface DesktopAction { action: "click" | "type" | "keypress" | "scroll"; x?: number; y?: number; text?: string; key?: string; amount?: number }
export interface DesktopTargetAction { target_id: string; action: "click" | "type" | "scroll"; text?: string; amount?: number; expected_text?: string; expected_label?: string }
export interface DesktopPoint { session_id: string; state_hash: string; window: DesktopWindow; target: DesktopTarget; x: number; y: number; label: string; window_rect: [number, number, number, number]; coordinate_space: "screen_physical_pixels"; executed: false }
export interface DesktopEvidence { verified: boolean; kind: "exact_text" | "unique_label" | "unspecified" | "unavailable"; expected?: string; state_hash?: string; truncated?: boolean; reason?: string }
export interface DesktopGuideStep { title: string; expected_text: string; status: "waiting" | "verified" | "unverified" }
export function normalizeDesktopLabel(value: string): string {
  const letters: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "j", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ь: "", ы: "i", э: "e", ю: "yu", я: "ya", ў: "o", қ: "q", ғ: "g", ҳ: "h" };
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[а-яёўқғҳ]/g, char => letters[char] ?? char).replace(/[‘’ʻʼ`']/g, "").match(/[a-z0-9]+/g)?.join(" ") ?? "";
}
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
  const window = parseDesktopWindow(data.window);
  return { session_id: session, state_hash, window, capture: { mime: "image/png", base64 }, targets: parseDesktopTargets(data.targets ?? [], window),
    ...(data.editor_text == null ? {} : { editor_text: string(data.editor_text, 16000) }),
    ...(uia == null && data.uia_text == null ? {} : { uia_text: string(uia ? uia.text : data.uia_text, 8000) }) };
}
export function parseDesktopTargets(value: unknown, window: DesktopWindow): DesktopTarget[] {
  if (!Array.isArray(value) || value.length > 80) throw invalid();
  const seen = new Set<string>();
  return value.map(raw => {
    const data = record(raw), id = string(data.id, 28, false), center = record(data.center);
    if (!/^uia_[a-f0-9]{24}$/.test(id) || seen.has(id) || !Array.isArray(data.rect) || data.rect.length !== 4) throw invalid();
    seen.add(id);
    const rect = data.rect.map((item, index) => integer(item, 0, index % 2 ? window.height : window.width)) as DesktopTarget["rect"];
    if (rect[0] >= rect[2] || rect[1] >= rect[3]) throw invalid();
    const x = integer(center.x, rect[0], rect[2] - 1), y = integer(center.y, rect[1], rect[3] - 1);
    return { id, label: string(data.label, 200, false), type: string(data.type, 40), enabled: boolean(data.enabled), rect, center: { x, y } };
  });
}
export function parseDesktopPoint(value: unknown, observation: DesktopObservation): DesktopPoint {
  const data = record(value), window = parseDesktopWindow(data.window);
  if (data.session_id !== observation.session_id || data.state_hash !== observation.state_hash || window.hwnd !== observation.window.hwnd
    || window.pid !== observation.window.pid || window.width !== observation.window.width || window.height !== observation.window.height
    || data.executed !== false || data.coordinate_space !== "screen_physical_pixels" || !Array.isArray(data.window_rect) || data.window_rect.length !== 4) throw invalid();
  const rect = data.window_rect.map(item => integer(item, -2147483648, 2147483647)) as DesktopPoint["window_rect"];
  if (rect[2] - rect[0] !== window.width || rect[3] - rect[1] !== window.height) throw invalid();
  const target = parseDesktopTargets([data.target], window)[0], x = integer(data.x, rect[0], rect[2] - 1), y = integer(data.y, rect[1], rect[3] - 1);
  const expectedLabel = target.label.replace(/[\x00-\x1f]/g, " ").trim().slice(0, 160).replace(/[\ud800-\udbff]$/, ""), label = string(data.label, 160, false);
  if (x !== rect[0] + target.center.x || y !== rect[1] + target.center.y || label !== expectedLabel || !target.enabled) throw invalid();
  return { session_id: observation.session_id, state_hash: observation.state_hash, window, target, x, y, label, window_rect: rect, coordinate_space: "screen_physical_pixels", executed: false };
}
export function parseDesktopEvidence(value: unknown): DesktopEvidence {
  const data = record(value), kind = enumValue(data.kind, ["exact_text", "unique_label", "unspecified", "unavailable"] as const), verified = boolean(data.verified);
  if (verified && !["exact_text", "unique_label"].includes(kind)) throw invalid();
  const result: DesktopEvidence = { kind, verified };
  if (["exact_text", "unique_label"].includes(kind)) {
    result.expected = string(data.expected, kind === "exact_text" ? 500 : 200, false); result.state_hash = string(data.state_hash, 64, false);
    if (!/^[a-f0-9]{64}$/.test(result.state_hash)) throw invalid(); result.truncated = boolean(data.truncated);
  } else result.reason = string(data.reason, 500, false);
  return result;
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
    session: { id: string; hwnd: string } | null; observation: DesktopObservation | null; desktopResult: string;
    desktopEvidence: DesktopEvidence | null; guide: DesktopGuideStep[]; guideIndex: number } = {
      status: null, pending: null, checking: false, error: "", unknownEffect: false, uncertainOperation: null, uncertainRepo: null, output: null, outputKind: null, plan: null, windows: [], session: null, observation: null, desktopResult: "",
      desktopEvidence: null, guide: [], guideIndex: 0,
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
    this.snapshot.pending = null; this.snapshot.plan = null; this.snapshot.observation = null; this.snapshot.session = null; this.snapshot.windows = []; this.snapshot.guide = []; this.snapshot.guideIndex = 0; this.snapshot.desktopEvidence = null; this.changed();
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
  async point(target_id: string): Promise<DesktopPoint | null> {
    const observation = this.snapshot.observation;
    if (!observation || !this.snapshot.session || this.snapshot.pending) return null;
    let point: DesktopPoint | null = null;
    const done = await this.request("desktop_point", { session_id: observation.session_id, expected_state_hash: observation.state_hash, target_id }, raw => {
      const parsed = parseDesktopPoint(raw, observation); if (parsed.target.id !== target_id) throw invalid(); point = parsed;
    });
    return done ? point : null;
  }
  async targetAction(input: DesktopTargetAction): Promise<void> {
    const observation = this.snapshot.observation, session = this.snapshot.session;
    if (!observation || !session || this.snapshot.pending) return;
    try {
      const target = observation.targets.find(item => item.id === input.target_id);
      if (!target?.enabled) throw new Error("Select an available observed control.");
      enumValue(input.action, ["click", "type", "scroll"]);
      if (input.action === "type") { string(input.text, 2000, false); if (!["Edit", "Document", "ComboBox"].includes(target.type)) throw new Error("Select an editable UIA control before typing."); }
      if (input.action === "scroll") { integer(input.amount, -10, 10); if (input.amount === 0) throw invalid(); }
      if (input.expected_text != null) string(input.expected_text, 500, false);
      if (input.expected_label != null) string(input.expected_label, 200, false);
      if (input.expected_text != null && input.expected_label != null) throw invalid();
      this.snapshot.observation = null; this.snapshot.desktopEvidence = null;
      await this.request("desktop_target_action", { ...input, session_id: session.id, expected_state_hash: observation.state_hash }, raw => {
        const data = record(raw); if (data.session_id !== session.id || data.executed !== true || data.action !== input.action) throw invalid();
        const resolved = parseDesktopTargets([data.target], observation.window)[0]; if (resolved.id !== input.target_id) throw invalid();
        const evidence = parseDesktopEvidence(data.evidence); if (data.verified_task_success !== evidence.verified) throw invalid();
        this.snapshot.desktopEvidence = evidence;
        if (data.post_observation != null) {
          const post = parseDesktopObservation(data.post_observation, session.id); if (post.window.hwnd !== session.hwnd || data.observe_required !== false || evidence.state_hash && evidence.state_hash !== post.state_hash) throw invalid();
          this.snapshot.observation = post;
        } else if (data.observe_required !== true) throw invalid();
        this.snapshot.desktopResult = JSON.stringify({ action: data.action, target: resolved.label, evidence, observe_required: data.observe_required }, null, 2);
      }, true);
    } catch (error) { this.error(error); }
  }
  setGuide(value: string): void {
    if (this.snapshot.pending) return;
    try {
      string(value, 8000, false); const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      if (!lines.length || lines.length > 12) throw new Error("Enter 1–12 steps as title | expected text.");
      const guide = lines.map(line => {
        const separator = line.indexOf("|"); if (separator < 1) throw new Error("Enter 1–12 steps as title | expected text.");
        const title = string(line.slice(0, separator).trim(), 200, false), expected_text = string(line.slice(separator + 1).trim(), 500, false);
        return { title, expected_text, status: "waiting" as const };
      });
      this.snapshot.guide = guide; this.snapshot.guideIndex = 0; this.snapshot.desktopEvidence = null; this.snapshot.error = ""; this.changed();
    } catch (error) { this.error(error); }
  }
  async checkGuide(): Promise<void> {
    const step = this.snapshot.guide[this.snapshot.guideIndex];
    if (!step || !this.snapshot.session || this.snapshot.pending) return;
    await this.observe(); const observation = this.snapshot.observation;
    if (!observation || this.snapshot.guide[this.snapshot.guideIndex] !== step) return;
    await this.request("desktop_check", { session_id: observation.session_id, expected_state_hash: observation.state_hash, expected_text: step.expected_text }, raw => {
      const data = record(raw), evidence = parseDesktopEvidence(data.evidence);
      if (data.session_id !== observation.session_id || data.state_hash !== observation.state_hash || data.executed !== false
        || evidence.kind !== "exact_text" || evidence.expected !== step.expected_text || evidence.state_hash !== observation.state_hash || data.verified_task_success !== evidence.verified) throw invalid();
      this.snapshot.desktopEvidence = evidence; step.status = evidence.verified ? "verified" : "unverified";
    });
  }
  advanceGuide(): void {
    if (this.snapshot.pending || this.snapshot.guide[this.snapshot.guideIndex]?.status !== "verified") return;
    this.snapshot.guideIndex++; this.snapshot.desktopEvidence = null; this.changed();
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
    if (done) { this.snapshot.session = null; this.snapshot.observation = null; this.snapshot.guide = []; this.snapshot.guideIndex = 0; this.snapshot.desktopEvidence = null; this.changed(); }
  }
}
