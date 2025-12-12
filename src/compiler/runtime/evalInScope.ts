import * as vm from "node:vm";

const globalScope = {
  console, JSON, Math, process, require,
}

export default function evalInScope(js: string, context: vm.Context = {}) {
  return vm.runInNewContext(js, { ...globalScope, ...context});
}
