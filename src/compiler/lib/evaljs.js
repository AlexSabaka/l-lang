import * as vm from "node:vm";

export default function evaljs(js, scope) {
  return vm.runInNewContext(js, scope);
}