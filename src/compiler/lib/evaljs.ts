import * as vm from "node:vm";

export default function evaljs(js: string, scope: vm.Context) {
  return vm.runInNewContext(js, scope);
}