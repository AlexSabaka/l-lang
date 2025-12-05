import * as vm from "node:vm";

export default function evaljs(js: string, context: vm.Context) {
  return vm.runInNewContext(js, context);
}