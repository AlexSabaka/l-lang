export default function evaljs(js, scope) {
  "use strict";
  return new Function(`with (this) {\n${js}\n}`).call(scope);
}