/**
 * The environment every harness must spawn a compiled program with.
 *
 * WHY THIS EXISTS. Every harness here compiles a `.lisp` file and then `spawnSync("node", [js])`,
 * comparing the child's stdout to an exact expectation. The child inherited the ambient environment
 * -- and `FORCE_COLOR` makes node colourise its own `console.log` output even when stdout is a PIPE,
 * because FORCE_COLOR exists precisely to override the isTTY check:
 *
 *     $ FORCE_COLOR=3 node -e "console.log(7, 9)" | cat -v
 *     ^[[33m7^[[39m ^[[33m9^[[39m
 *
 * So on any machine with FORCE_COLOR set, `expect: ["7 9"]` receives
 * `"[33m7[39m [33m9[39m"` and fails. Measured: the whole suite goes red at
 * once -- 131/207 codegen cases, 10/17 imports, and the golden runner -- while the compiler is
 * untouched and every one of those tests passes in a shell that does not set it. A suite that reports
 * a broken compiler because of a terminal setting is not measuring the compiler.
 *
 * Only values NODE would print are affected, which is why it looks so arbitrary from the outside:
 * `console.log("hi")` is never coloured, `console.log(7)` always is. Strings pass, numbers fail.
 *
 * `FORCE_COLOR: "0"`, NOT `NO_COLOR: "1"`. NO_COLOR is the cross-tool standard (no-color.org) and is
 * the obvious reach -- but node IGNORES it when FORCE_COLOR is also set, and says so on stderr:
 *
 *     Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
 *
 * which a harness that captures stderr would then have to filter. So NO_COLOR alone is worse than
 * nothing here: still coloured, plus a warning. `FORCE_COLOR: "0"` is node's own documented disable
 * and does not depend on what the parent happens to have set.
 *
 * This is HERMETICITY, not cosmetics: a test's result must depend on the code under test and nothing
 * else. Use it for every child process whose stdout is compared.
 */
export const CHILD_ENV: NodeJS.ProcessEnv = {
  ...process.env,
  FORCE_COLOR: "0",
};
