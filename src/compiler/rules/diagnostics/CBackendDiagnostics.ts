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
  // LL0105 -- coroutines refused (spec A8).
  //
  // Phase G4c built the state machine, so a TOP-LEVEL `:gen` is no longer refused. What still fires
  // here is `:async` -- deliberately, per D60: l-lang owns await ordering and there is no native
  // lowering to constrain yet -- and the `:gen` shapes the state machine does not reach, which are a
  // nested or lambda generator (ledger §11.2/§11.3, both pre-existing defects rather than rulings).
  CoroutineRefused: def<{ form: string; name: string }>(
    "LL0105",
    Error,
    (p) =>
      `'${p.name}' is ${p.form} -- the C backend does not lower this coroutine form. A top-level ` +
      `':gen' compiles (D58); ':async' stays refused by ruling (D60), and a nested or lambda ` +
      `generator has no lowering yet (spec A8). The backend records the gap and refuses.`
  ),

  // LL0106 -- the C totality net (the LL0100 analog). Every firing is also a gap-ledger entry.
  Unhandled: def<{ type: string; where: string }>(
    "LL0106",
    Error,
    (p) =>
      // "no lowering exists", not "no CIR lowering exists": this code is now filed from BOTH ends of
      // the pipeline. P1 (`ResolveHirToCir.refuse`) means there is no CIR for the construct; P3
      // (`EmitCirToC`, via `EmitRefusal`) means the CIR exists and cannot be PRINTED. `where` says
      // which, and the message must not assert the P1 story for a P3 refusal.
      `Cannot generate C for '${p.type}': no lowering exists (${p.where}). The construct ` +
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
