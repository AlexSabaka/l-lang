import * as vm from "node:vm";

// The host globals an l-lang program may reach. `vm.runInNewContext` provides the ECMAScript
// intrinsics (Object, Array, Math, JSON, Error, parseInt, ...) but NONE of Node's host additions, so
// the prelude's `(fn :extern ...)` declarations -- the timers and fetch -- were undefined under `run`,
// and any game with a clock crashed with `setInterval is not defined` (MR2), though `node out.js`
// worked. Seeded here to match the `std/js` prelude's extern contract. `run` is not a browser, so the
// prelude's `window`/`document`/`navigator` stay undefined (the prelude guards for them).
const globalScope = {
  console, JSON, Math, process, require,
  setTimeout, setInterval, clearTimeout, clearInterval,
  setImmediate, clearImmediate, queueMicrotask,
  ...(typeof fetch !== "undefined" ? { fetch } : {}),
  ...(typeof structuredClone !== "undefined" ? { structuredClone } : {}),
};

export default function evalInScope(js: string, context: vm.Context = {}) {
  return vm.runInNewContext(js, { ...globalScope, ...context});
}
