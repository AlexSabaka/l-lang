import { def } from "./Diagnostic";
import { RuleSeverity } from "../RuleBuilder";

const { Error } = RuleSeverity;

/**
 * The C-backend diagnostics (LL0105+). The C backend is an adversarial probe of the HIR contract
 * (docs/inbox/hir-llvm-consumption-spec.md); its refusals are honest statements of what the probe
 * does not model, in the LL0230/LL0234 tradition -- where the backend carries no representation,
 * refuse and say so, never emit a guess.
 */
export const CBackendDiagnostics = {
  // LL0105 -- coroutines refused (spec A8). The HIR carries no suspend/resume model; generators and
  // async need a state-machine lowering (the Rust MIR approach) that is deliberately out of scope.
  CoroutineRefused: def<{ form: string; name: string }>(
    "LL0105",
    Error,
    (p) =>
      `'${p.name}' is ${p.form} -- the C backend does not support coroutines. Generators and ` +
      `async functions need a state-machine lowering the HIR does not model yet (spec A8); the ` +
      `backend records the gap and refuses.`
  ),

  // LL0106 -- the C totality net (the LL0100 analog). Every firing is also a gap-ledger entry.
  Unhandled: def<{ type: string; where: string }>(
    "LL0106",
    Error,
    (p) =>
      `Cannot generate C for '${p.type}': no CIR lowering exists (${p.where}). The construct ` +
      `parses, but the C backend has no code generator for it.`
  ),

  // LL0107 -- an unresolvable JS host global (the A9-extern boundary). The std/js prelude declares
  // ambient names the JS backend resolves against the host; C has no host.
  UnresolvableExtern: def<{ name: string }>(
    "LL0107",
    Error,
    (p) =>
      `'${p.name}' resolves to a JavaScript host global; the C backend has no representation ` +
      `for it. (The std/js extern boundary -- spec gap A9.)`
  ),
};
